import { describe, it, expect } from 'vitest';
import { computeVerdict, type AssertionOutcome } from '../../src/scorer/verdict.js';

function outcome(overrides: Partial<AssertionOutcome>): AssertionOutcome {
  return {
    id: 'a',
    type: 'net_present',
    required: true,
    weight: 1,
    passed: true,
    evidenceSource: 'end-state',
    detail: null,
    ...overrides,
  };
}

describe('computeVerdict', () => {
  it('passes when every required assertion passes, regardless of optional failures', () => {
    const v = computeVerdict([
      outcome({ id: 'r1', required: true, passed: true, weight: 3 }),
      outcome({ id: 'o1', required: false, passed: false, weight: 1 }),
    ]);
    expect(v.pass).toBe(true);
  });

  it('fails when any required assertion fails, regardless of optional passes', () => {
    const v = computeVerdict([
      outcome({ id: 'r1', required: true, passed: false, weight: 3 }),
      outcome({ id: 'o1', required: false, passed: true, weight: 1 }),
    ]);
    expect(v.pass).toBe(false);
  });

  it('computes partial credit as weighted fraction passed, independent of pass/fail', () => {
    const v = computeVerdict([
      outcome({ id: 'a', required: true, passed: true, weight: 3 }),
      outcome({ id: 'b', required: true, passed: false, weight: 1 }),
    ]);
    expect(v.pass).toBe(false);
    expect(v.partialCredit).toBeCloseTo(0.75);
  });

  it('reports 0 partial credit for an empty outcome list rather than dividing by zero', () => {
    const v = computeVerdict([]);
    expect(v.partialCredit).toBe(0);
    expect(v.pass).toBe(true); // vacuously: no required assertion failed
  });
});
