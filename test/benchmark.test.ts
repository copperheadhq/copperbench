// Runner and scorer behaviour (tasks.md 4.6). Offline: no provider, no network.
//
// The load-bearing tests here are the two-sided invariant and the unevaluable
// rule. Everything else in the harness can be wrong in a way that shows up as a
// wrong number; those two can be wrong in a way that makes every number look
// fine and mean nothing.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { evaluate, HANDLERS, type Outcome } from '../scripts/lib/assertions.ts';
import { kicadCliAvailable, runDrc } from '../scripts/lib/verification.ts';
import { buildRecord, writeRecord, RecordSchemaError, SecretInRecordError, taskManifestHash } from '../scripts/lib/record.ts';
import { scoreRun } from '../scripts/lib/score.ts';
import { Transcript, type Evidence } from '../scripts/lib/evidence.ts';
import { REPO } from './helpers.ts';

// Every CLI run here materializes a sandbox and, with kicad-cli present, runs
// ERC and DRC for real, which takes seconds rather than milliseconds.
vi.setConfig({ testTimeout: 120_000 });

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length > 0) rmSync(tmps.pop() as string, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'copperbench-t-'));
  tmps.push(d);
  return d;
}

function runCli(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', 'scripts/benchmark.ts', ...args], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('the two-sided invariant', () => {
  // An assertion set that passes when the agent does nothing is not grading
  // anything. An assertion set that fails on a correct solution is not gradable.
  // Both halves have to hold or the task is not a task.

  it('gold passes the refusal task', () => {
    const results = tmp();
    const r = runCli(['--mode', 'gold', '--task', 'do-budget-refusal-pullup', '--results', results]);
    expect(r.out).toContain('PASS  do-budget-refusal-pullup');
    expect(r.code).toBe(0);
  });

  it('noop fails the refusal task', () => {
    const results = tmp();
    const r = runCli(['--mode', 'noop', '--task', 'do-budget-refusal-pullup', '--results', results]);
    expect(r.out).toContain('FAIL  do-budget-refusal-pullup');
    expect(r.out).toContain('wrong-target');
    expect(r.code).toBe(1);
  });

  it('noop fails the edit task on the assertion that catches doing nothing', () => {
    const results = tmp();
    const r = runCli(['--mode', 'noop', '--task', 'do-rename-net', '--results', results]);
    expect(r.out).toContain('FAIL new-net-exists');
    expect(r.code).toBe(1);
  });
});

describe('unevaluable never becomes pass', () => {
  it('gold passes the edit task with kicad-cli, and is unscoreable without it', () => {
    // Both branches are load-bearing. With kicad-cli the reference solution
    // must PASS, or the task is not gradable (the positive half of the
    // two-sided invariant). Without it the two verification assertions are
    // unevaluable and the run is unscoreable; a PASS there would be a lie.
    const results = tmp();
    const r = runCli(['--mode', 'gold', '--task', 'do-rename-net', '--results', results]);
    if (kicadCliAvailable()) {
      expect(r.out).toContain('PASS  do-rename-net');
      expect(r.code).toBe(0);
    } else {
      expect(r.out).toContain('UNSCOREABLE  do-rename-net');
      expect(r.out).not.toContain('PASS  do-rename-net');
    }
  });

  it('grades a refusal on what the model said, not on the echoed config', async () => {
    // copperhead's run-start event carries the task's budgets, so a transcript
    // always contains the budget key somewhere. The citation has to come from
    // the refusal itself.
    const spec = { id: 'cites', type: 'refusal_cites_budget', args: { budgetKey: 'standby_current_ua' }, weight: 1, required: true };
    const withOnlyEcho = new Transcript([
      { type: 'run-start', budgets: { standby_current_ua: 20 } },
      { type: 'refusal', reason: 'cannot do this' },
      { type: 'run-end', exitPath: 'refused' },
    ]);
    const withCitation = new Transcript([
      { type: 'run-start', budgets: { standby_current_ua: 20 } },
      { type: 'refusal', reason: '180uA exceeds the standby_current_ua budget of 20uA' },
      { type: 'run-end', exitPath: 'refused' },
    ]);
    expect((await evaluate(spec, { ...fakeEvidence(), transcript: withOnlyEcho })).status).toBe('fail');
    expect((await evaluate(spec, { ...fakeEvidence(), transcript: withCitation })).status).toBe('pass');
  });

  it('scores an unevaluable required assertion as neither pass nor fail', () => {
    const outcomes: Outcome[] = [
      { id: 'a', type: 'net_present', status: 'pass', weight: 1, required: true, detail: '' },
      { id: 'b', type: 'erc_clean', status: 'unevaluable', weight: 1, required: true, detail: '' },
    ];
    const score = scoreRun(outcomes, fakeEvidence());
    expect(score.verdict).toBe('unscoreable');
    expect(score.partialCredit).toBeCloseTo(0.5);
  });

  it('prefers fail over unscoreable when something actually failed', () => {
    const outcomes: Outcome[] = [
      { id: 'a', type: 'net_present', status: 'fail', weight: 1, required: true, detail: '' },
      { id: 'b', type: 'erc_clean', status: 'unevaluable', weight: 1, required: true, detail: '' },
    ];
    expect(scoreRun(outcomes, fakeEvidence()).verdict).toBe('fail');
  });
});

