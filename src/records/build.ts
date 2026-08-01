import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CopperheadInstall } from '../runner/copperhead-install.js';
import type { RunExecutionResult } from '../runner/run.js';
import type { RunPlanEntry } from '../runner/plan.js';
import type { Sandbox } from '../runner/sandbox.js';
import { classifyModel } from '../runner/cost.js';
import type { ScoreResult } from '../scorer/score.js';
import { readTranscript, type TranscriptEvidence } from '../scorer/evidence/transcript.js';
import type { ResultRecord } from '../types.js';

// The JSON envelope's own shape (schema/result.schema.json), bumped only
// when that schema changes — independent of suiteVersion, which tracks
// task/fixture/vocabulary content (STANDARD.md section 9). No revision to
// result.schema.json has happened yet, so this is the first value.
export const SCHEMA_VERSION = '1.0.0';

async function manifestSha256(repoRoot: string, taskId: string): Promise<string> {
  const raw = await readFile(path.join(repoRoot, 'tasks', taskId, 'task.json'));
  return createHash('sha256').update(raw).digest('hex');
}

interface RunStartData {
  provider?: string;
  modelSource?: string;
  startedAt?: string;
  versions?: { kicadCli?: string | null; node?: string; platform?: string };
}

/**
 * Assembles one result record from everything the run/score pipeline
 * produced. Reads provider/selectionSource/kicadCliVersion/node/platform
 * from the transcript's `run-start` event rather than probing the current
 * process (STANDARD.md section 4 / design D3: the transcript is evidence,
 * not something to re-derive) — `run-start` is written before anything else
 * in a run, including before a wall-clock kill could plausibly land, so
 * it's present even when `run-end` is not.
 */
export async function buildResultRecord(opts: {
  repoRoot: string;
  suiteVersion: string;
  entry: RunPlanEntry;
  model: string;
  baseURL: string | undefined;
  copperhead: CopperheadInstall;
  sandbox: Sandbox;
  run: RunExecutionResult;
  score: ScoreResult;
}): Promise<ResultRecord> {
  const { repoRoot, suiteVersion, entry, model, baseURL, copperhead, sandbox, run, score } = opts;

  const transcript: TranscriptEvidence = await readTranscript(run.transcriptDir);
  const runStart = transcript.runStart?.data as RunStartData | undefined;
  if (!runStart) {
    throw new Error(
      `cannot build a result record for ${entry.taskId} repeat ${entry.repeatIndex}: no run-start event in the ` +
        `transcript (${run.transcriptDir ?? 'no transcript directory at all'}) — this is a pre-run environment ` +
        'failure, not a benchmarkable outcome, and has no valid record representation.',
    );
  }

  const exitPath = run.killedForWallClock
    ? ('cap-exceeded' as const)
    : (transcript.runEnd?.data as { exitPath?: ResultRecord['stats']['exitPath'] } | undefined)?.exitPath;
  if (!exitPath) {
    throw new Error(
      `cannot build a result record for ${entry.taskId} repeat ${entry.repeatIndex}: no run-end event and the ` +
        'runner did not kill the process for a wall-clock breach either — this exit condition has no valid ' +
        'stats.exitPath representation. Investigate before writing a record for it.',
    );
  }
  const runEndData = transcript.runEnd?.data as
    | {
        turnsUsed?: number;
        maxTurns?: number;
        repairCyclesUsed?: number;
        maxRepairCycles?: number;
        tokensIn?: number;
        tokensOut?: number;
      }
    | undefined;

  const profile = classifyModel(model, baseURL);

  return {
    schemaVersion: SCHEMA_VERSION,
    suiteVersion,
    task: {
      id: entry.taskId,
      tier: entry.task.tier,
      mode: entry.task.mode,
      expectedOutcome: entry.task.expectedOutcome,
      manifestSha256: await manifestSha256(repoRoot, entry.taskId),
      fixtureSha256: entry.task.fixture.sha256,
      variantOf: entry.task.variantOf ?? null,
      tags: entry.task.tags,
    },
    model: {
      id: model,
      provider: runStart.provider ?? 'unknown',
      selectionSource: (runStart.modelSource as ResultRecord['model']['selectionSource']) ?? 'flag',
      segment: profile.segment,
      // A compat model pinned to a specific tag (e.g. "qwen2.5-coder:7b") is
      // a strong pin — unlike a saved-login CLI route, the exact model id is
      // named, not left to whatever the login currently resolves to.
      pinning: 'strong',
    },
    environment: {
      copperheadVersion: copperhead.version,
      copperheadCommit: copperhead.commit,
      kicadCliVersion: runStart.versions?.kicadCli ?? null,
      node: runStart.versions?.node ?? process.version,
      platform: runStart.versions?.platform ?? `${process.platform}-${process.arch}`,
    },
    run: {
      repeatIndex: entry.repeatIndex,
      repeatsPlanned: entry.repeatsPlanned,
      startedAt: runStart.startedAt ?? transcript.runStart!.ts,
      baselineCommit: sandbox.baselineCommit,
      llmCacheDisabled: true,
      allowDirty: false,
    },
    assertions: score.assertions,
    verdict: score.verdict,
    stats: {
      exitPath,
      // No run-end (a wall-clock kill) means no evidence for these — 0 is
      // the honest "unknown, not fabricated" value, not a measurement.
      // durationMs is the one exception: the runner measures it itself
      // (wall-clock around the whole subprocess lifecycle), independent of
      // whether copperhead got to write its own stats.
      turnsUsed: runEndData?.turnsUsed ?? 0,
      maxTurns: runEndData?.maxTurns ?? entry.task.caps.turns,
      repairCyclesUsed: runEndData?.repairCyclesUsed ?? 0,
      maxRepairCycles: runEndData?.maxRepairCycles ?? (entry.task.config?.maxRepairCycles ?? 0),
      tokensIn: runEndData?.tokensIn ?? 0,
      tokensOut: runEndData?.tokensOut ?? 0,
      durationMs: run.durationMs,
    },
    cost: { usd: profile.costUsd, priceTableVersion: null },
    failure: score.failure,
    artifacts: {
      // Forward slashes always: this value is persisted and may be read
      // back on a different platform (or just by --rescore's path.join,
      // which only treats '/' as a separator on POSIX) — path.relative()
      // returns the native separator, which would be a silently invalid
      // path anywhere other than the machine that wrote it.
      transcriptPath: run.transcriptDir ? path.relative(sandbox.path, run.transcriptDir).replace(/\\/g, '/') : '',
      sandboxPreserved: true,
      sandboxPath: sandbox.path,
    },
  };
}
