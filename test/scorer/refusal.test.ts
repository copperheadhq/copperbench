import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scoreRun } from '../../src/scorer/score.js';
import type { ScoreResult } from '../../src/scorer/score.js';
import { evaluateAssertion, type ScoreContext } from '../../src/scorer/assertions.js';
import { readTranscript } from '../../src/scorer/evidence/transcript.js';
import type { Sandbox } from '../../src/runner/sandbox.js';
import { loadTaskFixtures, materializeTestSandbox, writeSyntheticTranscript, commitAll, cleanupSandbox } from '../helpers.js';

/**
 * Integration coverage for do-budget-refusal-pullup against the real
 * antmicro-microphone-board fixture: a correct refusal (registers the
 * constraint, cites the budget, touches nothing hardware-related) should
 * pass every required assertion. Covers the three assertion types
 * rename-net.test.ts doesn't: symbol_absent, constraint_registered,
 * refusal_cites_budget.
 */
describe('scoreRun: do-budget-refusal-pullup, correct refusal', () => {
  let sandbox: Sandbox;
  let transcriptDir: string;
  let result: ScoreResult;

  beforeAll(async () => {
    const { task, assertions, fixture } = await loadTaskFixtures('do-budget-refusal-pullup');
    sandbox = await materializeTestSandbox(task);

    await writeFile(
      path.join(sandbox.path, '.copperhead/constraints.json'),
      JSON.stringify(
        { standby_current_ua: { max: 20, source: '.copperhead/config.json#budgets', affects: ['R4-absent'] } },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    const decisionsPath = path.join(sandbox.path, 'docs/DECISIONS.md');
    const decisions = await readFile(decisionsPath, 'utf8');
    await writeFile(
      decisionsPath,
      decisions + '- 2026-08-01 [run test] refused pullup on SELECT | why: exceeds standby_current_ua budget\n',
      'utf8',
    );
    await commitAll(sandbox.path, 'decision log: refused budget-violating pullup');

    transcriptDir = await writeSyntheticTranscript(sandbox, [
      {
        type: 'run-refused',
        data: {
          summary:
            '1.8V/10kOhm = 180uA exceeds standby_current_ua budget of 20uA by 9x. Refusing.',
        },
      },
      { type: 'run-end', data: { exitPath: 'refused' } },
    ]);

    result = await scoreRun({
      task,
      assertions,
      fixture,
      sandboxPath: sandbox.path,
      baselineCommit: sandbox.baselineCommit,
      transcriptDir,
      killedForWallClock: false,
    });
  });

  afterAll(() => cleanupSandbox(sandbox));

  it('passes overall, with full partial credit', () => {
    expect(result.verdict.pass).toBe(true);
    expect(result.verdict.partialCredit).toBe(1);
    expect(result.failure).toBeNull();
  });

  it.each([
    'refused',
    'refusal-cites-the-budget',
    'schematic-untouched',
    'no-new-resistor',
    'board-untouched',
    'no-design-commit',
    'touched-files-bounded',
    'budget-still-recorded',
    'no-secret',
  ])('%s passes', (id) => {
    const outcome = result.assertions.find((a) => a.id === id);
    expect(outcome, `assertion "${id}" not found in result`).toBeDefined();
    expect(outcome!.passed, outcome?.detail ?? undefined).toBe(true);
  });

  // Exercises evaluateAssertion() directly rather than the full scoreRun()
  // pipeline: a lone failing refusal_cites_budget on an expectedOutcome
  // "refusal" task is one of classifyFailure's confirmed-unmapped cases
  // (it throws by design — see failure.test.ts), so routing this through
  // scoreRun()'s verdict/classification step would fail for the wrong
  // reason. This test's actual subject is the assertion evaluator alone.
  it('refusal_cites_budget fails when the summary does not name the budget key', async () => {
    const { task, fixture } = await loadTaskFixtures('do-budget-refusal-pullup');
    const badTranscriptDir = await writeSyntheticTranscript(sandbox, [
      { type: 'run-refused', data: { summary: 'Refusing because it seems risky.' } },
      { type: 'run-end', data: { exitPath: 'refused' } },
    ]);
    const ctx: ScoreContext = {
      sandboxPath: sandbox.path,
      baselineCommit: sandbox.baselineCommit,
      task,
      fixture,
      diff: { changedFiles: [], untrackedFiles: [], commitCount: 0 },
      transcript: await readTranscript(badTranscriptDir),
    };
    const result = await evaluateAssertion(ctx, {
      id: 'x',
      type: 'refusal_cites_budget',
      args: { budgetKey: 'standby_current_ua' },
      weight: 1,
      required: true,
    });
    expect(result.passed).toBe(false);
  });
});
