// Builds a minimal synthetic suite in a temp directory so validation refusal
// paths can be tested without mutating the vendored fixtures.
//
// Synthetic is correct *here* and wrong for benchmark fixtures (D20): these
// trees exist to exercise the validator's control flow, not to measure a model.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashFixtureTree } from '../scripts/lib/hash.ts';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UPSTREAM_URL = 'https://github.com/example/demo-board';

/** A schematic body that is valid enough to be a file; nothing parses it here. */
const DEMO_SCH = '(kicad_sch (version 20231120) (generator eeschema))\n';

export interface Suite {
  root: string;
  /** Rewrite a JSON file relative to the suite root. */
  patch(rel: string, fn: (json: any) => void): void;
  /** Write a raw file relative to the suite root. */
  write(rel: string, body: string): void;
  cleanup(): void;
}

export function makeSuite(): Suite {
  const root = mkdtempSync(path.join(tmpdir(), 'copperbench-suite-'));

  // The validator compiles the real schemas, so the synthetic suite carries them.
  cpSync(path.join(REPO, 'schema'), path.join(root, 'schema'), { recursive: true });

  const fixtureDir = path.join(root, 'fixtures', 'demo-board');
  mkdirSync(path.join(fixtureDir, 'tree'), { recursive: true });
  mkdirSync(path.join(fixtureDir, 'baseline'), { recursive: true });
  writeFileSync(path.join(fixtureDir, 'tree', 'demo.kicad_sch'), DEMO_SCH);
  writeFileSync(path.join(fixtureDir, 'README.md'), '# demo-board\n');
  writeFileSync(path.join(fixtureDir, 'LICENSE'), 'Apache-2.0\n');
  writeFileSync(path.join(fixtureDir, 'baseline', 'erc.json'), '{}\n');
  writeFileSync(path.join(fixtureDir, 'baseline', 'drc.json'), '{}\n');

  const { sha256 } = hashFixtureTree(path.join(fixtureDir, 'tree'));

  writeJson(path.join(fixtureDir, 'fixture.json'), {
    id: 'demo-board',
    sha256,
    complexity: 'simple',
    upstream: {
      name: 'Demo Board',
      url: UPSTREAM_URL,
      commit: 'a'.repeat(40),
      retrieved: '2026-01-15',
      license: 'Apache-2.0',
      licenseFile: 'LICENSE',
      copyright: 'Copyright (c) 2026 Example',
      modifications: 'No design file was altered.',
    },
    kicad: {
      authoredVersion: '8.0',
      fileFormatVersion: '20231120',
      verifiedWithKicadCli: '10.0.4',
    },
    artifacts: { schematic: 'demo.kicad_sch', board: null, project: null },
    scale: { schematicLines: 1, symbols: 1, sheets: 1 },
    baseline: {
      erc: { report: 'baseline/erc.json', errors: 0, warnings: 0 },
      drc: {
        report: 'baseline/drc.json',
        errors: 0,
        warnings: 0,
        unconnectedItems: 0,
        schematicParity: 0,
      },
    },
  });

  const taskDir = path.join(root, 'tasks', 'do-demo');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, 'README.md'), '# do-demo\n');
  writeJson(path.join(taskDir, 'task.json'), {
    id: 'do-demo',
    tier: 'simple',
    mode: 'do',
    fixture: { path: 'fixtures/demo-board', sha256 },
    request: { prompt: 'rename net A to B' },
    expectedOutcome: 'edit',
    caps: { turns: 10, wallClockSec: 600 },
    tags: ['demo'],
  });
  writeJson(path.join(taskDir, 'assertions.json'), [
    { id: 'net-present', type: 'net_present', args: { net: 'B' }, weight: 1, required: true },
  ]);

  writeFileSync(path.join(root, 'NOTICE'), `Demo Board\n${UPSTREAM_URL}\nApache-2.0\n`);

  return {
    root,
    patch(rel, fn) {
      const file = path.join(root, rel);
      const json = JSON.parse(readFileSync(file, 'utf8'));
      fn(json);
      writeJson(file, json);
    },
    write(rel, body) {
      writeFileSync(path.join(root, rel), body);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

