#!/usr/bin/env node
// Suite validation (tasks.md 2.8).
//
// Refuses a suite before any run starts, for the reasons STANDARD.md section 2
// gives: an assertion type outside the closed vocabulary is a validation error
// rather than a skipped check, and a fixture whose tree does not hash to its
// recorded value is refused rather than run against.
//
// LLM-free and network-free, like everything else on the grading path. It reads
// only files under the suite root it is given.
//
// Usage:
//   npm run validate
//   npm run validate -- --json

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { hashFixtureTree } from './lib/hash.ts';

/**
 * Parity issue types that disqualify a fixture (D23, fixtures/FIXTURES.md 5.2).
 *
 * This is a denylist of the structural types rather than an allowlist of the
 * tolerable ones, because the normative documents enumerate exactly these three
 * as disqualifying and leave metadata drift open-ended: real boards carry
 * `footprint_symbol_field_mismatch` (Description and LCSC Part fields differing)
 * and `footprint_symbol_mismatch` (attribute flags such as "Do not populate"),
 * neither of which is electrical. An allowlist would reject vendored fixtures
 * for carrying a benign type nobody thought to name. A novel structural type is
 * caught by the human vetting step in FIXTURES.md section 7, not here.
 */
const STRUCTURAL_PARITY_TYPES = new Set([
  'duplicate_footprints',
  'extra_footprint',
  'missing_footprint',
]);

export interface Finding {
  /** Where the problem is, relative to the suite root. */
  where: string;
  /** What is wrong, in one line. */
  what: string;
  /** Optional detail lines, printed indented. */
  detail?: string[];
}

export interface ValidationResult {
  ok: boolean;
  fixtures: number;
  tasks: number;
  findings: Finding[];
}

interface Ctx {
  root: string;
  findings: Finding[];
  validateTask: Validator;
  validateAssertions: Validator;
  validateFixture: Validator;
}

interface FixtureRecord {
  id: string;
  sha256: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(ctx: Ctx, where: string, what: string, detail?: string[]): void {
  ctx.findings.push(detail ? { where, what, detail } : { where, what });
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Schema compilation
// ---------------------------------------------------------------------------

type Validator = (data: unknown) => boolean;

interface AjvError {
  instancePath: string;
  message?: string | undefined;
  params: Record<string, unknown>;
}

function compileSchemas(root: string): Pick<Ctx, 'validateTask' | 'validateAssertions' | 'validateFixture'> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });

  // The schemas use exactly two formats. Declaring them here rather than
  // pulling in ajv-formats keeps the dependency surface at one package and
  // makes what is actually checked visible at the point of use.
  ajv.addFormat('uri', /^[a-z][a-z0-9+.-]*:\/\/\S+$/i);
  ajv.addFormat('date', (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    // Round-trips only for a real calendar date, so 2026-02-31 is rejected.
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });

  const load = (name: string) => ajv.compile(readJson(path.join(root, 'schema', name)) as object) as Validator;
  return {
    validateTask: load('task.schema.json'),
    validateAssertions: load('assertions.schema.json'),
    validateFixture: load('fixture.schema.json'),
  };
}

