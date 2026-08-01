import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scoreRun } from '../../src/scorer/score.js';
import type { ScoreResult } from '../../src/scorer/score.js';
import type { Sandbox } from '../../src/runner/sandbox.js';
import { loadTaskFixtures, materializeTestSandbox, writeSyntheticTranscript, commitAll, cleanupSandbox } from '../helpers.js';

/**
 * STANDARD.md section 11's canonical wrong-target example: "A run that
 * passes ERC, passes DRC, and commits cleanly while having done the wrong
 * thing." Simulated here by claiming the rename happened (editing the doc)
 * without ever touching the schematic.
 */
describe('scoreRun: do-rename-net, wrong-target failure', () => {
  let sandbox: Sandbox;
  let transcriptDir: string;
  let result: ScoreResult;

  beforeAll(async () => {
    const { task, assertions, fixture } = await loadTaskFixtures('do-rename-net');
    sandbox = await materializeTestSandbox(task);

    const pinoutAbs = path.join(sandbox.path, 'docs/PINOUT.md');
    const pinout = await readFile(pinoutAbs, 'utf8');
    await writeFile(pinoutAbs, pinout + '\n<!-- renamed DATA to PDM_DATA -->\n', 'utf8');

    await commitAll(sandbox.path, 'claim rename (schematic untouched)');
    transcriptDir = await writeSyntheticTranscript(sandbox, [{ type: 'run-end', data: { exitPath: 'done' } }]);

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

  it('fails overall', () => {
    expect(result.verdict.pass).toBe(false);
    expect(result.verdict.partialCredit).toBeGreaterThan(0);
    expect(result.verdict.partialCredit).toBeLessThan(1);
  });

  it('classifies as wrong-target, naming the actual first failed assertion', () => {
    expect(result.failure).not.toBeNull();
    expect(result.failure!.category).toBe('wrong-target');
    expect(result.failure!.firstFailedAssertion).toBe('new-net-exists');
  });

  it('still passes verification (ERC/DRC) — the point of the trap', () => {
    const erc = result.assertions.find((a) => a.id === 'no-new-erc-violations');
    const drc = result.assertions.find((a) => a.id === 'no-new-drc-violations');
    expect(erc!.passed).toBe(true);
    expect(drc!.passed).toBe(true);
  });

  it('the requested-change assertions correctly fail', () => {
    expect(result.assertions.find((a) => a.id === 'new-net-exists')!.passed).toBe(false);
    expect(result.assertions.find((a) => a.id === 'old-net-gone')!.passed).toBe(false);
  });
});
