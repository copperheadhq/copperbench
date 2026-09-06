// Canonical fixture-tree hash (STANDARD.md section 3.2).
//
// This is the promotion of scripts/hash-fixture.mjs into TypeScript required by
// tasks.md 2.9. The algorithm is frozen and MUST NOT change: a published fixture
// hash is a third party's only handle on what a benchmark actually ran against.
// scripts/hash-fixture.mjs stays standalone and dependency-free on purpose, so
// that third party can recompute a hash without installing this project; the two
// implementations are kept byte-identical in behavior by test/hash.test.ts,
// which runs both over the vendored fixtures and compares.
//
// Files are sorted by tree-relative path with a plain byte comparison. Each
// contributes, in order: the path as UTF-8, 0x00, its byte length as a decimal
// string, 0x00, and its bytes. Directories contribute nothing, so an empty
// directory is not preserved by a hash and must never be load-bearing.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export interface FixtureTreeHash {
  /** Lowercase hex SHA-256 of the canonical serialization. */
  sha256: string;
  /** Tree-relative paths in the order they were fed to the digest. */
  files: string[];
}

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Hash a fixture `tree/` directory. Only `tree/` is ever hashed: provenance,
 * license, and baseline reports live outside it so the agent under test cannot
 * read our bookkeeping.
 */
export function hashFixtureTree(treeDir: string): FixtureTreeHash {
  // Node's default sort is by UTF-16 code unit, which matches the plain byte
  // comparison the standard specifies for the ASCII paths fixtures use.
  const files = walk(treeDir, treeDir).sort();
  const h = createHash('sha256');
  for (const rel of files) {
    const bytes = readFileSync(path.join(treeDir, rel));
    h.update(rel, 'utf8');
    h.update(Buffer.from([0]));
    h.update(String(bytes.length), 'utf8');
    h.update(Buffer.from([0]));
    h.update(bytes);
  }
  return { sha256: h.digest('hex'), files };
}
