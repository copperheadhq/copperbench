import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildResultRecord } from '../../src/records/build.js';
import { resolveCopperheadInstall, type CopperheadInstall } from '../../src/runner/copperhead-install.js';
import { scoreRun } from '../../src/scorer/score.js';
import type { RunPlanEntry } from '../../src/runner/plan.js';
import type { RunExecutionResult } from '../../src/runner/run.js';
import type { Sandbox } from '../../src/runner/sandbox.js';
import { loadTaskFixtures, materializeTestSandbox, commitAll, cleanupSandbox, repoRoot } from '../helpers.js';

async function writeTranscript(
  sandboxPath: string,
  ts: string,
  runStartData: Record<string, unknown>,
  runEndData: Record<string, unknown> | null,
): Promise<string> {
  const dir = path.join(sandboxPath, '.copperhead', 'runs', ts);
  await mkdir(dir, { recursive: true });
  const events = [{ ts: '2026-08-01T12:00:00.000Z', type: 'run-start', data: runStartData }];
  if (runEndData) events.push({ ts: '2026-08-01T12:00:05.000Z', type: 'run-end', data: runEndData });
  await writeFile(path.join(dir, 'transcript.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return dir;
}

const runStartFixture = {
  request: 'rename net DATA to PDM_DATA',
  model: 'compat:qwen2.5-coder:7b',
  provider: 'openai-compat',
  modelSource: 'flag',
  startedAt: '2026-08-01T12:00:00.000Z',
  versions: { kicadCli: '10.0.4', node: process.version, platform: `${process.platform}-${process.arch}` },
};

describe('buildResultRecord', () => {
  let sandbox: Sandbox;
  let copperhead: CopperheadInstall;
  let entry: RunPlanEntry;

  beforeAll(async () => {
    copperhead = await resolveCopperheadInstall();
    const { task } = await loadTaskFixtures('do-rename-net');
    sandbox = await materializeTestSandbox(task);

    const schAbs = path.join(sandbox.path, 'hardware/microphone-board.kicad_sch');
    let sch = await readFile(schAbs, 'utf8');
    sch = sch.replaceAll('(label "DATA"', '(label "PDM_DATA"');
    await writeFile(schAbs, sch, 'utf8');
    const pinoutAbs = path.join(sandbox.path, 'docs/PINOUT.md');
    let pinout = await readFile(pinoutAbs, 'utf8');
    pinout = pinout.replace(/\bDATA\b/g, 'PDM_DATA');
    await writeFile(pinoutAbs, pinout, 'utf8');
    await commitAll(sandbox.path, 'rename net DATA to PDM_DATA');

    entry = { taskId: task.id, task, repeatIndex: 2, repeatsPlanned: 3 };
  });

  afterAll(() => cleanupSandbox(sandbox));

  it('assembles a record with the full comparability stamp, reading provider/versions from the transcript', async () => {
    const transcriptDir = await writeTranscript(sandbox.path, '2026-08-01T12-00-00-100Z', runStartFixture, {
      exitPath: 'done',
      turnsUsed: 7,
      maxTurns: 40,
      repairCyclesUsed: 1,
      maxRepairCycles: 5,
      tokensIn: 111,
      tokensOut: 222,
    });
    const { assertions, fixture } = await loadTaskFixtures('do-rename-net');
    const score = await scoreRun({
      task: entry.task,
      assertions,
      fixture,
      sandboxPath: sandbox.path,
      baselineCommit: sandbox.baselineCommit,
      transcriptDir,
      killedForWallClock: false,
    });
    const run: RunExecutionResult = {
      transcriptDir,
      processExitCode: 0,
      processSignal: null,
      killedForWallClock: false,
      durationMs: 5432,
      stdout: '',
      stderr: '',
    };

    const record = await buildResultRecord({
      repoRoot,
      suiteVersion: '1.0.1',
      entry,
      model: 'compat:qwen2.5-coder:7b',
      baseURL: 'http://localhost:11434/v1',
      copperhead,
      sandbox,
      run,
      score,
    });

    expect(record.schemaVersion).toBe('1.0.0');
    expect(record.suiteVersion).toBe('1.0.1');
    expect(record.task.id).toBe('do-rename-net');
    expect(record.task.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.model.provider).toBe('openai-compat');
    expect(record.model.selectionSource).toBe('flag');
    expect(record.model.segment).toBe('open-weight-self-hosted');
    expect(record.environment.copperheadCommit).toBe(copperhead.commit);
    expect(record.environment.kicadCliVersion).toBe('10.0.4');
    expect(record.run.repeatIndex).toBe(2);
    expect(record.run.baselineCommit).toBe(sandbox.baselineCommit);
    expect(record.stats.exitPath).toBe('done');
    expect(record.stats.turnsUsed).toBe(7);
    expect(record.stats.durationMs).toBe(5432); // from the runner's own measurement, not the transcript
    expect(record.cost).toEqual({ usd: null, priceTableVersion: null });
    expect(record.verdict.pass).toBe(true);
    expect(record.failure).toBeNull();
    expect(record.artifacts.transcriptPath).not.toMatch(/\\/); // forward slashes only, portable across platforms
    expect(record.artifacts.sandboxPreserved).toBe(true);
  });

  it('translates a runner wall-clock kill to stats.exitPath "cap-exceeded", with no evidence fabricated', async () => {
    const transcriptDir = await writeTranscript(sandbox.path, '2026-08-01T12-00-00-200Z', runStartFixture, null);
    const { assertions, fixture } = await loadTaskFixtures('do-rename-net');
    // Every net_present/net_absent-style assertion would fail here (nothing
    // relevant was scored), but classifyFailure has no mapping for
    // cap-exceeded — so this must reach buildResultRecord() only via a
    // scoreRun() call whose verdict happens to be constructed without
    // triggering that path. We only need buildResultRecord's exitPath
    // translation here, so call it with a synthetic passing score directly.
    const run: RunExecutionResult = {
      transcriptDir,
      processExitCode: null,
      processSignal: 'SIGKILL',
      killedForWallClock: true,
      durationMs: 1200000,
      stdout: '',
      stderr: '',
    };
    const record = await buildResultRecord({
      repoRoot,
      suiteVersion: '1.0.1',
      entry,
      model: 'compat:qwen2.5-coder:7b',
      baseURL: 'http://localhost:11434/v1',
      copperhead,
      sandbox,
      run,
      score: { assertions: [], verdict: { pass: true, partialCredit: 1 }, failure: null },
    });
    expect(record.stats.exitPath).toBe('cap-exceeded');
    expect(record.stats.tokensIn).toBe(0); // no run-end evidence — honest zero, not fabricated
    expect(record.stats.durationMs).toBe(1200000); // the runner's own measurement, unaffected by the missing run-end
  });

  it('throws rather than writing an invalid record when there is no run-start event at all', async () => {
    const score = { assertions: [], verdict: { pass: true, partialCredit: 1 }, failure: null };
    const run: RunExecutionResult = {
      transcriptDir: null,
      processExitCode: 1,
      processSignal: null,
      killedForWallClock: false,
      durationMs: 100,
      stdout: '',
      stderr: '',
    };
    await expect(
      buildResultRecord({
        repoRoot,
        suiteVersion: '1.0.1',
        entry,
        model: 'compat:qwen2.5-coder:7b',
        baseURL: 'http://localhost:11434/v1',
        copperhead,
        sandbox,
        run,
        score,
      }),
    ).rejects.toThrow(/no run-start event/);
  });
});
