#!/usr/bin/env node
// Build the whitepaper and render it to page images.
//
// Two outputs on every build, per paper/README.md: `paper/main.pdf` for reading
// and submission, and `paper/render/page-NN.png` for looking at a diff without
// opening a viewer. The render is a derived artifact, gitignored alongside the
// other LaTeX build output; paper/generated/ is the only committed emission.
//
// latexmk is preferred and is what the reference environment has. When it is
// absent the pdflatex/bibtex sequence below is run directly rather than failing,
// because a missing convenience wrapper should not be the reason a paper cannot
// be built. Neither path touches paper/generated/, which comes from a result
// snapshot (task 8.2), not from the LaTeX run.
//
// Usage:
//   node scripts/build-paper.mjs            # build, then render
//   node scripts/build-paper.mjs --no-render # PDF only
//   node scripts/build-paper.mjs --dpi 150   # render resolution, default 110

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const paperDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'paper');
const renderDir = path.join(paperDir, 'render');

const argv = process.argv.slice(2);
const render = !argv.includes('--no-render');
const dpi = argv.includes('--dpi') ? argv[argv.indexOf('--dpi') + 1] : '110';

function has(cmd) {
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
}

function run(cmd, args, { tolerate = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: paperDir, stdio: 'inherit' });
  if (r.status !== 0 && !tolerate) {
    console.error(`\n${cmd} failed with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
  return r.status;
}

if (has('latexmk')) {
  run('latexmk', ['-pdf', '-interaction=nonstopmode', 'main.tex']);
} else if (has('pdflatex')) {
  console.log('latexmk not found; running pdflatex directly');
  run('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'main.tex']);
  // Citations are undefined on the first pass, so bibtex has nothing to resolve
  // until the .aux exists. It is tolerated: the skeleton must build before the
  // bibliography is verified.
  if (has('bibtex')) run('bibtex', ['main'], { tolerate: true });
  run('pdflatex', ['-interaction=nonstopmode', 'main.tex']);
  run('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'main.tex']);
} else {
  console.error('No LaTeX toolchain found. Install texlive (latexmk preferred).');
  process.exit(127);
}

if (!render) process.exit(0);

if (!has('pdftoppm')) {
  console.warn('pdftoppm not found (poppler-utils); skipping page render. PDF is at paper/main.pdf');
  process.exit(0);
}

// Stale pages from a longer previous revision would otherwise survive a build
// that produced fewer, which is exactly the drift this repository treats as a
// build failure everywhere else.
rmSync(renderDir, { recursive: true, force: true });
mkdirSync(renderDir, { recursive: true });
run('pdftoppm', ['-png', '-r', dpi, 'main.pdf', path.join('render', 'page')]);

const pages = existsSync(renderDir) ? readdirSync(renderDir).filter((f) => f.endsWith('.png')) : [];
console.log(`\npaper/main.pdf and ${pages.length} page images in paper/render/ at ${dpi} dpi`);
