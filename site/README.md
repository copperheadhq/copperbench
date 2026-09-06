# site/

The copperbench website: one generated page, leaderboard first. An [Astro](https://astro.build/) project with no integrations, built statically.

`npm run site` renders `site/dist/` from the repository as checked out. Nothing on the page is typed by hand:

- The leaderboard, the discrimination check and every record count come from `results/` through [scripts/lib/leaderboard.ts](../scripts/lib/leaderboard.ts), the same aggregation `LEADERBOARD.md` and the paper tables will read. Records whose comparability stamp disagrees with the checked-out suite are listed with their reason and never averaged into a row.
- Task counts per tier come from `tasks/`, the fixture table from `fixtures/*/fixture.json`, the suite and schema versions from `scripts/lib/record.ts` and the build commit from git. All of it is read once per build by [scripts/lib/site-facts.ts](../scripts/lib/site-facts.ts), which lives under the root `tsconfig.json` and is tested in `test/leaderboard.test.ts`. The `.astro` files under `src/` only format what it returns.
- The only editorial input is [status.json](status.json), the timeline of what is done and what is next. Keep it free of numerals. A quantity belongs in a generated cell, not in prose that will go stale. A test enforces this.

`site/dist/` is derived and gitignored. It is served by a Cloudflare Worker as static assets, configured in [wrangler.jsonc](../wrangler.jsonc) at the repository root, and deployed by Cloudflare's GitHub integration rather than by a workflow in this repository. Connect it once in the Cloudflare dashboard, Workers & Pages → Create → Import a repository, with these settings:

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `npm run site` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Production branch | `main` |

Cloudflare installs with `npm ci`, reads the Node version from [.node-version](../.node-version) (Astro needs 22.12 or newer; the rest of the repository runs on 20), and takes the Worker name and asset directory from `wrangler.jsonc`. Every push to `main` deploys. Every other branch and pull request gets a preview version on its own workers.dev URL, reported as a check on the commit. No custom domain is configured yet; `wrangler.jsonc` shows where one goes. `npm run site:deploy` deploys from a machine after `npx wrangler login`.

`npm run site:dev` runs Astro's dev server with live reload. `npm run site:serve` builds and previews `site/dist/`. The rendered page loads nothing from any CDN and ships no client JavaScript beyond the tier tabs and the route filter. The typefaces are the Fontsource packages the copperhead docs ship, Inter Variable and IBM Plex Mono, copied into `public/fonts/` by [copy-fonts.mjs](copy-fonts.mjs) before each build.

Type, sizing, color and icons follow the copperhead sites so the two read as one project: the same fonts, Starlight's type scale and line heights, the same gray ramp and copper accent, and the same fiducial mark on the same dark tile for the favicon, touch icon and manifest icons in `public/`. The layout follows the leaderboard-first shape benchmark sites converge on. Both are in [public/styles.css](public/styles.css).
