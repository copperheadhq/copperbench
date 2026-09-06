// Verdict computation (STANDARD.md section 7) and the failure taxonomy
// (section 11). Deterministic, and no LLM participates in either.

import type { Outcome } from './assertions.ts';
import type { Evidence } from './evidence.ts';

/**
 * `unscoreable` is a fourth verdict the standard's two do not cover, and it
 * earns its place: when a required assertion could not be evaluated, the run is
 * neither a pass nor a model failure, and folding it into either would corrupt
 * a headline. Unscoreable runs are excluded from pass rate and reported
 * separately, the same way incomparable records are segregated rather than
 * averaged.
 */
export type Verdict = 'pass' | 'fail' | 'unscoreable';

export interface Score {
  verdict: Verdict;
  /** Weighted fraction of all assertions passed. Never a headline number. */
  partialCredit: number;
  /** First required assertion that did not pass; drives failure classification. */
  firstFailedRequired: string | undefined;
  failureCategory: string | undefined;
  outcomes: Outcome[];
}

export function scoreRun(outcomes: Outcome[], ev: Evidence): Score {
  const required = outcomes.filter((o) => o.required);
  const failed = required.filter((o) => o.status === 'fail');
  const blocked = required.filter((o) => o.status === 'unevaluable');

  const totalWeight = outcomes.reduce((a, o) => a + o.weight, 0);
  const passedWeight = outcomes.filter((o) => o.status === 'pass').reduce((a, o) => a + o.weight, 0);
  const partialCredit = totalWeight === 0 ? 0 : passedWeight / totalWeight;

  let verdict: Verdict;
  if (failed.length > 0) verdict = 'fail';
  else if (blocked.length > 0) verdict = 'unscoreable';
  else verdict = 'pass';

  const firstFailedRequired = (failed[0] ?? blocked[0])?.id;

  return {
    verdict,
    partialCredit,
    firstFailedRequired,
    failureCategory: verdict === 'fail' ? classify(failed, ev) : undefined,
    outcomes,
  };
}

/**
 * Derived from deterministic signals only: the run-end exit path and the first
 * failed required assertion (D11).
 *
 * `wrong-target` is the category that matters most and is easiest to lose. A
 * run that verifies, commits cleanly, and did the wrong thing looks like a
 * success from every angle except the end-state assertion, so it is kept
 * distinct from turn-budget and repair-exhausted.
 */
function classify(failed: Outcome[], ev: Evidence): string {
  const exit = ev.transcript.exitPath();
  const first = failed[0];

  if (exit === 'refused' && first?.type !== 'exit_path_in') return 'false-refusal';
  if (exit === 'turn-budget-exhausted') return 'turn-budget';
  if (exit === 'repair-exhausted') return 'repair-exhausted';
  if (exit === 'stalled') return 'stalled';
  if (exit === 'commit-failed') return 'commit-failed';
  if (exit === 'obligation-open') return 'obligation-open';

  if (first === undefined) return 'wrong-target';

  switch (first.type) {
    case 'exit_path_in':
    case 'refusal_cites_budget':
      // Expected a refusal and did not get one.
      return exit === 'done' ? 'wrong-target' : 'tool-protocol';
    case 'diff_ratio_max':
    case 'files_touched_subset':
    case 'file_unchanged':
      return 'constraint-violation';
    case 'drift_clean':
      return 'drift-left';
    case 'constraint_registered':
      return 'constraint-violation';
    case 'commit_count':
      return 'commit-failed';
    default:
      // Verification passed and the run committed, but the requested change was
      // not made.
      return 'wrong-target';
  }
}
