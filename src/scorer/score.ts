import type { AssertionManifest, FixtureManifest, TaskManifest } from '../types.js';
import { readDiffEvidence } from './evidence/diff.js';
import { exitPathOf, readTranscript } from './evidence/transcript.js';
import { evaluateAssertion, type ScoreContext } from './assertions.js';
import { computeVerdict, type AssertionOutcome, type Verdict } from './verdict.js';
import { classifyFailure, type FailureClassification } from './failure.js';

export interface ScoreInput {
  task: TaskManifest;
  assertions: AssertionManifest[];
  fixture: FixtureManifest;
  sandboxPath: string;
  baselineCommit: string;
  transcriptDir: string | null;
  killedForWallClock: boolean;
}

export interface ScoreResult {
  assertions: AssertionOutcome[];
  verdict: Verdict;
  failure: FailureClassification | null;
}

/**
 * Grades one completed run against its assertions.json. Reads only the
 * three evidence sources (STANDARD.md section 4, design D2/D3): sandbox end
 * state, the diff against the baseline commit, and the transcript. No model
 * call and no network access are reachable from any path this function
 * calls — the schematic/board checks shell out to kicad-cli (deterministic,
 * offline, not an LLM), and everything else is filesystem/git reads.
 */
export async function scoreRun(input: ScoreInput): Promise<ScoreResult> {
  const [diff, transcript] = await Promise.all([
    readDiffEvidence(input.sandboxPath, input.baselineCommit),
    readTranscript(input.transcriptDir),
  ]);

  const ctx: ScoreContext = {
    sandboxPath: input.sandboxPath,
    baselineCommit: input.baselineCommit,
    task: input.task,
    fixture: input.fixture,
    diff,
    transcript,
  };

  const outcomes: AssertionOutcome[] = [];
  for (const assertion of input.assertions) {
    const result = await evaluateAssertion(ctx, assertion);
    outcomes.push({
      id: assertion.id,
      type: assertion.type,
      required: assertion.required,
      weight: assertion.weight,
      passed: result.passed,
      evidenceSource: result.evidenceSource,
      detail: result.detail,
    });
  }

  const verdict = computeVerdict(outcomes);
  const failure = verdict.pass
    ? null
    : classifyFailure(input.task, exitPathOf(transcript), input.killedForWallClock, outcomes);

  return { assertions: outcomes, verdict, failure };
}
