// The site is a static Astro build with no integrations. Pages read the
// repository at build time through scripts/lib/site-facts.ts; nothing runs in
// the browser except the tier tabs and the route filter.
//
// Asset URLs are relative on purpose, so the same build serves at the root of
// a custom domain and under a project path without a `base`. The site's
// origin is committed here because the canonical and Open Graph URLs must be
// absolute for link scrapers; SITE_URL in the build environment overrides it
// (a preview on its own hostname, say) and is normalized rather than trusted.

import { defineConfig } from 'astro/config';

const ORIGIN = 'https://copperbench.org/';

function siteUrl(raw) {
  if (!raw) return ORIGIN;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
}

export default defineConfig({
  site: siteUrl(process.env.SITE_URL),
  outDir: './dist',
  build: { format: 'file', assets: 'assets' },
  devToolbar: { enabled: false },
});
