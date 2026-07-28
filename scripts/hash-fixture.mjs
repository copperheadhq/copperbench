#!/usr/bin/env node
// Canonical fixture-tree hash for copperbench (STANDARD.md section 3.2).
//
// Files are sorted by tree-relative path with a plain byte comparison. Each
// contributes, in order: the path as UTF-8, 0x00, its byte length as a decimal
// string, 0x00, and its bytes. Directories contribute nothing, so an empty
// directory is not preserved by a hash and must never be load-bearing.
//
// Usage:
//   node scripts/hash-fixture.mjs fixtures/<id>/tree
//   node scripts/hash-fixture.mjs --check fixtures/<id>
//
// Standalone and dependency-free on purpose: anyone verifying a published
// result must be able to recompute a fixture hash without installing the
// project. The runner promotes this into TypeScript (task 2.2) but must not
// change the algorithm.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir, base) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

export function hashFixtureTree(treeDir) {
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

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: hash-fixture.mjs <tree-dir> | --check <fixture-dir>');
  process.exit(2);
}

if (args[0] === '--check') {
  const fixtureDir = args[1];
  const manifest = JSON.parse(readFileSync(path.join(fixtureDir, 'fixture.json'), 'utf8'));
  const { sha256, files } = hashFixtureTree(path.join(fixtureDir, 'tree'));
  const ok = sha256 === manifest.sha256;
  console.log(`${ok ? 'ok' : 'MISMATCH'} ${manifest.id}: ${files.length} files`);
  if (!ok) {
    console.log(`  expected ${manifest.sha256}`);
    console.log(`  actual   ${sha256}`);
  }
  process.exit(ok ? 0 : 1);
}

const treeDir = args[0];
const { sha256, files } = hashFixtureTree(treeDir);
statSync(treeDir);
console.log(sha256);
for (const f of files) console.log(`  ${f}`);
