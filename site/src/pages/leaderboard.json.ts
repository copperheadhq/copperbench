// The data the page was rendered from, so a reader can check any cell against
// it without rebuilding.

import { facts } from '../lib/facts';

export function GET(): Response {
  return new Response(`${JSON.stringify(facts.leaderboard, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
