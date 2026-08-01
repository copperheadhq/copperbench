import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AssertionManifest, FixtureManifest } from '../types.js';
import { loadTask } from '../runner/plan.js';
import { scoreRun, type ScoreResult } from './score.js';

/**
 * Minimal shape read back out of a written result record — only the fields
 * rescoring actually needs, kept in lockstep with schema/result.schema.json.
 * A full result-record type belongs to the record writer (tasks.md 5.1),
 * which hasn't landed yet; this is deliberately narrower.
 */
export interface ResultRecordForRescore {
  task: { id: string };
  run: { baselineCommit: string };
  verdict: { pass: boolean; partialCredit: number };
  stats: { exitPath: string };
  artifacts: { transcriptPath: string; sandboxPreserved: boolean; sandboxPath: string | null };
}

export interface RescoreOutcome {
  resultPath: string;
  taskId: string;
  originalVerdict: { pass: boolean; partialCredit: number };
  recomputed: ScoreResult;
  matches: boolean;
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
 * that stored value rather than needing a separate raw field, since the
 * record-writer (tasks.md 5.1) hasn't landed yet to define one.
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
  const sandboxPath = record.artifacts.sandboxPath;
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

  return {
    resultPath,
    taskId: record.task.id,
    originalVerdict: record.verdict,
    recomputed,
    matches:
      recomputed.verdict.pass === record.verdict.pass &&
      recomputed.verdict.partialCredit === record.verdict.partialCredit,
  };
}

export async function rescoreAll(repoRoot: string, resultsPath: string): Promise<RescoreOutcome[]> {
  const files = await findResultFiles(resultsPath);
  const outcomes: RescoreOutcome[] = [];
  for (const f of files) outcomes.push(await rescoreResult(repoRoot, f));
  return outcomes;
}
