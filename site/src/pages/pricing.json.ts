// The price table as checked in, so the figure on the pricing page and the
// figure in a record can be checked against the same file without leaving
// the site.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO } from '../lib/facts';

export function GET(): Response {
  return new Response(readFileSync(path.join(REPO, 'pricing.json'), 'utf8'), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
