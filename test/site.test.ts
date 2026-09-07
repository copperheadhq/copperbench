// The website's routing and the facts it renders. A link on the site lands on
// the page that renders the target when there is one and on GitHub otherwise;
// a nested page climbs back to the root; every task, fixture and record in
// the repository is on the site with the fields its page shows.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadRecords } from '../scripts/lib/leaderboard.ts';
import { collectFacts } from '../scripts/lib/site-facts.ts';
import { githubUrl, normalizeRepoPath, relativeHref, rewriteMarkdownLink, routeDepth, siteRoute } from '../scripts/lib/site-routes.ts';
import { REPO } from './helpers.ts';

const REPO_URL = 'https://github.com/example/copperbench';

describe('siteRoute', () => {
  it('maps every rendered repository path to its page', () => {
    expect(siteRoute('')).toBe('');
    expect(siteRoute('README.md')).toBe('');
    expect(siteRoute('STANDARD.md')).toBe('standard');
    expect(siteRoute('./STANDARD.md')).toBe('standard');
    expect(siteRoute('pricing.json')).toBe('pricing');
    expect(siteRoute('tasks')).toBe('tasks');
    expect(siteRoute('tasks/')).toBe('tasks');
    expect(siteRoute('tasks/do-rename-net')).toBe('tasks/do-rename-net');
    expect(siteRoute('tasks/do-rename-net/')).toBe('tasks/do-rename-net');
    expect(siteRoute('tasks/do-rename-net/README.md')).toBe('tasks/do-rename-net');
    expect(siteRoute('fixtures')).toBe('fixtures');
    expect(siteRoute('fixtures/FIXTURES.md')).toBe('fixtures');
    expect(siteRoute('fixtures/antmicro-microphone-board/')).toBe('fixtures/antmicro-microphone-board');
    expect(siteRoute('results')).toBe('results');
    expect(siteRoute('results/2026-09-06/harness-noop/do-rename-net/run-1.json')).toBe('results/2026-09-06/harness-noop/do-rename-net/run-1');
  });

  it('has no page for raw source files, so they go to GitHub', () => {
    expect(siteRoute('tasks/do-rename-net/task.json')).toBeNull();
    expect(siteRoute('tasks/do-rename-net/assertions.json')).toBeNull();
    expect(siteRoute('fixtures/antmicro-microphone-board/LICENSE')).toBeNull();
    expect(siteRoute('fixtures/antmicro-microphone-board/tree/hardware')).toBeNull();
    expect(siteRoute('schema/fixture.schema.json')).toBeNull();
    expect(siteRoute('paper')).toBeNull();
    expect(siteRoute('NOTICE')).toBeNull();
    expect(siteRoute('results/notes.md')).toBeNull();
  });

  it('normalizes without stripping a README, which GitHub links as a file', () => {
    expect(normalizeRepoPath('./tasks/x/README.md')).toBe('tasks/x/README.md');
    expect(normalizeRepoPath('tasks/x/')).toBe('tasks/x');
    expect(normalizeRepoPath('.')).toBe('');
    expect(githubUrl(REPO_URL, 'tasks/x/README.md', false)).toBe(`${REPO_URL}/blob/main/tasks/x/README.md`);
    expect(githubUrl(REPO_URL, 'scripts/', true)).toBe(`${REPO_URL}/tree/main/scripts`);
    expect(githubUrl(REPO_URL, '', false)).toBe(REPO_URL);
  });
});

describe('relativeHref', () => {
  it('climbs one level per path segment below the root, as the served URLs resolve', () => {
    expect(routeDepth('')).toBe(0);
    expect(routeDepth('/index.html')).toBe(0);
    expect(routeDepth('tasks')).toBe(0);
    expect(routeDepth('/tasks.html')).toBe(0);
    expect(routeDepth('tasks/do-rename-net')).toBe(1);
    expect(routeDepth('/tasks/do-rename-net.html')).toBe(1);
    expect(routeDepth('results/2026-09-06/harness-noop/do-rename-net/run-1')).toBe(4);

    expect(relativeHref('', 'standard')).toBe('./standard');
    expect(relativeHref('', '')).toBe('./');
    expect(relativeHref('tasks', 'tasks/do-rename-net')).toBe('./tasks/do-rename-net');
    expect(relativeHref('tasks/do-rename-net', 'fixtures/x')).toBe('../fixtures/x');
    expect(relativeHref('tasks/do-rename-net', '')).toBe('../');
    expect(relativeHref('results/2026-09-06/harness-noop/do-rename-net/run-1', 'standard#7-scoring')).toBe('../../../../standard#7-scoring');
  });
});

