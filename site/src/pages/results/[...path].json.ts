// The raw record beside its page, byte-for-byte the checked-in JSON as parsed
// and re-serialized, so a reader can fetch the evidence a page was rendered
// from without leaving the site.

import type { APIRoute } from 'astro';

import type { RecordFact } from '../../../../scripts/lib/site-facts.ts';
import { facts } from '../../lib/facts';

export function getStaticPaths() {
  return facts.records.map((record) => ({ params: { path: record.relPath.replace(/\.json$/, '') }, props: { record } }));
}

export const GET: APIRoute = ({ props }) => {
  const { record } = props as { record: RecordFact };
  return new Response(`${JSON.stringify(record.record, null, 2)}\n`, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
