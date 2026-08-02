import type { EvidenceSource } from './assertions.js';

export interface AssertionOutcome {
  id: string;
  type: string;
  required: boolean;
  weight: number;
  passed: boolean;
  evidenceSource: EvidenceSource;
  detail: string | null;
}

export interface Verdict {
  pass: boolean;
  partialCredit: number;
}

/**
 * STANDARD.md section 7 / design D6: pass only when every required assertion
 * passes — there is no third state. Weighted partial credit is computed and
 * recorded but is a diagnostic field only, never a headline number.
 */
export function computeVerdict(outcomes: AssertionOutcome[]): Verdict {
  const pass = outcomes.every((o) => !o.required || o.passed);
  const totalWeight = outcomes.reduce((s, o) => s + o.weight, 0);
  const earnedWeight = outcomes.reduce((s, o) => s + (o.passed ? o.weight : 0), 0);
  const partialCredit = totalWeight === 0 ? 0 : earnedWeight / totalWeight;
  return { pass, partialCredit };
}
