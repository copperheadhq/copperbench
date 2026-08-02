import type { TaskManifest } from '../types.js';
import type { AssertionOutcome } from './verdict.js';

export type FailureCategory =
  | 'tool-protocol'
  | 'file-revert'
  | 'turn-budget'
  | 'repair-exhausted'
  | 'obligation-open'
  | 'drift-left'
  | 'constraint-violation'
  | 'false-refusal'
  | 'stalled'
  | 'commit-failed'
  | 'wrong-target';

export interface FailureClassification {
  category: FailureCategory;
  firstFailedAssertion: string | null;
  dominantToolError: string | null;
}

/** Assertion types that check whether the requested change actually
 * happened, as opposed to whether the repo stayed internally consistent —
 * the distinction STANDARD.md's `wrong-target` definition turns on. */
const REQUESTED_CHANGE_ASSERTION_TYPES = new Set([
  'net_present',
  'net_absent',
  'symbol_present',
  'symbol_absent',
  'pin_net_equals',
]);

/**
 * STANDARD.md section 11 / design D11: derived only from the run-end exit
 * path, the first failed required assertion, and the dominant tool-error
 * category — no heuristic judgment calls, no LLM. A case this function
 * doesn't recognize throws rather than guessing: the same "not a skip"
 * stance STANDARD.md takes on an unknown assertion type applies here to an
 * unmapped exit condition. Several such cases are open design questions
 * (flagged in the 4.4 write-up) rather than implementation gaps — filling
 * them in with a plausible-looking guess would be worse than refusing.
 */
export function classifyFailure(
  task: TaskManifest,
  exitPath: string | null,
  killedForWallClock: boolean,
  outcomes: AssertionOutcome[],
): FailureClassification {
  const firstFailed = outcomes.find((o) => o.required && !o.passed) ?? null;
  const firstFailedAssertion = firstFailed?.id ?? null;

  if (exitPath === 'turn-budget-exhausted') {
    return { category: 'turn-budget', firstFailedAssertion, dominantToolError: null };
  }
  if (exitPath === 'repair-cycles-exhausted') {
    return { category: 'repair-exhausted', firstFailedAssertion, dominantToolError: null };
  }
  if (exitPath === 'commit-failed') {
    return { category: 'commit-failed', firstFailedAssertion, dominantToolError: null };
  }
  if (exitPath === 'stalled') {
    return { category: 'stalled', firstFailedAssertion, dominantToolError: null };
  }
  if (exitPath === 'refused' && task.expectedOutcome === 'edit') {
    return { category: 'false-refusal', firstFailedAssertion, dominantToolError: null };
  }
  if (exitPath === 'done' && firstFailed && REQUESTED_CHANGE_ASSERTION_TYPES.has(firstFailed.type)) {
    return { category: 'wrong-target', firstFailedAssertion, dominantToolError: null };
  }

  throw new Error(
    `classifyFailure has no deterministic rule for exitPath="${exitPath}" ` +
      `killedForWallClock=${killedForWallClock} expectedOutcome="${task.expectedOutcome}" ` +
      `firstFailedAssertion="${firstFailedAssertion}"${firstFailed ? ` (type "${firstFailed.type}")` : ''} — ` +
      'this is an open design question, not a bug to paper over with a guess. Unmapped so far: ' +
      'cap-exceeded (the runner\'s own wall-clock kill), provider-error, session-limit, a "refused" run ' +
      'against an expectedOutcome "refusal" task that still fails a non-requested-change assertion, ' +
      'obligation-open, drift-left, constraint-violation, and file-revert.',
  );
}
