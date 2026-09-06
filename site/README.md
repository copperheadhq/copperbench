# site/

The copperbench website: one generated page, leaderboard first. An [Astro](https://astro.build/) project with no integrations, built statically.

`npm run site` renders `site/dist/` from the repository as checked out. Nothing on the page is typed by hand:

- The leaderboard, the discrimination check and every record count come from `results/` through [scripts/lib/leaderboard.ts](../scripts/lib/leaderboard.ts), the same aggregation `LEADERBOARD.md` and the paper tables will read. Records whose comparability stamp disagrees with the checked-out suite are listed with their reason and never averaged into a row.
- Task counts per tier come from `tasks/`, the fixture table from `fixtures/*/fixture.json`, the suite and schema versions from `scripts/lib/record.ts` and the build commit from git. All of it is read once per build by [scripts/lib/site-facts.ts](../scripts/lib/site-facts.ts), which lives under the root `tsconfig.json` and is tested in `test/leaderboard.test.ts`. The `.astro` files under `src/` only format what it returns.
- The only editorial input is [status.json](status.json), the timeline of what is done and what is next. Keep it free of numerals. A quantity belongs in a generated cell, not in prose that will go stale. A test enforces this.

`site/dist/` is derived and gitignored. It is published by [.github/workflows/site.yml](../.github/workflows/site.yml) on every push to `main`, which needs GitHub Pages set to deploy from Actions in the repository settings. Asset URLs are relative, so the same build serves at the root of a custom domain and under a project path on GitHub Pages. No domain is configured yet.

Astro needs Node 22.12 or newer. The rest of the repository runs on 20.

`npm run site:dev` runs Astro's dev server with live reload. `npm run site:serve` builds and previews `site/dist/`. The rendered page loads nothing from a CDN except its two typefaces and ships no client JavaScript beyond the tier tabs and the route filter.

Visual tokens follow the copperhead docs so the two sites read as one project. The layout follows the leaderboard-first shape benchmark sites converge on. Both are in [public/styles.css](public/styles.css).
