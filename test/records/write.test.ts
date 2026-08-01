import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeResultRecord, resultRecordPath, SecretFoundError, RecordAlreadyExistsError } from '../../src/records/write.js';
import type { ResultRecord } from '../../src/types.js';
import { repoRoot } from '../helpers.js';

function baseRecord(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    schemaVersion: '1.0.0',
    suiteVersion: '1.0.1',
    task: {
      id: 'do-rename-net',
      tier: 'simple',
      mode: 'do',
      expectedOutcome: 'edit',
      manifestSha256: '0'.repeat(64),
      fixtureSha256: '0'.repeat(64),
      variantOf: null,
      tags: [],
    },
    model: {
      id: 'compat:qwen2.5-coder:7b',
      provider: 'openai-compat',
      selectionSource: 'flag',
      segment: 'open-weight-self-hosted',
      pinning: 'strong',
    },
    environment: {
      copperheadVersion: '0.9.0',
      copperheadCommit: '0'.repeat(40),
      kicadCliVersion: '10.0.4',
      node: 'v22.17.0',
      platform: 'win32-x64',
    },
    run: {
      repeatIndex: 1,
      repeatsPlanned: 3,
      startedAt: '2026-08-01T12:00:00.000Z',
      baselineCommit: '0'.repeat(40),
      llmCacheDisabled: true,
      allowDirty: false,
    },
    assertions: [
      { id: 'a', type: 'net_present', required: true, weight: 1, passed: true, evidenceSource: 'end-state', detail: null },
    ],
    verdict: { pass: true, partialCredit: 1 },
    stats: {
      exitPath: 'done',
      turnsUsed: 5,
      maxTurns: 40,
      repairCyclesUsed: 0,
      maxRepairCycles: 5,
      tokensIn: 100,
      tokensOut: 100,
      durationMs: 5000,
    },
    cost: { usd: null, priceTableVersion: null },
    failure: null,
    artifacts: { transcriptPath: '.copperhead/runs/x', sandboxPreserved: true, sandboxPath: '/tmp/x' },
    ...overrides,
  };
}

const resultsRoot = path.join(repoRoot, 'test', '.tmp-write-results');

afterEach(async () => {
  await rm(resultsRoot, { recursive: true, force: true });
});

describe('resultRecordPath', () => {
  it('builds results/<date>/<model>/<task-id>/run-<n>.json, sanitizing the model id for the filesystem', () => {
    const p = resultRecordPath('results', baseRecord());
    expect(p).toBe(path.join('results', '2026-08-01', 'compat-qwen2.5-coder-7b', 'do-rename-net', 'run-1.json'));
  });

  it('derives the date from run.startedAt, not the current time', () => {
    const p = resultRecordPath('results', baseRecord({ run: { ...baseRecord().run, startedAt: '2099-01-15T00:00:00.000Z' } }));
    expect(p).toContain(path.join('results', '2099-01-15'));
  });
});

describe('writeResultRecord', () => {
  it('writes a valid record to the expected path', async () => {
    const record = baseRecord();
    const filePath = await writeResultRecord(resultsRoot, record);
    expect(filePath).toBe(resultRecordPath(resultsRoot, record));
    const written = JSON.parse(await readFile(filePath, 'utf8'));
    expect(written.task.id).toBe('do-rename-net');
  });

  it('hard-fails and writes nothing when the record contains a credential', async () => {
    const record = baseRecord({
      assertions: [
        {
          id: 'a',
          type: 'net_present',
          required: true,
          weight: 1,
          passed: false,
          evidenceSource: 'end-state',
          detail: `leaked key: sk-${'a'.repeat(24)}`,
        },
      ],
    });
    await expect(writeResultRecord(resultsRoot, record)).rejects.toThrow(SecretFoundError);
    await expect(readFile(resultRecordPath(resultsRoot, record), 'utf8')).rejects.toThrow();
  });

  it('never scrubs and continues — the whole write is refused, not a redacted partial write', async () => {
    const record = baseRecord({ run: { ...baseRecord().run, baselineCommit: `AIza${'x'.repeat(35)}` } });
    let threw = false;
    try {
      await writeResultRecord(resultsRoot, record);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(SecretFoundError);
    }
    expect(threw).toBe(true);
    await expect(readFile(resultRecordPath(resultsRoot, record), 'utf8')).rejects.toThrow();
  });

  it('refuses to overwrite an existing record (append-only)', async () => {
    const record = baseRecord();
    await writeResultRecord(resultsRoot, record);
    await expect(writeResultRecord(resultsRoot, record)).rejects.toThrow(RecordAlreadyExistsError);
  });
});
