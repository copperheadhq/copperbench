// One read of the repository per build, shared by every page and endpoint.

import { collectFacts, findRepoRoot, type Facts } from '../../../scripts/lib/site-facts.ts';

export const REPO = findRepoRoot();

export const facts: Facts = collectFacts(REPO);

/**
 * The built whitepaper. paper/main.pdf is derived and gitignored, and the
 * site build machine has no LaTeX, so .github/workflows/paper.yml builds it on
 * main and force-pushes the one file to the orphan branch `paper-pdf`, where
 * GitHub renders it inline. This is the only place the site spells that
 * address.
 */
export const paperPdf = `${facts.repoUrl}/blob/paper-pdf/copperbench.pdf`;

/** The agent under test. */
export const copperheadUrl = 'https://docs.copperhead.sh/';

export function capitalize(s: string): string {
  return s.length === 0 ? s : `${s[0]?.toUpperCase()}${s.slice(1)}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Assertion or run outcome as the class suffix the stylesheet keys on. */
export function verdictClass(status: string): string {
  return `verdict verdict-${status}`;
}

/** One line of `key: value` pairs for an assertion's arguments, so a table cell stays a cell. */
export function argsText(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('  ');
}

/** The `results/<relPath>` record as a site path, i.e. without the `.json`. */
export function recordRoute(relPath: string): string {
  return `results/${relPath.replace(/\.json$/, '')}`;
}
