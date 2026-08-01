import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssertionManifest, FixtureManifest } from '../types.js';
import { loadTask } from '../runner/plan.js';
import { scoreRun, type ScoreResult } from './score.js';

/**
 * Minimal shape read back out of a written result record — only the fields
 * rescoring actually needs, deliberately narrower than the full ResultRecord
 * type (src/records/build.ts), and kept in lockstep with
 * schema/result.schema.json by hand rather than importing that type, since
 * rescoring only ever reads a record, never builds one.
 */
export interface ResultRecordForRescore {
  task: { id: string };
  run: { baselineCommit: string };
  verdict: { pass: boolean; partialCredit: number };
  stats: { exitPath: string };
  failure: { category: string } | null;
  assertions: { id: string; passed: boolean }[];
  artifacts: { transcriptPath: string; sandboxPreserved: boolean; sandboxPath: string | null };
}

export interface RescoreOutcome {
  resultPath: string;
  taskId: string;
  originalVerdict: { pass: boolean; partialCredit: number };
  recomputed: ScoreResult;
  matches: boolean;
}

export interface RescoreFailure {
  resultPath: string;
  error: string;
}

/** Recursively finds every `run-<n>.json` under a results directory
 * (STANDARD.md section 13's `results/<date>/<model>/<task-id>/run-<n>.json`
 * layout), or treats a single file path as a one-file "directory". */
export async function findResultFiles(resultsPath: string): Promise<string[]> {
  const stat = await readdir(resultsPath, { withFileTypes: true }).catch(() => null);
  if (!stat) return [resultsPath]; // not a directory — treat as a single result file
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/^run-\d+\.json$/.test(entry.name)) out.push(full);
    }
  }
  await walk(resultsPath);
  return out.sort();
}

/**
 * STANDARD.md section 14 / design D2: re-evaluates one preserved result
 * record with no provider credential and no network. `--stats.exitPath ===
 * "cap-exceeded"` is how a runner-enforced wall-clock kill (STANDARD.md
 * section 3.3) is expected to surface in a written record (design decision
 * from the 3.2/4.4 write-ups) — rescoring derives `killedForWallClock` from
 * that stored value rather than needing a separate raw field.
 */
export async function rescoreResult(repoRoot: string, resultPath: string): Promise<RescoreOutcome> {
  const record = JSON.parse(await readFile(resultPath, 'utf8')) as ResultRecordForRescore;

  const task = await loadTask(repoRoot, record.task.id);
  const assertions = JSON.parse(
    await readFile(path.join(repoRoot, 'tasks', record.task.id, 'assertions.json'), 'utf8'),
  ) as AssertionManifest[];
  const fixture = JSON.parse(
    await readFile(path.join(repoRoot, task.fixture.path, 'fixture.json'), 'utf8'),
  ) as FixtureManifest;

  if (!record.artifacts.sandboxPreserved || !record.artifacts.sandboxPath) {
    throw new Error(`result ${resultPath} has no preserved sandbox; rescoring is not possible for it`);
  }
  // artifacts.sandboxPath stores only the mkdtemp basename (never the full
  // host path — that would leak a local username into a committed record),
  // reconstructed here against this machine's own temp root. Rescoring a
  // preserved sandbox therefore only works on the machine that wrote it,
  // which was already true in practice: the sandbox itself is never
  // published, only the record referencing it.
  const sandboxPath = path.join(tmpdir(), record.artifacts.sandboxPath);
  const transcriptDir = record.artifacts.transcriptPath ? path.join(sandboxPath, record.artifacts.transcriptPath) : null;

  const recomputed = await scoreRun({
    task,
    assertions,
    fixture,
    sandboxPath,
    baselineCommit: record.run.baselineCommit,
    transcriptDir,
    killedForWallClock: record.stats.exitPath === 'cap-exceeded',
  });

  // Comparing only pass/partialCredit would miss a classifier change that
  // reassigns the SAME failing run to a different failure category, or an
  // assertion that flips outcome while another flips the opposite way and
  // the aggregate credit happens to land unchanged — both are genuine
  // reproducibility breaks that STANDARD.md section 14 exists to catch.
  const sameFailureCategory = (record.failure?.category ?? null) === (recomputed.failure?.category ?? null);
  const sameAssertionOutcomes =
    record.assertions.length === recomputed.assertions.length &&
    record.assertions.every((a) => recomputed.assertions.find((r) => r.id === a.id)?.passed === a.passed);

  return {
    resultPath,
    taskId: record.task.id,
    originalVerdict: record.verdict,
    recomputed,
    matches:
      recomputed.verdict.pass === record.verdict.pass &&
      recomputed.verdict.partialCredit === record.verdict.partialCredit &&
      sameFailureCategory &&
      sameAssertionOutcomes,
  };
}

export async function rescoreAll(
  repoRoot: string,
  resultsPath: string,
): Promise<{ outcomes: RescoreOutcome[]; failures: RescoreFailure[] }> {
  const files = await findResultFiles(resultsPath);
  const outcomes: RescoreOutcome[] = [];
  const failures: RescoreFailure[] = [];
  for (const f of files) {
    try {
      outcomes.push(await rescoreResult(repoRoot, f));
    } catch (err) {
      // One record with a pruned/missing sandbox (a realistic state for
      // anything preserved long enough — the OS temp-cleaner eventually
      // takes it) must not abort every other record's rescore in the same
      // batch; report it and keep going.
      failures.push({ resultPath: f, error: (err as Error).message });
    }
  }
  return { outcomes, failures };
}
