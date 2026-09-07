// The site is a static Astro build with no integrations. Pages read the
// repository at build time through scripts/lib/site-facts.ts; nothing runs in
// the browser except the tier tabs and the route filter.
//
// Asset URLs are relative on purpose, so the same build serves at the root of
// a custom domain and under a project path without a `base`. SITE_URL, when
// set in the build environment, is the deployed origin: it makes the canonical
// and Open Graph URLs absolute, which link scrapers require.

import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL || undefined,
  outDir: './dist',
  build: { format: 'file', assets: 'assets' },
  devToolbar: { enabled: false },
});
