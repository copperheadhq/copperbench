#!/usr/bin/env node
// The benchmark runner (tasks.md 3.x, 4.x, 5.1).
//
// Two provider-free run modes ship first, on purpose:
//
//   --mode noop   the agent does nothing. Every discriminating assertion must
//                 FAIL. This is the negative half of the two-sided invariant:
//                 an assertion set that passes on a no-op is not grading
//                 anything.
//   --mode gold   apply a recorded reference solution. Every assertion must
//                 PASS. The positive half.
//
// Together they prove the suite discriminates before a single token is spent.
// `--mode agent` is where a real provider run lands (tasks.md 3.2); it is not
// implemented, and the runner says so rather than pretending.
//
// Usage:
//   npm run benchmark -- --validate
//   npm run benchmark -- --mode gold --task do-budget-refusal-pullup
//   npm run benchmark -- --mode noop --dry-run
//   npm run benchmark -- --rescore results/<date>

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, type AssertionSpec, type Outcome } from './lib/assertions.ts';
import { DiffEvidence, EndState, Transcript, type Evidence } from './lib/evidence.ts';
import { git } from './lib/git.ts';
import { buildRecord, taskManifestHash, writeRecord, detectKicadCliVersion } from './lib/record.ts';
import { materialize, type Sandbox } from './lib/sandbox.ts';
import { scoreRun, type Score } from './lib/score.ts';
import { validateSuite } from './validate.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type RunMode = 'noop' | 'gold' | 'agent';

interface Task {
  id: string;
  dir: string;
  manifest: Record<string, any>;
  assertions: AssertionSpec[];
}

interface GoldSolution {
  /** Files written verbatim, path relative to the sandbox. */
  files?: Record<string, string>;
  /** Surgical in-place replacements, the shape a real edit takes. */
  replacements?: Array<{ path: string; from: string; to: string; all?: boolean }>;
  /** Transcript events installed as the run's evidence. */
  transcript: Array<Record<string, unknown>>;
  /** Whether the run commits its work. */
  commit?: boolean;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function loadTasks(filter?: string | undefined): Task[] {
  const root = path.join(REPO, 'tasks');
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => filter === undefined || name === filter)
    .sort()
    .map((name) => {
      const dir = path.join(root, name);
      return {
        id: name,
        dir,
        manifest: JSON.parse(readFileSync(path.join(dir, 'task.json'), 'utf8')),
        assertions: JSON.parse(readFileSync(path.join(dir, 'assertions.json'), 'utf8')) as AssertionSpec[],
      };
    });
}

function loadGold(taskId: string): GoldSolution | undefined {
  // Reference solutions live OUTSIDE tasks/, because a task is task.json,
  // assertions.json and README.md and nothing else (STANDARD.md section 2).
  const file = path.join(REPO, 'test', 'gold', `${taskId}.json`);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as GoldSolution;
}

// ---------------------------------------------------------------------------
// Run modes
// ---------------------------------------------------------------------------

