// The fixture hash algorithm is frozen (STANDARD.md 3.2). These tests pin two
// properties: the TypeScript promotion agrees with the standalone hasher a third
// party would run, and both agree with what every vendored fixture recorded.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { hashFixtureTree } from '../scripts/lib/hash.ts';
import { REPO } from './helpers.ts';

const fixtures = readdirSync(path.join(REPO, 'fixtures'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe('hashFixtureTree', () => {
  it('finds the vendored fixtures to check', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const id of fixtures) {
    const dir = path.join(REPO, 'fixtures', id);

    it(`reproduces the recorded hash for ${id}`, () => {
      const manifest = JSON.parse(readFileSync(path.join(dir, 'fixture.json'), 'utf8'));
      expect(hashFixtureTree(path.join(dir, 'tree')).sha256).toBe(manifest.sha256);
    });

    it(`agrees with the standalone hasher for ${id}`, () => {
      // The .mjs stays dependency-free so a third party can verify a published
      // hash without installing this project. If the two ever diverge, the
      // published verification path is the one that is wrong for users.
      const stdout = execFileSync(
        process.execPath,
        [path.join(REPO, 'scripts', 'hash-fixture.mjs'), path.join(dir, 'tree')],
        { encoding: 'utf8' },
      );
      expect(stdout.split('\n')[0]).toBe(hashFixtureTree(path.join(dir, 'tree')).sha256);
    });
  }

  it('is sensitive to content, path, and file boundaries', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'copperbench-hash-'));
    try {
      writeFileSync(path.join(root, 'a.txt'), 'one');
      writeFileSync(path.join(root, 'b.txt'), 'two');
      const base = hashFixtureTree(root).sha256;

      writeFileSync(path.join(root, 'b.txt'), 'twoX');
      expect(hashFixtureTree(root).sha256).not.toBe(base);

      // Length framing means concatenation cannot be forged across a boundary:
      // "one"+"two" split differently must hash differently.
      writeFileSync(path.join(root, 'a.txt'), 'onetwo');
      writeFileSync(path.join(root, 'b.txt'), '');
      const shifted = hashFixtureTree(root).sha256;
      expect(shifted).not.toBe(base);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores empty directories, which must never be load-bearing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'copperbench-hash-'));
    try {
      writeFileSync(path.join(root, 'a.txt'), 'one');
      const before = hashFixtureTree(root).sha256;
      execFileSync('mkdir', ['-p', path.join(root, 'empty')]);
      expect(existsSync(path.join(root, 'empty'))).toBe(true);
      expect(hashFixtureTree(root).sha256).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
