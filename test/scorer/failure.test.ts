import { describe, it, expect } from 'vitest';
import { classifyFailure } from '../../src/scorer/failure.js';
import type { AssertionOutcome } from '../../src/scorer/verdict.js';
import type { TaskManifest } from '../../src/types.js';

function task(overrides: Partial<TaskManifest> = {}): TaskManifest {
  return {
    id: 't',
    tier: 'simple',
    mode: 'do',
    fixture: { path: 'fixtures/x', sha256: '0'.repeat(64) },
    request: { prompt: 'x' },
    expectedOutcome: 'edit',
    caps: { turns: 40, wallClockSec: 1200 },
    tags: [],
    ...overrides,
  };
}

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

describe('classifyFailure', () => {
  it('maps turn-budget-exhausted to turn-budget', () => {
    const r = classifyFailure(task(), 'turn-budget-exhausted', false, [outcome({ passed: false })]);
    expect(r.category).toBe('turn-budget');
    expect(r.firstFailedAssertion).toBe('a');
  });

  it('maps repair-cycles-exhausted to repair-exhausted', () => {
    const r = classifyFailure(task(), 'repair-cycles-exhausted', false, [outcome({ passed: false })]);
    expect(r.category).toBe('repair-exhausted');
  });

  it('maps commit-failed to commit-failed', () => {
    const r = classifyFailure(task(), 'commit-failed', false, [outcome({ passed: false })]);
    expect(r.category).toBe('commit-failed');
  });

  it('maps stalled to stalled', () => {
    const r = classifyFailure(task(), 'stalled', false, [outcome({ passed: false })]);
    expect(r.category).toBe('stalled');
  });

  it('maps a refusal on an edit-outcome task to false-refusal', () => {
    const r = classifyFailure(task({ expectedOutcome: 'edit' }), 'refused', false, [outcome({ passed: false })]);
    expect(r.category).toBe('false-refusal');
  });

  it('maps "done" with a failed requested-change assertion to wrong-target', () => {
    const r = classifyFailure(task(), 'done', false, [
      outcome({ id: 'net-check', type: 'net_present', passed: false }),
      outcome({ id: 'erc-check', type: 'erc_no_new_violations', passed: true }),
    ]);
    expect(r.category).toBe('wrong-target');
    expect(r.firstFailedAssertion).toBe('net-check');
  });

  it('reports the FIRST failed required assertion, not just any failed one', () => {
    const r = classifyFailure(task(), 'turn-budget-exhausted', false, [
      outcome({ id: 'first', passed: false }),
      outcome({ id: 'second', passed: false }),
    ]);
    expect(r.firstFailedAssertion).toBe('first');
  });

  it('ignores a failed OPTIONAL assertion when picking firstFailedAssertion', () => {
    const r = classifyFailure(task(), 'turn-budget-exhausted', false, [
      outcome({ id: 'optional', required: false, passed: false }),
      outcome({ id: 'required', required: true, passed: false }),
    ]);
    expect(r.firstFailedAssertion).toBe('required');
  });

  it('throws rather than guessing on cap-exceeded (no confirmed mapping)', () => {
    expect(() => classifyFailure(task(), null, true, [outcome({ passed: false })])).toThrow(
      /no deterministic rule/,
    );
  });

  it('throws rather than guessing on a refused run against an expectedOutcome "refusal" task that still fails', () => {
    expect(() =>
      classifyFailure(task({ expectedOutcome: 'refusal' }), 'refused', false, [
        outcome({ id: 'budget-recorded', type: 'constraint_registered', passed: false }),
      ]),
    ).toThrow(/no deterministic rule/);
  });

  it('throws rather than guessing on provider-error', () => {
    expect(() => classifyFailure(task(), 'provider-error', false, [outcome({ passed: false })])).toThrow(
      /no deterministic rule/,
    );
  });
});
