import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { findExistingRecord } from '../../src/records/resume.js';
import { repoRoot } from '../helpers.js';

const resultsRoot = path.join(repoRoot, 'test', '.tmp-resume-results');

afterEach(async () => {
  await rm(resultsRoot, { recursive: true, force: true });
});

describe('findExistingRecord', () => {
  it('returns null when results/ does not exist at all', async () => {
    expect(await findExistingRecord(resultsRoot, 'compat:qwen2.5-coder:7b', 'do-rename-net', 1)).toBeNull();
  });

  it('returns null when results/ exists but has no matching record', async () => {
    await mkdir(path.join(resultsRoot, '2026-08-01'), { recursive: true });
    expect(await findExistingRecord(resultsRoot, 'compat:qwen2.5-coder:7b', 'do-rename-net', 1)).toBeNull();
  });

  it('finds a record under ANY date directory, not just today\'s — a suite can resume days later', async () => {
    const dir = path.join(resultsRoot, '2020-01-01', 'compat-qwen2.5-coder-7b', 'do-rename-net');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'run-2.json'), '{}', 'utf8');

    const found = await findExistingRecord(resultsRoot, 'compat:qwen2.5-coder:7b', 'do-rename-net', 2);
    expect(found).toBe(path.join(dir, 'run-2.json'));
  });

  it('is exact on repeatIndex — run-1 existing does not satisfy a lookup for run-2', async () => {
    const dir = path.join(resultsRoot, '2026-08-01', 'compat-qwen2.5-coder-7b', 'do-rename-net');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'run-1.json'), '{}', 'utf8');

    expect(await findExistingRecord(resultsRoot, 'compat:qwen2.5-coder:7b', 'do-rename-net', 2)).toBeNull();
  });

  it('sanitizes the model id the same way the writer does, so lookups and writes agree', async () => {
    // "compat:qwen2.5-coder:7b" writes to "compat-qwen2.5-coder-7b" (write.ts's
    // sanitizeForPath) — a lookup with the raw colon-bearing id must resolve
    // the same sanitized directory, or resumability silently never matches.
    const dir = path.join(resultsRoot, '2026-08-01', 'compat-qwen2.5-coder-7b', 'do-rename-net');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'run-1.json'), '{}', 'utf8');

    expect(await findExistingRecord(resultsRoot, 'compat:qwen2.5-coder:7b', 'do-rename-net', 1)).not.toBeNull();
  });
});
