// Everything the website renders, read from the repository as checked out.
//
// The site is presentation only (site/, an Astro project). Every quantity on
// the page comes through here: the leaderboard and record counts from results/
// via leaderboard.ts, task counts from tasks/, the fixture table from
// fixtures/*/fixture.json, versions from record.ts, the build commit from git.
// The one editorial input is site/status.json. Keeping the reader here, under
// the root tsconfig and the root tests, means the page cannot compute a number
// the rest of the repository does not.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { gitCapture } from './git.ts';
import { buildLeaderboard, type Leaderboard, type Tier } from './leaderboard.ts';

export interface TaskFact {
  id: string;
  tier: Tier;
  expectedOutcome: string;
  fixture: string;
}

export interface FixtureFact {
  id: string;
  complexity: Tier;
  name: string;
  url: string;
  license: string;
  sheets: number;
  symbols: number;
  schematicLines: number;
}

export interface StatusEntry {
  state: 'done' | 'next' | 'pending';
  title: string;
  text: string;
  link?: string;
  label?: string;
}

export interface Facts {
  version: string;
  repoUrl: string;
  commit: string | null;
  tasks: TaskFact[];
  fixtures: FixtureFact[];
  status: StatusEntry[];
  leaderboard: Leaderboard;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/**
 * The repository root, found by walking up from `start` to the directory whose
 * package.json names this project. Astro bundles the site's modules into
 * dist/.prerender before running them, so a path relative to import.meta.url
 * is wrong at exactly the moment it is needed; the working directory and the
 * package name are stable.
 */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (readJson<{ name?: string }>(pkg).name === 'copperbench') return dir;
      } catch {
        // Not ours; keep walking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`copperbench repository root not found above ${start}`);
    dir = parent;
  }
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function gitCommit(repoRoot: string): string | null {
  try {
    return gitCapture(repoRoot, ['rev-parse', '--short', 'HEAD']).trim();
  } catch {
    // Not a git checkout, or git is absent. The page says so instead of guessing.
    return null;
  }
}

export function collectFacts(repoRoot: string, resultsDir = path.join(repoRoot, 'results')): Facts {
  const pkg = readJson<{ version: string; repository?: { url?: string } }>(path.join(repoRoot, 'package.json'));
  const repoUrl = (pkg.repository?.url ?? 'https://github.com/chouhanindustries/copperbench')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');

  const tasks = subdirs(path.join(repoRoot, 'tasks')).map((id) => {
    const m = readJson<{ tier: Tier; expectedOutcome: string; fixture: { path: string } }>(
      path.join(repoRoot, 'tasks', id, 'task.json'),
    );
    return { id, tier: m.tier, expectedOutcome: m.expectedOutcome, fixture: path.basename(m.fixture.path) };
  });

  const fixtures = subdirs(path.join(repoRoot, 'fixtures')).map((id) => {
    const m = readJson<{
      complexity: Tier;
      upstream: { name: string; url: string; license: string };
      scale: { sheets: number; symbols: number; schematicLines: number };
    }>(path.join(repoRoot, 'fixtures', id, 'fixture.json'));
    return {
      id,
      complexity: m.complexity,
      name: m.upstream.name,
      url: m.upstream.url,
      license: m.upstream.license,
      sheets: m.scale.sheets,
      symbols: m.scale.symbols,
      schematicLines: m.scale.schematicLines,
    };
  });

  const statusFile = path.join(repoRoot, 'site', 'status.json');
  const status = existsSync(statusFile) ? readJson<StatusEntry[]>(statusFile) : [];

  return {
    version: pkg.version,
    repoUrl,
    commit: gitCommit(repoRoot),
    tasks,
    fixtures,
    status,
    leaderboard: buildLeaderboard(repoRoot, resultsDir),
  };
}
