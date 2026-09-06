// Copies the typefaces into site/public/fonts/ before a build.
//
// These are the same Fontsource packages the copperhead docs ship, Inter
// Variable and IBM Plex Mono, so the two sites set type identically. The
// stylesheets are copied as-is with the files they reference, which keeps
// their relative url(./files/...) paths working from any base path. Nothing
// is fetched from a CDN at render time. The output is derived and gitignored.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, '..');
const OUT = path.join(SITE, 'public', 'fonts');

/** Package, the stylesheets to ship from it, and the directory name under fonts/. */
const FONTS = [
  { pkg: '@fontsource-variable/inter', sheets: ['index.css'], dir: 'inter' },
  { pkg: '@fontsource/ibm-plex-mono', sheets: ['400.css', '500.css'], dir: 'ibm-plex-mono' },
];

let files = 0;
for (const { pkg, sheets, dir } of FONTS) {
  const src = path.join(ROOT, 'node_modules', pkg);
  const dest = path.join(OUT, dir);
  mkdirSync(path.join(dest, 'files'), { recursive: true });
  copyFileSync(path.join(src, 'LICENSE'), path.join(dest, 'LICENSE'));

  for (const sheet of sheets) {
    const css = readFileSync(path.join(src, sheet), 'utf8');
    copyFileSync(path.join(src, sheet), path.join(dest, sheet));
    for (const [, file] of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) {
      copyFileSync(path.join(src, 'files', file), path.join(dest, 'files', file));
      files += 1;
    }
  }
}

console.log(`fonts: ${FONTS.length} families, ${files} files into ${path.relative(process.cwd(), OUT)}`);
