import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { rescoreResult } from '../../src/scorer/rescore.js';
import type { Sandbox } from '../../src/runner/sandbox.js';
import {
  repoRoot,
  loadTaskFixtures,
  materializeTestSandbox,
  writeSyntheticTranscript,
  commitAll,
  cleanupSandbox,
} from '../helpers.js';

/**
 * STANDARD.md section 14: re-scoring a preserved sandbox and transcript
 * reproduces the verdict, with no provider credential and no network. This
 * test hand-builds a record matching ResultRecordForRescore's shape rather
 * than going through buildResultRecord, to isolate rescoreResult from the
 * rest of the write pipeline.
 */
describe('rescoreResult', () => {
  let sandbox: Sandbox;
  let resultPath: string;

  beforeAll(async () => {
    const { task } = await loadTaskFixtures('do-rename-net');
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

    const transcriptDir = await writeSyntheticTranscript(sandbox, [{ type: 'run-end', data: { exitPath: 'done' } }]);
    const transcriptRel = path.relative(sandbox.path, transcriptDir);

    const record = {
      task: { id: task.id },
      run: { baselineCommit: sandbox.baselineCommit },
      verdict: { pass: true, partialCredit: 1 },
      stats: { exitPath: 'done' },
      failure: null,
      // Matches the full passing assertion set for this exact edit (see
      // test/scorer/rename-net.test.ts's happy-path list) — rescoreResult
      // now compares per-assertion outcomes, not just the aggregate verdict.
      assertions: [
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
      ].map((id) => ({ id, passed: true })),
      // Basename only, resolved against this machine's tmpdir() by
      // rescoreResult — matches the format src/records/build.ts writes.
      artifacts: { transcriptPath: transcriptRel, sandboxPreserved: true, sandboxPath: path.basename(sandbox.path) },
    };
    const resultsDir = path.join(repoRoot, 'test', '.tmp-results');
    await mkdir(resultsDir, { recursive: true });
    resultPath = path.join(resultsDir, 'run-1.json');
    await writeFile(resultPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  });

  afterAll(async () => {
    await cleanupSandbox(sandbox);
    await rm(path.join(repoRoot, 'test', '.tmp-results'), { recursive: true, force: true });
  });

  it('reproduces an identical verdict from a preserved sandbox and transcript alone', async () => {
    const outcome = await rescoreResult(repoRoot, resultPath);
    expect(outcome.matches).toBe(true);
    expect(outcome.recomputed.verdict.pass).toBe(true);
    expect(outcome.recomputed.verdict.partialCredit).toBe(1);
  });

  it('reads no environment variable shaped like a provider credential', async () => {
    // Not a security boundary test (that's fixtures elsewhere) — this just
    // documents that rescoreResult's own code path has no such read, by
    // running it with those variables deleted and confirming nothing throws
    // for a missing-credential reason.
    const saved = { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const outcome = await rescoreResult(repoRoot, resultPath);
      expect(outcome.matches).toBe(true);
    } finally {
      if (saved.anthropic !== undefined) process.env.ANTHROPIC_API_KEY = saved.anthropic;
      if (saved.openai !== undefined) process.env.OPENAI_API_KEY = saved.openai;
    }
  });
});
