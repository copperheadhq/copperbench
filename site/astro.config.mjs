// The site is a static Astro build with no integrations. Pages read the
// repository at build time through scripts/lib/site-facts.ts, and the
// repository's own markdown (STANDARD.md, FIXTURES.md, the task and fixture
// READMEs) is rendered through a content collection (src/content.config.ts).
// The paper is not rendered: its links point at the built PDF, see
// src/lib/facts.ts. Nothing runs in the browser except the tier tabs,
// the route filter and the narrow-screen menu.
//
// Asset URLs are relative on purpose, so the same build serves at the root of
// a custom domain and under a project path without a `base`. The site's
// origin is committed here because the canonical and Open Graph URLs must be
// absolute for link scrapers; SITE_URL in the build environment overrides it
// (a preview on its own hostname, say) and is normalized rather than trusted.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { satteri } from '@astrojs/markdown-satteri';
import { defineConfig } from 'astro/config';

import { findRepoRoot, repoUrlOf } from '../scripts/lib/site-facts.ts';
import { isDirectoryIn, rewriteMarkdownLink } from '../scripts/lib/site-routes.ts';

const ORIGIN = 'https://copperbench.org/';

function siteUrl(raw) {
  if (!raw) return ORIGIN;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.endsWith('/') ? withScheme : `${withScheme}/`;
}

const REPO = findRepoRoot();
const REPO_URL = repoUrlOf(REPO);
const isDirectory = isDirectoryIn(REPO);

// Markdown in the repository links to other repository paths relative to
// itself, the way GitHub renders it. On the site those links point at the
// page that renders the target when there is one, and at GitHub otherwise.
// The rule lives in scripts/lib/site-routes.ts; this plugin only applies it.
function repoLinks(ctx) {
  if (!ctx.fileURL) return null;
  const filePath = path.relative(REPO, fileURLToPath(ctx.fileURL)).split(path.sep).join('/');
  if (filePath.startsWith('..')) return null;
  return {
    name: 'repo-links',
    element: {
      filter: ['a'],
      visit(node, c) {
        const href = node.properties?.href;
        if (typeof href !== 'string') return;
        const rewritten = rewriteMarkdownLink(href, { filePath, repoUrl: REPO_URL, isDirectory });
        if (rewritten !== href) c.setProperty(node, 'href', rewritten);
      },
    },
  };
}

export default defineConfig({
  site: siteUrl(process.env.SITE_URL),
  outDir: './dist',
  build: { format: 'file', assets: 'assets' },
  // Relative links are computed for the extensionless address the asset
  // router serves (tasks/x, never tasks/x/). Refusing the slashed form in the
  // dev server too keeps a page from resolving its links one level deep
  // there, where no redirect saves it.
  trailingSlash: 'never',
  devToolbar: { enabled: false },
  markdown: {
    // One dark theme, matching the page; the stylesheet overrides the block
    // background so a code block sits on the same surface as inline code.
    shikiConfig: { theme: 'github-dark' },
    processor: satteri({ hastPlugins: [repoLinks] }),
  },
});
