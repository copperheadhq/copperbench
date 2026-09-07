// Which repository paths the website renders as pages, and where.
//
// The site is generated from the repository, so a link to a repository path
// has a page on the site whenever the site renders that path. The map below
// is the one place that says which paths those are. Everything that links to
// a repository path goes through it: the sidebar, the tables, the status
// timeline and the links inside the rendered markdown. A path without a page
// links to the repository on GitHub instead, so a reader is never sent
// off-site for something the site can show.

import path from 'node:path';

const RECORD = /^results\/(\d{4}-\d{2}-\d{2}\/[^/]+\/[^/]+\/run-\d+)\.json$/;

/** Normalize a repository path: posix separators, no leading `./`, no trailing slash, `''` for the root. */
export function normalizeRepoPath(p: string): string {
  const posix = path.posix.normalize(p.replace(/\\/g, '/'));
  const trimmed = posix.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  return trimmed === '.' ? '' : trimmed;
}

/**
 * The site path (no leading slash, no extension) that renders a repository
 * path, or null when the site has no page for it. `''` is the front page. A
 * directory's README is the directory: the page for a task renders its
 * README, so a link to either lands there.
 */
export function siteRoute(repoPath: string): string | null {
  const p = normalizeRepoPath(repoPath).replace(/(^|\/)README\.md$/, '$1').replace(/\/+$/, '');
  if (p === '') return '';
  if (p === 'STANDARD.md') return 'standard';
  if (p === 'pricing.json') return 'pricing';
  if (p === 'tasks') return 'tasks';
  if (p === 'fixtures' || p === 'fixtures/FIXTURES.md') return 'fixtures';
  if (p === 'results') return 'results';
  const task = /^tasks\/([^/]+)$/.exec(p);
  if (task) return `tasks/${task[1]}`;
  const fixture = /^fixtures\/([^/]+)$/.exec(p);
  if (fixture) return `fixtures/${fixture[1]}`;
  const record = RECORD.exec(p);
  if (record) return `results/${record[1]}`;
  return null;
}

/** The GitHub address of a repository path on the main branch. */
export function githubUrl(repoUrl: string, repoPath: string, isDirectory: boolean): string {
  const p = normalizeRepoPath(repoPath);
  if (p === '') return repoUrl;
  return `${repoUrl}/${isDirectory ? 'tree' : 'blob'}/main/${p}`;
}

/**
 * Depth of a site path: how many `../` a relative link from it needs to reach
 * the site root. The build writes `tasks/do-rename-net.html`, served without
 * the extension, so `tasks/do-rename-net` is one level down and `tasks` is
 * at the root, exactly as the served URLs resolve relative links.
 */
export function routeDepth(sitePath: string): number {
  const clean = sitePath
    .replace(/\.html$/, '')
    .replace(/(^|\/)index$/, '$1')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return clean === '' ? 0 : clean.split('/').length - 1;
}

/**
 * A relative href from one site path to another. Relative on purpose: the
 * site's asset URLs are relative so one build serves at the root of a domain
 * or under a project path. `''` as the target is the front page.
 */
export function relativeHref(fromSitePath: string, toSitePath: string): string {
  const depth = routeDepth(fromSitePath);
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  return `${prefix}${toSitePath}`;
}

export interface RewriteContext {
  /** Repository-relative path of the markdown file the link appears in. */
  filePath: string;
  repoUrl: string;
  /** Whether the resolved repository path is a directory; consulted only for GitHub links. */
  isDirectory: (repoPath: string) => boolean;
}

/**
 * Rewrite one href from a markdown file that lives in the repository so it
 * works on the site: a relative path to a rendered file becomes a relative
 * link to its page, any other relative path becomes a GitHub link, and
 * absolute URLs and same-page fragments pass through untouched.
 */
export function rewriteMarkdownLink(href: string, ctx: RewriteContext): string {
  if (href === '' || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//') || href.startsWith('/')) {
    return href;
  }
  const hashAt = href.indexOf('#');
  const target = hashAt === -1 ? href : href.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : href.slice(hashAt);

  const fileDir = path.posix.dirname(ctx.filePath.replace(/\\/g, '/'));
  // A link that climbs above the repository root is clamped to the root: the
  // author meant a repository path, and GitHub renders it that way too.
  const resolved = path.posix.normalize(path.posix.join(fileDir, decodeURI(target))).replace(/^(\.\.\/)+/, '').replace(/^\.\.$/, '');
  const repoPath = normalizeRepoPath(resolved);

  const from = siteRoute(ctx.filePath) ?? '';
  const route = siteRoute(repoPath);
  if (route !== null) return `${relativeHref(from, route)}${fragment}`;
  return `${githubUrl(ctx.repoUrl, repoPath, ctx.isDirectory(repoPath))}${fragment}`;
}
