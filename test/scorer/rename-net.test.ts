import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scoreRun } from '../../src/scorer/score.js';
import type { ScoreResult } from '../../src/scorer/score.js';
import type { Sandbox } from '../../src/runner/sandbox.js';
import { loadTaskFixtures, materializeTestSandbox, writeSyntheticTranscript, commitAll, cleanupSandbox } from '../helpers.js';

/**
 * Integration coverage for do-rename-net against the real
 * antmicro-microphone-board fixture: a correct rename should pass every
 * required assertion. This is the "happy path" for 13 of the 14 assertion
 * types this scorer pass implements (do-budget-refusal-pullup covers the
 * remaining three: symbol_absent, constraint_registered,
 * refusal_cites_budget — see refusal.test.ts).
 *
 * No LLM/network is reachable from this test: the "model" is simulated by
 * editing files directly and writing a synthetic transcript, and copperhead
 * is driven only through `init` (setup.commands, LLM-free by contract).
 */
describe('scoreRun: do-rename-net, correct edit', () => {
  let sandbox: Sandbox;
  let transcriptDir: string;
  let result: ScoreResult;

  beforeAll(async () => {
    const { task, assertions, fixture } = await loadTaskFixtures('do-rename-net');
    sandbox = await materializeTestSandbox(task);

    const schAbs = path.join(sandbox.path, 'hardware/microphone-board.kicad_sch');
    let sch = await readFile(schAbs, 'utf8');
    sch = sch.replaceAll('(label "DATA"', '(label "PDM_DATA"');
    await writeFile(schAbs, sch, 'utf8');

    const pinoutAbs = path.join(sandbox.path, 'docs/PINOUT.md');
    let pinout = await readFile(pinoutAbs, 'utf8');
    pinout = pinout.replace(/\bDATA\b/g, 'PDM_DATA');
    await writeFile(pinoutAbs, pinout, 'utf8');

    await commitAll(sandbox.path, 'rename net DATA to PDM_DATA');
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

  it('passes overall, with full partial credit', () => {
    expect(result.verdict.pass).toBe(true);
    expect(result.verdict.partialCredit).toBe(1);
    expect(result.failure).toBeNull();
  });

  it.each([
    'new-net-exists',
    'old-net-gone',
    'sibling-nets-untouched',
    'no-new-erc-violations',
    'no-new-drc-violations',
    'pinout-updated',
    'pinout-old-name-gone',
    'surgical-schematic-edit',
    'board-untouched',
    'touched-files-bounded',
    'one-commit',
    'finished-cleanly',
    'no-secret',
  ])('%s passes', (id) => {
    const outcome = result.assertions.find((a) => a.id === id);
    expect(outcome, `assertion "${id}" not found in result`).toBeDefined();
    expect(outcome!.passed, outcome?.detail ?? undefined).toBe(true);
  });

  it('diff_ratio_max reports a small ratio well under the 1% bound', () => {
    const outcome = result.assertions.find((a) => a.id === 'surgical-schematic-edit');
    // Parses the reported ratio out of detail and compares numerically,
    // rather than matching the formatted string's digit pattern — a regex
    // like /ratio 0\.000\d/ only matches ratios below 0.001 and breaks on any
    // unrelated fixture edit that shifts the baseline line count, which has
    // nothing to do with whether the scorer itself is correct.
    const match = outcome!.detail!.match(/ratio ([\d.]+), max ([\d.]+)/);
    expect(match, outcome!.detail ?? undefined).not.toBeNull();
    const [, ratio, max] = match!;
    expect(Number(ratio)).toBeLessThan(Number(max));
  });
});
