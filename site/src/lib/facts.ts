// One read of the repository per build, shared by every page and endpoint.

import { collectFacts, findRepoRoot, type Facts } from '../../../scripts/lib/site-facts.ts';

export const REPO = findRepoRoot();

export const facts: Facts = collectFacts(REPO);

export const blob = (p: string): string => `${facts.repoUrl}/blob/main/${p}`;
export const tree = (p: string): string => `${facts.repoUrl}/tree/main/${p}`;

export function capitalize(s: string): string {
  return s.length === 0 ? s : `${s[0]?.toUpperCase()}${s.slice(1)}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
