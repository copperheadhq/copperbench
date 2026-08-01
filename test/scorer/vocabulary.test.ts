import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { evaluateAssertion, type ScoreContext } from '../../src/scorer/assertions.js';
import type { Sandbox } from '../../src/runner/sandbox.js';
import { loadTaskFixtures, materializeTestSandbox, cleanupSandbox } from '../helpers.js';

/**
 * STANDARD.md section 2.2: an assertion type outside the closed vocabulary
 * is a validation error, never a skip. Distinct from a type this scorer
 * pass hasn't implemented yet, which is also an error but a different one
 * (a scorer limitation, not a malformed assertions.json) — both must fail
 * loudly rather than silently passing or being skipped.
 */
describe('assertion vocabulary boundaries', () => {
  let sandbox: Sandbox;
  let ctx: ScoreContext;

  beforeAll(async () => {
    const { task, fixture } = await loadTaskFixtures('do-rename-net');
    sandbox = await materializeTestSandbox(task);
    ctx = {
      sandboxPath: sandbox.path,
      baselineCommit: sandbox.baselineCommit,
      task,
      fixture,
      diff: { changedFiles: [], untrackedFiles: [], commitCount: 0 },
      transcript: { events: [], runStart: null, runEnd: null },
    };
  });

  afterAll(() => cleanupSandbox(sandbox));

  it.each([
    'erc_clean',
    'drc_clean',
    'check_clean',
    'drift_clean',
    'symbol_present',
    'pin_net_equals',
    'doc_row_matches',
    'rollback_byte_identical',
    'transcript_event',
  ])('%s is recognized but not implemented, and throws rather than silently passing', async (type) => {
    await expect(
      evaluateAssertion(ctx, { id: 'x', type, weight: 1, required: true }),
    ).rejects.toThrow(/not implemented/);
  });

  it('an actually-unknown type is a distinct validation error, never a skip', async () => {
    await expect(
      evaluateAssertion(ctx, { id: 'x', type: 'made_up_assertion_type', weight: 1, required: true }),
    ).rejects.toThrow(/outside the closed vocabulary/);
  });
});