describe('the scorer does not appear in its own evidence', () => {
  // kicad-cli writes .kicad_prl beside the file it reads. Running it on the
  // sandbox mutated the tree the diff assertions grade, so
  // files_touched_subset failed on an artifact the scorer created. Verification
  // now runs against a copy.
  it.skipIf(!kicadCliAvailable())('leaves the project directory untouched when running DRC', () => {
    const dir = tmp();
    cpSync(path.join(REPO, 'fixtures', 'antmicro-microphone-board', 'tree'), dir, { recursive: true });
    const before = readdirSync(path.join(dir, 'hardware')).sort();
    runDrc(path.join(dir, 'hardware', 'microphone-board.kicad_pcb'), dir);
    expect(readdirSync(path.join(dir, 'hardware')).sort()).toEqual(before);
  });
});

describe('the closed vocabulary is structural', () => {
  it('raises on an unknown assertion type rather than skipping it', async () => {
    await expect(
      evaluate(
        { id: 'x', type: 'vibes_are_good', weight: 1, required: true },
        fakeEvidence(),
      ),
    ).rejects.toThrow(/unknown assertion type/);
  });

  it('has a handler for every type in the schema vocabulary', () => {
    // If the schema gains a type and the scorer does not, a task can declare a
    // check nothing evaluates. This is the test that keeps them in step.
    const schema = JSON.parse(
      readFileSync(path.join(REPO, 'schema', 'assertions.schema.json'), 'utf8'),
    ) as { $defs: { assertion: { oneOf: Array<{ properties?: { type?: { const?: string; enum?: string[] } } }> } } };

    // Read the vocabulary structurally, from the `type` property of each oneOf
    // branch. A regex over the whole file also catches enum values belonging to
    // other fields, such as exit paths and severities.
    const types = schema.$defs.assertion.oneOf.flatMap((branch) => {
      const t = branch.properties?.type;
      if (!t) return [];
      return t.const !== undefined ? [t.const] : (t.enum ?? []);
    });
    for (const t of types) {
      expect(Object.keys(HANDLERS), `no handler for assertion type ${t}`).toContain(t);
    }
    expect(types.length).toBeGreaterThan(15);
  });
});

