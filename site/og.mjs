// Renders the Open Graph image, site/public/og.png, before a build.
//
// Minimal on purpose: the fiducial mark, the wordmark and one line, on the
// same ground the page uses, at the 1200x630 every scraper expects. Text is
// set in the same Inter the page uses, decoded from the Fontsource woff2 files
// already in node_modules, so the image needs no system font and renders the
// same on Cloudflare's build image as here. The mark is read from
// public/mark.svg, the asset the page and the favicon share. The output is
// derived and gitignored, unlike the icons beside it, because it is cheap to
// regenerate and would otherwise drift from the copy it renders.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import decompress from 'wawoff2/decompress.js';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SITE, '..');
const OUT = path.join(SITE, 'public', 'og.png');

const WIDTH = 1200;
const HEIGHT = 630;

// The fiducial mark, exactly as public/mark.svg draws it: the file's own
// elements inside its 22.75-unit box, placed and scaled here.
const markSvg = readFileSync(path.join(SITE, 'public', 'mark.svg'), 'utf8');
const MARK = `<g transform="translate(96 214) scale(6.4) translate(-4.625 -4.625)">${markSvg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g>`;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#1b1b1c"/>
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="#b87333"/>
  ${MARK}
  <text x="270" y="300" font-family="Inter" font-weight="600" font-size="104" letter-spacing="-2" fill="#f7f8f8">copperbench</text>
  <text x="272" y="370" font-family="Inter" font-weight="400" font-size="30" fill="#b3b8be">Language-model agents on verified KiCad hardware edits.</text>
  <text x="272" y="418" font-family="Inter" font-weight="400" font-size="30" fill="#e6a366">Grading never calls a model.</text>
  <text x="96" y="566" font-family="Inter" font-weight="400" font-size="24" fill="#8a9098">Real boards · kicad-cli as the oracle · cost reported beside pass rate</text>
</svg>`;

// The static faces: resvg renders a variable font at its default weight only.
// It loads fonts from files (its in-memory fontBuffers option registers the
// face under a name it then fails to match, falling back to a serif), so the
// woff2 faces are decoded to TTF beside the render and removed afterwards.
const fontsDir = mkdtempSync(path.join(tmpdir(), 'copperbench-og-'));
try {
  const fontFiles = [];
  for (const weight of [400, 600]) {
    const woff2 = readFileSync(path.join(ROOT, 'node_modules', '@fontsource', 'inter', 'files', `inter-latin-${weight}-normal.woff2`));
    const ttf = path.join(fontsDir, `inter-${weight}.ttf`);
    // Written at once: wawoff2 returns a view into its wasm heap that the next call reuses.
    writeFileSync(ttf, await decompress(woff2));
    fontFiles.push(ttf);
  }

  const png = new Resvg(SVG, { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'Inter' } })
    .render()
    .asPng();
  writeFileSync(OUT, png);
  console.log(`og: ${path.relative(process.cwd(), OUT)} ${WIDTH}x${HEIGHT}, ${png.length} bytes`);
} finally {
  rmSync(fontsDir, { recursive: true, force: true });
}
