// The repository's own markdown, rendered on the site as pages. The
// collection reads from the repository root, not from src/, so a page is
// the checked-in document and cannot drift from it. Ids are the repository
// paths verbatim, so a page asks for `tasks/<id>/README.md` and the
// link-rewriting plugin in astro.config.mjs knows where each file lives.

import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';

import { findRepoRoot } from '../../scripts/lib/site-facts.ts';

export const collections = {
  docs: defineCollection({
    loader: glob({
      base: findRepoRoot(),
      pattern: ['STANDARD.md', 'fixtures/FIXTURES.md', 'fixtures/*/README.md', 'tasks/*/README.md', 'paper/README.md'],
      generateId: ({ entry }) => entry,
    }),
  }),
};