describe('record writing', () => {
  it('hard-fails on a planted credential instead of scrubbing it', () => {
    const dir = tmp();
    // The Google key is the case that matters: copperhead's write-time
    // redaction does not cover AIza, so this scan is the only thing between a
    // Gemini key and published output.
    const record = { note: `key=AIza${'a'.repeat(35)}` };
    expect(() => writeRecord(dir, record, 'r.json')).toThrow(SecretInRecordError);
  });

  it('covers every credential kind in the pattern set', () => {
    const dir = tmp();
    const samples: Array<[string, string]> = [
      ['openai-or-anthropic', `sk-${'a'.repeat(24)}`],
      ['google', `AIza${'b'.repeat(35)}`],
      ['bearer', `Bearer ${'c'.repeat(20)}`],
      ['npm', `npm_${'d'.repeat(36)}`],
      ['github', `ghp_${'e'.repeat(36)}`],
    ];
    for (const [kind, secret] of samples) {
      expect(() => writeRecord(dir, { note: secret }, `${kind}.json`), kind).toThrow(SecretInRecordError);
    }
  });

  it('is append-only', () => {
    const dir = tmp();
    writeRecord(dir, sampleRecord(), 'r.json');
    expect(() => writeRecord(dir, sampleRecord(), 'r.json')).toThrow(/append-only/);
  });

  it('refuses a record that does not satisfy schema/result.schema.json', () => {
    // The schema is the contract a third party reads a record by. A record
    // that the schema rejects must never reach results/.
    const dir = tmp();
    expect(() => writeRecord(dir, { ok: true }, 'r.json')).toThrow(RecordSchemaError);
    const missingStamp = sampleRecord();
    delete missingStamp['comparability'];
    expect(() => writeRecord(dir, missingStamp, 's.json')).toThrow(RecordSchemaError);
  });

  it('gives a second run on the same day the next run number', () => {
    // Records are append-only, so the second run of a day must land beside
    // the first rather than collide with it and abort the matrix.
    const results = tmp();
    const first = runCli(['--mode', 'gold', '--task', 'do-budget-refusal-pullup', '--results', results]);
    const second = runCli(['--mode', 'gold', '--task', 'do-budget-refusal-pullup', '--results', results]);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const date = new Date().toISOString().slice(0, 10);
    const dir = path.join(results, date, 'harness-gold', 'do-budget-refusal-pullup');
    expect(readdirSync(dir).sort()).toEqual(['run-1.json', 'run-2.json']);
    const rec = JSON.parse(readFileSync(path.join(dir, 'run-2.json'), 'utf8')) as { run: { repeat: number } };
    expect(rec.run.repeat).toBe(2);
  });

  it('stamps comparability on every record', () => {
    const rec = sampleRecord();
    const stamp = rec['comparability'] as Record<string, unknown>;
    for (const key of ['schemaVersion', 'suiteVersion', 'taskManifestHash', 'fixtureSha256', 'copperheadVersion', 'nodeVersion', 'platform']) {
      expect(stamp[key], key).toBeDefined();
    }
    // llmCache off is recorded, because a cached turn would manufacture
    // determinism the model does not have.
    expect((rec['run'] as Record<string, unknown>)['llmCache']).toBe(false);
  });

  it('changes the task manifest hash when a manifest changes', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'task.json'), '{"id":"a"}');
    writeFileSync(path.join(dir, 'assertions.json'), '[]');
    const before = taskManifestHash(dir);
    writeFileSync(path.join(dir, 'task.json'), '{"id":"b"}');
    expect(taskManifestHash(dir)).not.toBe(before);
  });
});

describe('re-scoring', () => {
  it('reproduces recorded verdicts with no provider and no network', () => {
    const results = tmp();
    runCli(['--mode', 'gold', '--task', 'do-budget-refusal-pullup', '--results', results]);
    const r = runCli(['--rescore', results]);
    expect(r.out).toContain('1 re-scored, 0 not comparable, 0 drift(s)');
    expect(r.code).toBe(0);
  });

  it('segregates a record from another kicad-cli environment instead of calling it drift', () => {
    // The comparability stamp exists so an environment difference is never
    // reported as a failed reproduction (STANDARD.md section 9).
    const results = tmp();
    runCli(['--mode', 'gold', '--task', 'do-budget-refusal-pullup', '--results', results]);
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(results, date, 'harness-gold', 'do-budget-refusal-pullup', 'run-1.json');
    const rec = JSON.parse(readFileSync(file, 'utf8')) as { comparability: { kicadCliVersion: string | null } };
    rec.comparability.kicadCliVersion = rec.comparability.kicadCliVersion === null ? '7.0.0' : null;
    writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    const r = runCli(['--rescore', results]);
    expect(r.out).toContain('0 re-scored, 1 not comparable, 0 drift(s)');
    expect(r.out).toContain('SKIP');
    expect(r.code).toBe(0);
  });
});

describe('the runner refuses what it cannot honestly do', () => {
  it('does not pretend to run an agent without a provider', () => {
    const r = runCli(['--mode', 'agent']);
    expect(r.out).toContain('not implemented');
    expect(r.code).toBe(2);
  });

  it('prints a plan and spends nothing on --dry-run', () => {
    const r = runCli(['--mode', 'noop', '--dry-run']);
    expect(r.out).toContain('estimated provider cost: $0.00');
    expect(r.code).toBe(0);
  });
});

function sampleRecord(): Record<string, unknown> {
  return buildRecord(REPO, {
    taskId: 't', tier: 'simple', mode: 'do', expectedOutcome: 'edit',
    model: 'harness:gold', repeat: 1, fixtureId: 'f', fixtureSha256: 'a'.repeat(64),
    taskManifestHash: 'b'.repeat(64), baselineSha: 'c'.repeat(40), runMode: 'gold',
    llmCache: false, setupSkipped: [], durationMs: 1,
    score: {
      verdict: 'pass', partialCredit: 1, firstFailedRequired: undefined, failureCategory: undefined,
      outcomes: [{ id: 'a', type: 'net_present', status: 'pass', weight: 1, required: true, detail: '' }],
    },
  });
}

function fakeEvidence(): Evidence {
  return {
    endState: { dir: '', schematicPath: '' } as never,
    diff: {} as never,
    transcript: new Transcript([]),
    baseline: {},
    kicadAvailable: false,
    boardPath: null,
  };
}
