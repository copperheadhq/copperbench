// Minimal git helpers. The runner and the diff evidence adapter both need a
// handful of plumbing commands and nothing more, so this stays a thin wrapper
// rather than a dependency.

import { execFileSync } from 'node:child_process';

export function gitCapture(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

export function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** Tracked paths changed since `sha`, plus untracked files. */
export function changedPaths(cwd: string, sha: string): string[] {
  const tracked = gitCapture(cwd, ['diff', '--name-only', `${sha}..HEAD`]);
  const worktree = gitCapture(cwd, ['diff', '--name-only', sha]);
  const untracked = gitCapture(cwd, ['ls-files', '--others', '--exclude-standard']);
  const all = [tracked, worktree, untracked]
    .flatMap((s) => s.split('\n'))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(all)].sort();
}

/** Commits made after the baseline. */
export function commitsSince(cwd: string, sha: string): number {
  const out = gitCapture(cwd, ['rev-list', '--count', `${sha}..HEAD`]).trim();
  return Number.parseInt(out, 10) || 0;
}

/** Line counts changed in one path, against the baseline. Untracked counts whole. */
export function diffStatFor(cwd: string, sha: string, filePath: string): number {
  // --numstat gives added and deleted counts; their sum is what a surgicality
  // bound constrains, since a rewritten line is one of each.
  const out = gitCapture(cwd, ['diff', '--numstat', sha, '--', filePath]).trim();
  if (out === '') return 0;
  let total = 0;
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    const added = Number.parseInt(parts[0] ?? '0', 10);
    const deleted = Number.parseInt(parts[1] ?? '0', 10);
    total += (Number.isNaN(added) ? 0 : added) + (Number.isNaN(deleted) ? 0 : deleted);
  }
  return total;
}

/** True when the tree, tracked and untracked alike, matches the baseline exactly. */
export function treeIsByteIdenticalTo(cwd: string, sha: string): boolean {
  const dirty = gitCapture(cwd, ['status', '--porcelain']).trim();
  if (dirty !== '') return false;
  return gitCapture(cwd, ['rev-parse', 'HEAD']).trim() === sha;
}

/** Line count of a path as it stood at the baseline commit. */
export function baselineLineCount(cwd: string, sha: string, filePath: string): number {
  try {
    const body = gitCapture(cwd, ['show', `${sha}:${filePath}`]);
    if (body === '') return 0;
    return body.split('\n').length;
  } catch {
    return 0;
  }
}