function checkSchema(ctx: Ctx, v: Validator, data: unknown, where: string, label: string): boolean {
  if (v(data)) return true;
  const errors = ((v as { errors?: AjvError[] | null }).errors ?? []) as AjvError[];
  const detail = errors.map((e) => {
    const at = e.instancePath || '(root)';
    // allowedValues carries the closed vocabulary on an enum failure, which is
    // exactly what an author who mistyped an assertion type needs to see.
    const allowed = e.params['allowedValues'] as unknown[] | undefined;
    return allowed ? `${at}: ${e.message} — ${allowed.join(', ')}` : `${at}: ${e.message}`;
  });
  fail(ctx, where, `${label} does not satisfy its schema`, detail);
  return false;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validateFixtures(ctx: Ctx, notice: string): Map<string, FixtureRecord> {
  const byId = new Map<string, FixtureRecord>();
  const fixturesRoot = path.join(ctx.root, 'fixtures');

  for (const name of listDirs(fixturesRoot)) {
    const dir = path.join(fixturesRoot, name);
    const rel = `fixtures/${name}`;
    const manifestPath = path.join(dir, 'fixture.json');

    for (const required of ['fixture.json', 'README.md', 'tree']) {
      if (!existsSync(path.join(dir, required))) fail(ctx, rel, `missing required entry ${required}`);
    }
    if (!existsSync(manifestPath)) continue;

    const manifest = readJson(manifestPath) as Record<string, any>;
    if (!checkSchema(ctx, ctx.validateFixture, manifest, `${rel}/fixture.json`, 'fixture manifest')) {
      continue;
    }

    if (manifest['id'] !== name) {
      fail(ctx, rel, `fixture id "${manifest['id']}" does not match its directory name "${name}"`);
    }
    if (byId.has(manifest['id'])) fail(ctx, rel, `duplicate fixture id "${manifest['id']}"`);

    // The recorded hash is the whole point of pinning: verify it rather than
    // trusting it. Only tree/ is hashed, so metadata edits never invalidate it.
    const treeDir = path.join(dir, 'tree');
    if (existsSync(treeDir)) {
      const { sha256, files } = hashFixtureTree(treeDir);
      if (sha256 !== manifest['sha256']) {
        fail(ctx, rel, 'fixture tree hash does not match fixture.json', [
          `expected ${manifest['sha256']}`,
          `actual   ${sha256}`,
          `${files.length} files hashed`,
        ]);
      }
    }

    // Provenance files must actually be present, not merely named.
    const named: Array<[string, unknown]> = [
      ['upstream.licenseFile', manifest['upstream']?.licenseFile],
      ['baseline.erc.report', manifest['baseline']?.erc?.report],
      ['baseline.drc.report', manifest['baseline']?.drc?.report],
    ];
    for (const [field, value] of named) {
      if (typeof value === 'string' && !existsSync(path.join(dir, value))) {
        fail(ctx, rel, `${field} points at a missing file: ${value}`);
      }
    }

    const schematic = manifest['artifacts']?.schematic;
    if (typeof schematic === 'string') {
      if (!existsSync(path.join(treeDir, schematic))) {
        fail(ctx, rel, `artifacts.schematic is not present in tree/: ${schematic}`);
      }
      // Legacy KiCad projects are rejected rather than converted.
      if (schematic.endsWith('.sch')) {
        fail(ctx, rel, `legacy KiCad schematic format is not admissible: ${schematic}`);
      }
    }

    checkBaselineAccounting(ctx, rel, manifest);

    // Every vendored design carries a third-party attribution obligation.
    const url = manifest['upstream']?.url;
    if (typeof url === 'string' && !notice.includes(url)) {
      fail(ctx, rel, `no NOTICE entry found for upstream ${url}`);
    }

    byId.set(manifest['id'], { id: manifest['id'], sha256: manifest['sha256'] });
  }

  return byId;
}

/**
 * D23: a baseline error count may be non-zero, but every error type must be
 * enumerated, and that enumeration is an allowlist. The schema enforces that
 * errorTypes is *present*; this enforces that it actually accounts for the
 * count, which is what makes the allowlist meaningful.
 */
function checkBaselineAccounting(ctx: Ctx, rel: string, manifest: Record<string, any>): void {
  for (const kind of ['erc', 'drc'] as const) {
    const b = manifest['baseline']?.[kind];
    if (!b) continue;

    const errors: number = b.errors ?? 0;
    const types: Record<string, number> = b.errorTypes ?? {};
    const sum = Object.values(types).reduce((a, n) => a + n, 0);

    if (errors > 0 && sum !== errors) {
      fail(ctx, rel, `baseline.${kind}.errorTypes accounts for ${sum} of ${errors} errors`, [
        'The enumeration is the allowlist the no_new_violations assertions grade against.',
        'An unaccounted error is indistinguishable from an agent-introduced one.',
      ]);
    }
    if (errors === 0 && sum > 0) {
      fail(ctx, rel, `baseline.${kind}.errorTypes enumerates ${sum} errors but errors is 0`);
    }
  }

  const drc = manifest['baseline']?.drc;
  if (!drc) return;

  // Unconnected items are what a bad edit breaks. A fixture that starts with
  // them cannot distinguish a break from its own starting state.
  if ((drc.unconnectedItems ?? 0) > 0) {
    fail(ctx, rel, `baseline.drc.unconnectedItems is ${drc.unconnectedItems}, must be 0`);
  }

  // Structural parity issues disqualify; metadata drift is recordable (D23).
  if ((drc.schematicParity ?? 0) > 0) {
    const parityTypes: Record<string, number> = drc.schematicParityTypes ?? {};
    const structural = Object.keys(parityTypes).filter((t) => STRUCTURAL_PARITY_TYPES.has(t));
    if (structural.length > 0) {
      fail(ctx, rel, `baseline.drc has structural parity issues: ${structural.join(', ')}`, [
        'Structural parity issues disqualify a fixture; only metadata drift is recordable.',
      ]);
    }
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function validateTasks(ctx: Ctx, fixtures: Map<string, FixtureRecord>): void {
  const tasksRoot = path.join(ctx.root, 'tasks');
  const ids = new Set<string>();
  const variantRefs: Array<{ rel: string; of: string }> = [];

  for (const name of listDirs(tasksRoot)) {
    const dir = path.join(tasksRoot, name);
    const rel = `tasks/${name}`;

    // A task is exactly these three files. Anything else is code creeping in.
    for (const required of ['task.json', 'assertions.json', 'README.md']) {
      if (!existsSync(path.join(dir, required))) fail(ctx, rel, `missing required file ${required}`);
    }
    const taskPath = path.join(dir, 'task.json');
    if (!existsSync(taskPath)) continue;

    const task = readJson(taskPath) as Record<string, any>;
    if (!checkSchema(ctx, ctx.validateTask, task, `${rel}/task.json`, 'task manifest')) continue;

    if (task['id'] !== name) {
      fail(ctx, rel, `task id "${task['id']}" does not match its directory name "${name}"`);
    }
    if (ids.has(task['id'])) fail(ctx, rel, `duplicate task id "${task['id']}"`);
    ids.add(task['id']);

    if (task['variantOf']) variantRefs.push({ rel, of: task['variantOf'] });

    validateTaskFixture(ctx, rel, task, fixtures);
    validateTaskAssertions(ctx, rel, dir);

    if (task['mode'] === 'create' && !task['request']?.briefPath) {
      fail(ctx, rel, 'create-mode task must declare request.briefPath');
    }
    if ((task['mode'] === 'do' || task['mode'] === 'sync') && !task['request']?.prompt) {
      fail(ctx, rel, `${task['mode']}-mode task must declare request.prompt`);
    }
    if (task['rubric'] && !existsSync(path.join(ctx.root, task['rubric']))) {
      fail(ctx, rel, `rubric points at a missing file: ${task['rubric']}`);
    }
  }

  for (const { rel, of } of variantRefs) {
    if (!ids.has(of)) fail(ctx, rel, `variantOf names a task that does not exist: "${of}"`);
  }
}

function validateTaskFixture(
  ctx: Ctx,
  rel: string,
  task: Record<string, any>,
  fixtures: Map<string, FixtureRecord>,
): void {
  const fixturePath: string = task['fixture']?.path ?? '';
  const id = fixturePath.replace(/^fixtures\//, '').replace(/\/$/, '');
  const fixture = fixtures.get(id);

  if (!fixture) {
    fail(ctx, rel, `fixture.path does not name a known fixture: ${fixturePath}`);
    return;
  }
  // Both records carry the hash; a disagreement means one was edited without
  // the other, which is exactly the drift that pinning exists to stop.
  if (task['fixture'].sha256 !== fixture.sha256) {
    fail(ctx, rel, 'task fixture.sha256 disagrees with the fixture manifest', [
      `task.json      ${task['fixture'].sha256}`,
      `fixture.json   ${fixture.sha256}`,
    ]);
  }
}

function validateTaskAssertions(ctx: Ctx, rel: string, dir: string): void {
  const file = path.join(dir, 'assertions.json');
  if (!existsSync(file)) return;

  const assertions = readJson(file) as Array<Record<string, any>>;
  if (!checkSchema(ctx, ctx.validateAssertions, assertions, `${rel}/assertions.json`, 'assertion list')) {
    return;
  }

  const seen = new Set<string>();
  let required = 0;
  for (const a of assertions) {
    if (seen.has(a['id'])) fail(ctx, rel, `duplicate assertion id "${a['id']}"`);
    seen.add(a['id']);
    if (a['required']) required += 1;
  }
  // Strict pass is "all required assertions passed". With none, every run passes.
  if (required === 0) fail(ctx, rel, 'no assertion is marked required, so the task cannot fail');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate a suite rooted at `root`. Pure: reads files, returns findings. */
export function validateSuite(root: string): ValidationResult {
  const ctx: Ctx = { root, findings: [], ...compileSchemas(root) };

  const noticePath = path.join(root, 'NOTICE');
  if (!existsSync(noticePath)) {
    fail(ctx, 'NOTICE', 'missing: every vendored fixture needs a third-party attribution entry');
  }
  const notice = existsSync(noticePath) ? readFileSync(noticePath, 'utf8') : '';

  const fixtures = validateFixtures(ctx, notice);
  validateTasks(ctx, fixtures);

  return {
    ok: ctx.findings.length === 0,
    fixtures: fixtures.size,
    tasks: listDirs(path.join(root, 'tasks')).length,
    findings: ctx.findings,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = validateSuite(root);

  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  if (result.ok) {
    console.log(`ok  ${result.fixtures} fixtures, ${result.tasks} tasks, 0 findings`);
    return 0;
  }

  for (const f of result.findings) {
    console.error(`FAIL ${f.where}: ${f.what}`);
    for (const line of f.detail ?? []) console.error(`       ${line}`);
  }
  const n = result.findings.length;
  console.error(`\n${n} finding${n === 1 ? '' : 's'}`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
