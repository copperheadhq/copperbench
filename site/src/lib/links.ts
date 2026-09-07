// Every href on the site is relative to the page it appears on, because the
// asset URLs are relative and one build must serve at a domain root or under
// a path. A component passes `Astro.url.pathname` and gets back a link that
// resolves from that page.

import { githubUrl, isDirectoryIn, normalizeSitePath, relativeHref, siteRoute } from '../../../scripts/lib/site-routes.ts';
import { REPO, facts } from './facts';

/** The site path of the page being rendered, from `Astro.url.pathname`: `''` for the front page. */
export function currentRoute(pathname: string): string {
  return normalizeSitePath(pathname);
}

/** A relative link from the page at `pathname` to a site path such as `tasks/do-rename-net` or `standard#7-scoring`. */
export function to(pathname: string, sitePath: string): string {
  return relativeHref(currentRoute(pathname), sitePath);
}

const isDirectory = isDirectoryIn(REPO);

/** A link to a repository path: its page on the site when one exists, otherwise its address on GitHub. */
export function repoHref(pathname: string, repoPath: string): string {
  const route = siteRoute(repoPath);
  return route === null ? githubUrl(facts.repoUrl, repoPath, isDirectory(repoPath)) : to(pathname, route);
}

/** Whether a repository path has a page on the site, for deciding whether to mark a link as external. */
export function onSite(repoPath: string): boolean {
  return siteRoute(repoPath) !== null;
}

/** The GitHub address of a repository path, for the "source" links beside rendered content. */
export function github(repoPath: string): string {
  return githubUrl(facts.repoUrl, repoPath, isDirectory(repoPath));
}