function writeTranscript(sandboxDir: string, events: Array<Record<string, unknown>>): void {
  const stamp = '20260906T000000Z';
  const dir = path.join(sandboxDir, '.copperhead', 'runs', stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'transcript.jsonl'),
    `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
}

/** The agent does nothing but claim it finished. */
function runNoop(sandbox: Sandbox, task: Task): void {
  writeTranscript(sandbox.dir, [
    { type: 'run-start', task: task.id, mode: task.manifest['mode'], llmCache: false },
    { type: 'run-end', exitPath: 'done', turns: 0, repairCycles: 0 },
  ]);
}

function runGold(sandbox: Sandbox, task: Task, gold: GoldSolution): void {
  for (const [rel, body] of Object.entries(gold.files ?? {})) {
    const abs = path.join(sandbox.dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }

  for (const r of gold.replacements ?? []) {
    const abs = path.join(sandbox.dir, r.path);
    const before = readFileSync(abs, 'utf8');
    const after = r.all === false ? before.replace(r.from, r.to) : before.split(r.from).join(r.to);
    if (after === before) {
      throw new Error(`gold replacement for ${task.id} matched nothing in ${r.path}: ${r.from}`);
    }
    writeFileSync(abs, after);
  }

  writeTranscript(sandbox.dir, gold.transcript);

  if (gold.commit !== false) {
    git(sandbox.dir, ['add', '-A']);
    git(sandbox.dir, ['commit', '-q', '-m', `gold: ${task.id}`, '--allow-empty']);
  }
}

// ---------------------------------------------------------------------------
// Scoring one run
// ---------------------------------------------------------------------------

async function scoreSandbox(sandbox: Sandbox, task: Task, fixture: Record<string, any>): Promise<Score> {
  const schematic = fixture['artifacts']?.schematic ?? '';
  const evidence: Evidence = {
    endState: new EndState(sandbox.dir, schematic),
    diff: new DiffEvidence(sandbox.dir, sandbox.baselineSha),
    transcript: Transcript.fromSandbox(sandbox.dir),
    baseline: fixture['baseline'] ?? {},
    kicadAvailable: detectKicadCliVersion() !== null,
  };

  const outcomes: Outcome[] = [];
  for (const spec of task.assertions) {
    outcomes.push(await evaluate(spec, evidence));
  }
  return scoreRun(outcomes, evidence);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes('--validate')) {
    const r = validateSuite(REPO);
    for (const f of r.findings) console.error(`FAIL ${f.where}: ${f.what}`);
    console.log(r.ok ? `ok  ${r.fixtures} fixtures, ${r.tasks} tasks, 0 findings` : `${r.findings.length} findings`);
    return r.ok ? 0 : 1;
  }

  const rescoreDir = arg(argv, '--rescore');
  if (rescoreDir !== undefined) return rescore(path.resolve(REPO, rescoreDir));

  const mode = (arg(argv, '--mode') ?? 'noop') as RunMode;
  if (mode === 'agent') {
    console.error('--mode agent is not implemented (tasks.md 3.2): it needs a provider credential.');
    console.error('The provider-free modes are --mode noop and --mode gold.');
    return 2;
  }

  const tasks = loadTasks(arg(argv, '--task'));
  if (tasks.length === 0) {
    console.error('no tasks matched');
    return 1;
  }

  // A suite that does not validate is never run against.
  const validation = validateSuite(REPO);
  if (!validation.ok) {
    console.error('suite validation failed; refusing to run');
    for (const f of validation.findings) console.error(`  ${f.where}: ${f.what}`);
    return 1;
  }

  if (argv.includes('--dry-run')) {
    console.log(`plan: ${tasks.length} task(s), mode=${mode}, model=${mode}, repeats=1`);
    for (const t of tasks) console.log(`  ${t.id}  [${t.manifest['tier']}]  ${t.assertions.length} assertions`);
    console.log('estimated provider cost: $0.00 (no provider is called in this mode)');
    return 0;
  }

  // Overridable so tests write to a temp directory rather than colliding with
  // the repository's append-only records.
  const resultsDir = path.resolve(REPO, arg(argv, '--results') ?? 'results');
  const date = new Date().toISOString().slice(0, 10);
  let failures = 0;

  for (const task of tasks) {
    const fixtureDir = path.join(REPO, task.manifest['fixture'].path);
    const fixture = JSON.parse(readFileSync(path.join(fixtureDir, 'fixture.json'), 'utf8'));

    const gold = mode === 'gold' ? loadGold(task.id) : undefined;
    if (mode === 'gold' && !gold) {
      console.log(`skip ${task.id}: no reference solution at test/gold/${task.id}.json`);
      continue;
    }

    const started = Date.now();
    const sandbox = materialize({
      treeDir: path.join(fixtureDir, 'tree'),
      config: task.manifest['config'],
      setupCommands: task.manifest['setup']?.commands,
      // copperhead init hard-requires kicad-cli, so setup is recorded as
      // skipped rather than silently treated as having run.
      runSetup: () => false,
    });

    try {
      if (mode === 'noop') runNoop(sandbox, task);
      else if (gold) runGold(sandbox, task, gold);

      const score = await scoreSandbox(sandbox, task, fixture);
      const record = buildRecord(REPO, {
        taskId: task.id,
        tier: task.manifest['tier'],
        mode: task.manifest['mode'],
        expectedOutcome: task.manifest['expectedOutcome'],
        model: `harness:${mode}`,
        repeat: 1,
        fixtureId: fixture['id'],
        fixtureSha256: fixture['sha256'],
        taskManifestHash: taskManifestHash(task.dir),
        baselineSha: sandbox.baselineSha,
        runMode: mode,
        llmCache: false,
        setupSkipped: sandbox.setupSkipped,
        durationMs: Date.now() - started,
        score,
      });

      const rel = path.join(date, `harness-${mode}`, task.id, 'run-1.json');
      const written = writeRecord(resultsDir, record, rel);

      report(task, score, path.relative(REPO, written), sandbox);
      if (score.verdict !== 'pass') failures += 1;
    } finally {
      sandbox.cleanup();
    }
  }

  return failures > 0 ? 1 : 0;
}

/**
 * Re-score published records with no provider and no network (STANDARD.md
 * section 14). The provider-free run modes are deterministic, so reproduction
 * means re-materializing each recorded run and checking that every assertion
 * outcome comes back identical. A drift here means a published number can no
 * longer be reproduced from the repository, which is the claim this project
 * rests on.
 */
async function rescore(dir: string): Promise<number> {
  const records: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) records.push(full);
    }
  };
  if (!existsSync(dir)) {
    console.error(`no such results directory: ${path.relative(REPO, dir)}`);
    return 1;
  }
  walk(dir);

  let drift = 0;
  for (const file of records.sort()) {
    const rec = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
    const taskId: string = rec['task'].id;
    const runMode = rec['run'].runMode as RunMode;
    const [task] = loadTasks(taskId);
    if (!task) {
      console.error(`DRIFT ${taskId}: task no longer exists in the suite`);
      drift += 1;
      continue;
    }

    // A manifest edit invalidates comparison rather than silently re-grading.
    const nowHash = taskManifestHash(task.dir);
    if (nowHash !== rec['comparability'].taskManifestHash) {
      console.error(`DRIFT ${taskId}: task manifest changed since the record was written`);
      drift += 1;
      continue;
    }

    const fixtureDir = path.join(REPO, task.manifest['fixture'].path);
    const fixture = JSON.parse(readFileSync(path.join(fixtureDir, 'fixture.json'), 'utf8'));
    const sandbox = materialize({
      treeDir: path.join(fixtureDir, 'tree'),
      config: task.manifest['config'],
      setupCommands: task.manifest['setup']?.commands,
      runSetup: () => false,
    });
    try {
      if (runMode === 'noop') runNoop(sandbox, task);
      else {
        const gold = loadGold(task.id);
        if (!gold) throw new Error(`no reference solution for ${task.id}`);
        runGold(sandbox, task, gold);
      }
      const score = await scoreSandbox(sandbox, task, fixture);

      const before = (rec['assertions'] as Outcome[]).map((o) => `${o.id}=${o.status}`).join(',');
      const after = score.outcomes.map((o) => `${o.id}=${o.status}`).join(',');
      const ok = before === after && rec['verdict'] === score.verdict;
      console.log(`${ok ? 'ok    ' : 'DRIFT '}${path.relative(REPO, file)}  ${score.verdict}`);
      if (!ok) {
        console.error(`  recorded ${rec['verdict']}: ${before}`);
        console.error(`  now      ${score.verdict}: ${after}`);
        drift += 1;
      }
    } finally {
      sandbox.cleanup();
    }
  }

  console.log(`\n${records.length} record(s) re-scored, ${drift} drift(s), no provider and no network`);
  return drift > 0 ? 1 : 0;
}

function report(task: Task, score: Score, recordPath: string, sandbox: Sandbox): void {
  const tag = { pass: 'PASS', fail: 'FAIL', unscoreable: 'UNSCOREABLE' }[score.verdict];
  console.log(`\n${tag}  ${task.id}`);
  for (const s of sandbox.setupSkipped) {
    // Loud, because a run whose declared setup did not happen did not start
    // from the state the task assumes. Such a record must never be compared
    // against one from a complete environment.
    console.log(`  WARN setup "${s.command}" was skipped: ${s.reason}`);
  }
  for (const o of score.outcomes) {
    const mark = { pass: ' ok ', fail: 'FAIL', unevaluable: ' -- ' }[o.status];
    console.log(`  ${mark} ${o.id.padEnd(28)} ${o.detail}`);
  }
  console.log(`  partial credit ${(score.partialCredit * 100).toFixed(0)}%` +
    (score.failureCategory ? `, category ${score.failureCategory}` : ''));
  console.log(`  record ${recordPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

export { loadTasks, scoreSandbox };
