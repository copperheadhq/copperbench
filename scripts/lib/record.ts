// Result records (STANDARD.md section 13, D14, D19).
//
// One JSON record per run, append-only, self-describing enough to interpret and
// re-score in isolation. Every record carries the comparability stamp, because
// segregation has to be mechanical rather than remembered.
//
// Before anything is written under results/, it is scanned against the
// credential pattern set and a match HARD-FAILS rather than being scrubbed:
// benchmark output is the surface most likely to be published.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';

import type { Score } from './score.ts';
import { scanForSecrets } from './secrets.ts';

export const SCHEMA_VERSION = '1.0.0';
export const SUITE_VERSION = '0.1.0';

export interface RecordInput {
  taskId: string;
  tier: string;
  mode: string;
  expectedOutcome: string;
  model: string;
  repeat: number;
  fixtureId: string;
  fixtureSha256: string;
  taskManifestHash: string;
  baselineSha: string;
  runMode: string;
  llmCache: false;
  setupSkipped: Array<{ command: string; reason: string }>;
  durationMs: number;
  score: Score;
}

export interface ComparabilityStamp {
  schemaVersion: string;
  suiteVersion: string;
  taskManifestHash: string;
  fixtureSha256: string;
  copperheadVersion: string;
  copperheadCommit: string | null;
  kicadCliVersion: string | null;
  nodeVersion: string;
  platform: string;
}

/** SHA-256 of a task's manifest pair, so a task edit is mechanically visible. */
export function taskManifestHash(taskDir: string): string {
  const h = createHash('sha256');
  for (const name of ['task.json', 'assertions.json']) {
    h.update(name, 'utf8');
    h.update(Buffer.from([0]));
    h.update(readFileSync(path.join(taskDir, name)));
  }
  return h.digest('hex');
}

let kicadCliVersion: string | null | undefined;

/**
 * The installed kicad-cli version, or null when it is absent. Probed once per
 * process: the answer cannot change mid-run, and every record, every
 * verification assertion, and the runner's own environment check read it.
 */
export function detectKicadCliVersion(): string | null {
  if (kicadCliVersion !== undefined) return kicadCliVersion;
  try {
    kicadCliVersion = execFileSync('kicad-cli', ['version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    kicadCliVersion = null;
  }
  return kicadCliVersion;
}

/**
 * The next free run number under `<resultsDir>/<relDir>`, so a second run of
 * the same task and model on the same day appends `run-2.json` rather than
 * colliding with the append-only rule and aborting the whole matrix.
 */
export function nextRunIndex(resultsDir: string, relDir: string): number {
  const dir = path.join(resultsDir, relDir);
  if (!existsSync(dir)) return 1;
  const used = readdirSync(dir)
    .map((name) => /^run-(\d+)\.json$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number.parseInt(m[1] as string, 10));
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export function copperheadVersion(repoRoot: string): string {
  try {
    const p = path.join(repoRoot, 'node_modules', 'copperhead', 'package.json');
    return (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

export function stamp(repoRoot: string, input: RecordInput): ComparabilityStamp {
  return {
    schemaVersion: SCHEMA_VERSION,
    suiteVersion: SUITE_VERSION,
    taskManifestHash: input.taskManifestHash,
    fixtureSha256: input.fixtureSha256,
    copperheadVersion: copperheadVersion(repoRoot),
    copperheadCommit: null,
    kicadCliVersion: detectKicadCliVersion(),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
  };
}

export function buildRecord(repoRoot: string, input: RecordInput): Record<string, unknown> {
  return {
    schemaVersion: SCHEMA_VERSION,
    suiteVersion: SUITE_VERSION,
    task: {
      id: input.taskId,
      tier: input.tier,
      mode: input.mode,
      expectedOutcome: input.expectedOutcome,
    },
    fixture: { id: input.fixtureId, sha256: input.fixtureSha256 },
    run: {
      model: input.model,
      repeat: input.repeat,
      runMode: input.runMode,
      llmCache: input.llmCache,
      baselineSha: input.baselineSha,
      durationMs: input.durationMs,
      setupSkipped: input.setupSkipped,
    },
    verdict: input.score.verdict,
    partialCredit: Number(input.score.partialCredit.toFixed(4)),
    failureCategory: input.score.failureCategory ?? null,
    firstFailedRequired: input.score.firstFailedRequired ?? null,
    assertions: input.score.outcomes,
    comparability: stamp(repoRoot, input),
  };
}

export class SecretInRecordError extends Error {}
export class RecordSchemaError extends Error {}

const SCHEMA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'result.schema.json');

let validator: ((r: unknown) => boolean) & { errors?: Array<{ instancePath: string; message?: string }> | null };

/** schema/result.schema.json, compiled once. It is the record's contract (STANDARD.md section 13). */
function validateRecord(record: unknown): string[] {
  validator ??= new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) as object);
  if (validator(record)) return [];
  return (validator.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
}

/**
 * Write a record. Scans the serialized record first; a match hard-fails the run
 * rather than being silently scrubbed. Then validates against the schema, so a
 * record on disk and schema/result.schema.json cannot disagree.
 */
export function writeRecord(resultsDir: string, record: Record<string, unknown>, relPath: string): string {
  const body = `${JSON.stringify(record, null, 2)}\n`;

  const hits = scanForSecrets(body, relPath);
  if (hits.length > 0) {
    throw new SecretInRecordError(
      `refusing to write ${relPath}: matched credential pattern(s) ${hits.map((h) => h.kind).join(', ')}`,
    );
  }

  const problems = validateRecord(record);
  if (problems.length > 0) {
    throw new RecordSchemaError(`refusing to write ${relPath}: record does not satisfy schema/result.schema.json: ${problems.join('; ')}`);
  }

  const abs = path.join(resultsDir, relPath);
  // Append-only: a record is never edited after write.
  if (existsSync(abs)) throw new Error(`record already exists and records are append-only: ${relPath}`);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}