describe('rewriteMarkdownLink', () => {
  const dirs = new Set(['tasks', 'scripts', 'fixtures/antmicro-microphone-board/tree']);
  const ctx = (filePath: string) => ({ filePath, repoUrl: REPO_URL, isDirectory: (p: string) => dirs.has(p) });

  it('leaves absolute URLs and fragments alone', () => {
    for (const href of ['https://example.com/x', 'mailto:a@b.c', '#7-scoring', '//cdn.example/x', '/absolute']) {
      expect(rewriteMarkdownLink(href, ctx('STANDARD.md'))).toBe(href);
    }
  });

  it('sends a link to a rendered file to its page, relative to the page rendering the source', () => {
    expect(rewriteMarkdownLink('fixtures/FIXTURES.md', ctx('STANDARD.md'))).toBe('./fixtures');
    expect(rewriteMarkdownLink('../../fixtures/antmicro-microphone-board/', ctx('tasks/do-rename-net/README.md'))).toBe('../fixtures/antmicro-microphone-board');
    expect(rewriteMarkdownLink('../../fixtures/FIXTURES.md', ctx('tasks/do-rename-net/README.md'))).toBe('../fixtures');
    expect(rewriteMarkdownLink('../STANDARD.md#7-scoring', ctx('fixtures/FIXTURES.md'))).toBe('./standard#7-scoring');
    expect(rewriteMarkdownLink('antmicro-microphone-board/', ctx('fixtures/FIXTURES.md'))).toBe('./fixtures/antmicro-microphone-board');
    expect(rewriteMarkdownLink('../FIXTURES.md', ctx('fixtures/antmicro-microphone-board/README.md'))).toBe('../fixtures');
  });

  it('sends everything else to GitHub, as a blob or a tree', () => {
    expect(rewriteMarkdownLink('../schema/fixture.schema.json', ctx('fixtures/FIXTURES.md'))).toBe(`${REPO_URL}/blob/main/schema/fixture.schema.json`);
    expect(rewriteMarkdownLink('LICENSE', ctx('fixtures/antmicro-microphone-board/README.md'))).toBe(
      `${REPO_URL}/blob/main/fixtures/antmicro-microphone-board/LICENSE`,
    );
    expect(rewriteMarkdownLink('tree/', ctx('fixtures/antmicro-microphone-board/README.md'))).toBe(
      `${REPO_URL}/tree/main/fixtures/antmicro-microphone-board/tree`,
    );
    expect(rewriteMarkdownLink('../scripts', ctx('paper/README.md'))).toBe(`${REPO_URL}/tree/main/scripts`);
  });

  it('clamps a link that climbs above the repository root to the root', () => {
    expect(rewriteMarkdownLink('../../NOTICE', ctx('fixtures/FIXTURES.md'))).toBe(`${REPO_URL}/blob/main/NOTICE`);
  });
});

describe('collectFacts for the pages', () => {
  const facts = collectFacts(REPO);

  it('carries every task manifest and its assertion list verbatim', () => {
    for (const t of facts.tasks) {
      const dir = path.join(REPO, 'tasks', t.id);
      const manifest = JSON.parse(readFileSync(path.join(dir, 'task.json'), 'utf8')) as { request: { prompt?: string }; tags?: string[] };
      const assertions = JSON.parse(readFileSync(path.join(dir, 'assertions.json'), 'utf8')) as Array<{ id: string; type: string }>;
      expect(t.prompt).toBe(manifest.request.prompt ?? null);
      expect(t.tags).toEqual(manifest.tags ?? []);
      expect(t.assertions.map((a) => [a.id, a.type])).toEqual(assertions.map((a) => [a.id, a.type]));
      expect(t.manifestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(facts.fixtures.some((f) => f.id === t.fixture && f.sha256 === t.fixtureSha256)).toBe(true);
    }
  });

  it('carries every fixture with its provenance and an accounted-for baseline', () => {
    // FIXTURES.md section 5.2: a baseline error count may be non-zero, but
    // every error type must then be enumerated. The page shows the enumeration.
    const sums = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
    for (const f of facts.fixtures) {
      expect(f.commit).toMatch(/^[0-9a-f]{7,40}$/);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.boardLines).toBeGreaterThan(0);
      for (const check of [f.baseline.erc, f.baseline.drc]) {
        if (check.errors > 0) expect(sums(check.errorTypes)).toBe(check.errors);
        else expect(check.errorTypes).toEqual({});
      }
    }
  });

  it('lists every record under results/ with its comparability status', () => {
    const onDisk = loadRecords(path.join(REPO, 'results')).map((r) => r.relPath);
    expect(facts.records.map((r) => r.relPath)).toEqual(onDisk);
    const incomparable = new Set(facts.leaderboard.incomparable.map((r) => r.relPath));
    for (const r of facts.records) {
      expect(r.comparable).toBe(!incomparable.has(r.relPath));
      expect(r.reasons.length > 0).toBe(!r.comparable);
      expect(r.record.task.id).toBe(r.task);
    }
  });

  it('reads the price table without treating its comments as rows', () => {
    expect(facts.pricing.tableVersion).toMatch(/\S/);
    for (const m of facts.pricing.models) expect(m.id).not.toMatch(/^\$/);
    for (const r of facts.pricing.nullCostRoutes) expect(r.reason).toMatch(/\S/);
  });
});
