// Leaderboard aggregation (STANDARD.md sections 7, 9, 10, 13; tasks.md 5.2, 5.4).
//
// One reader for results/, shared by every generated surface: the site today,
// LEADERBOARD.md and the paper tables when they land. A number that appears on
// two surfaces must come from one computation or the two will drift.
//
// Three rules from the standard are mechanical here rather than remembered:
//
//   1. Two headline numbers per tier and per model: strict pass rate and cost
//      per passing task. Nothing else is computed as a headline.
//   2. Records join a shared row only when schemaVersion, suiteVersion, task
//      manifest hash, fixture hash and kicad-cli major version all agree with
//      the suite as checked out. Anything else is listed, with its reason, and
//      never averaged in.
//   3. `unscoreable` runs are neither passes nor failures. They are excluded
//      from the pass-rate denominator and counted separately.
//
// Harness runs (--mode noop, --mode gold) are the suite's own discrimination
// check, not a model result. They never appear in a model row.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

import { SCHEMA_VERSION, SUITE_VERSION, taskManifestHash } from './record.ts';
import type { Verdict } from './score.ts';

export type Tier = 'simple' | 'medium' | 'hard';
export const TIERS: readonly Tier[] = ['simple', 'medium', 'hard'];

/** Provider segments from STANDARD.md section 10. */
export type Segment =
  | 'api-frontier'
  | 'api-cheap'
  | 'open-weight-hosted'
  | 'open-weight-self-hosted'
  | 'saved-login';

/**
 * The record shape `buildRecord` writes, plus the cost and model-identity
 * fields `schema/result.schema.json` reserves for provider runs. The runner
 * writes neither until `--mode agent` lands, so both are optional here and the
 * aggregation reports `null` cost rather than inventing a zero.
 */
export interface ResultRecord {
  schemaVersion: string;
  suiteVersion: string;
  task: { id: string; tier: Tier; mode: string; expectedOutcome: string; variantOf?: string | null };
  fixture: { id: string; sha256: string };
  run: {
    model: string;
    repeat: number;
    runMode: string;
    llmCache: false;
    baselineSha: string;
    durationMs: number;
  };
  model?: { id?: string; provider?: string; segment?: Segment; pinning?: 'strong' | 'weak' };
  cost?: { usd: number | null; priceTableVersion: string | null };
  verdict: Verdict;
  partialCredit: number;
  failureCategory: string | null;
  firstFailedRequired: string | null;
  comparability: {
    schemaVersion: string;
    suiteVersion: string;
    taskManifestHash: string;
    fixtureSha256: string;
    copperheadVersion: string;
    copperheadCommit: string | null;
    kicadCliVersion: string | null;
    nodeVersion: string;
    platform: string;
  };
}

export interface LoadedRecord {
  record: ResultRecord;
  /** Path relative to the results directory, `<date>/<model>/<task-id>/run-<n>.json`. */
  relPath: string;
  /** The `<date>` path segment. Records carry no timestamp of their own. */
  date: string;
}

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(path.relative(base, full));
  }
  return out;
}

/** Every record under results/, in path order so output is deterministic. */
export function loadRecords(resultsDir: string): LoadedRecord[] {
  if (!existsSync(resultsDir)) return [];
  return walk(resultsDir, resultsDir)
    .sort()
    .map((relPath) => {
      const record = JSON.parse(readFileSync(path.join(resultsDir, relPath), 'utf8')) as ResultRecord;
      const date = relPath.split(path.sep)[0] ?? '';
      return { record, relPath: relPath.split(path.sep).join('/'), date };
    });
}

export interface SuiteReference {
  schemaVersion: string;
  suiteVersion: string;
  /** Per task as checked out: the stamps a record must match to be comparable. */
  tasks: Map<string, { tier: Tier; manifestHash: string; fixtureSha256: string }>;
}

/** The comparability stamps of the suite as checked out, computed rather than recorded. */
export function suiteReference(repoRoot: string): SuiteReference {
  const tasksDir = path.join(repoRoot, 'tasks');
  const tasks = new Map<string, { tier: Tier; manifestHash: string; fixtureSha256: string }>();
  if (existsSync(tasksDir)) {
    for (const entry of readdirSync(tasksDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(tasksDir, entry.name);
      const manifest = JSON.parse(readFileSync(path.join(dir, 'task.json'), 'utf8')) as {
        tier: Tier;
        fixture: { sha256: string };
      };
      tasks.set(entry.name, {
        tier: manifest.tier,
        manifestHash: taskManifestHash(dir),
        fixtureSha256: manifest.fixture.sha256,
      });
    }
  }
  return { schemaVersion: SCHEMA_VERSION, suiteVersion: SUITE_VERSION, tasks };
}

export interface Incomparable {
  rec: LoadedRecord;
  reasons: string[];
}

function kicadMajor(version: string | null): string {
  if (version === null) return 'none';
  const m = /^(\d+)/.exec(version.trim());
  return m?.[1] ?? version;
}

/**
 * Split records into those that may share a table and those that may not.
 *
 * The kicad-cli reference is the major version of the most recent record whose
 * other four stamps already agree, so a suite that has only ever run under one
 * KiCad never segregates on it. A KiCad upgrade segregates the old records
 * rather than the new ones.
 */
export function segregate(
  records: LoadedRecord[],
  ref: SuiteReference,
): { comparable: LoadedRecord[]; incomparable: Incomparable[]; kicadMajor: string | null } {
  const stampMatched: LoadedRecord[] = [];
  const incomparable: Incomparable[] = [];

  for (const rec of records) {
    const c = rec.record.comparability;
    const reasons: string[] = [];
    if (c.schemaVersion !== ref.schemaVersion) reasons.push(`schemaVersion ${c.schemaVersion} ≠ ${ref.schemaVersion}`);
    if (c.suiteVersion !== ref.suiteVersion) reasons.push(`suiteVersion ${c.suiteVersion} ≠ ${ref.suiteVersion}`);
    const task = ref.tasks.get(rec.record.task.id);
    if (task === undefined) reasons.push(`task ${rec.record.task.id} is not in the suite`);
    else {
      if (c.taskManifestHash !== task.manifestHash) reasons.push('task manifest hash differs from the checked-out task');
      if (c.fixtureSha256 !== task.fixtureSha256) reasons.push('fixture hash differs from the checked-out fixture');
    }
    if (reasons.length > 0) incomparable.push({ rec, reasons });
    else stampMatched.push(rec);
  }

  // Most recent by date, then path, so the reference is deterministic.
  const newest = [...stampMatched].sort((a, b) => b.date.localeCompare(a.date) || b.relPath.localeCompare(a.relPath))[0];
  const major = newest === undefined ? null : kicadMajor(newest.record.comparability.kicadCliVersion);

  const comparable: LoadedRecord[] = [];
  for (const rec of stampMatched) {
    const m = kicadMajor(rec.record.comparability.kicadCliVersion);
    if (major !== null && m !== major) {
      incomparable.push({ rec, reasons: [`kicad-cli major version ${m} ≠ ${major}`] });
    } else comparable.push(rec);
  }

  return { comparable, incomparable, kicadMajor: major };
}

export function isHarness(rec: LoadedRecord): boolean {
  return rec.record.run.runMode !== 'agent';
}

export interface Row {
  model: string;
  segment: Segment | null;
  pinning: 'strong' | 'weak' | null;
  /** All runs, including unscoreable ones. */
  runs: number;
  passes: number;
  fails: number;
  unscoreable: number;
  /** passes / (passes + fails); null when nothing was scoreable. */
  strictPassRate: number | null;
  /** Sum of recorded USD; null when any run in the row carries no cost. */
  costUsd: number | null;
  /** costUsd / passes; null when cost is null or nothing passed. */
  costPerPass: number | null;
  /** Highest repeat index seen, i.e. repeats per task. */
  repeats: number;
  tasks: string[];
  copperheadVersions: string[];
  latestDate: string;
  records: number;
}

function segmentOf(rec: LoadedRecord): Segment | null {
  return rec.record.model?.segment ?? null;
}

function costOf(rec: LoadedRecord): number | null {
  const usd = rec.record.cost?.usd;
  return typeof usd === 'number' ? usd : null;
}

/** The two headline numbers per tier and per model, over agent records only. */
export function aggregate(records: LoadedRecord[]): Record<Tier, Row[]> {
  const out: Record<Tier, Row[]> = { simple: [], medium: [], hard: [] };

  for (const tier of TIERS) {
    const byModel = new Map<string, LoadedRecord[]>();
    for (const rec of records) {
      if (isHarness(rec) || rec.record.task.tier !== tier) continue;
      const key = rec.record.model?.id ?? rec.record.run.model;
      byModel.set(key, [...(byModel.get(key) ?? []), rec]);
    }

    for (const [model, recs] of byModel) {
      const passes = recs.filter((r) => r.record.verdict === 'pass').length;
      const fails = recs.filter((r) => r.record.verdict === 'fail').length;
      const unscoreable = recs.filter((r) => r.record.verdict === 'unscoreable').length;
      const scoreable = passes + fails;

      const costs = recs.map(costOf);
      const costUsd = costs.every((c): c is number => c !== null) ? costs.reduce((a, c) => a + c, 0) : null;

      const first = recs[0];
      out[tier].push({
        model,
        segment: segmentOf(first as LoadedRecord),
        pinning: first?.record.model?.pinning ?? null,
        runs: recs.length,
        passes,
        fails,
        unscoreable,
        strictPassRate: scoreable === 0 ? null : passes / scoreable,
        costUsd,
        costPerPass: costUsd === null || passes === 0 ? null : costUsd / passes,
        repeats: Math.max(...recs.map((r) => r.record.run.repeat)),
        tasks: [...new Set(recs.map((r) => r.record.task.id))].sort(),
        copperheadVersions: [...new Set(recs.map((r) => r.record.comparability.copperheadVersion))].sort(),
        latestDate: recs.map((r) => r.date).sort().at(-1) ?? '',
        records: recs.length,
      });
    }

    // Best pass rate first; among equals, cheapest pass first; unknowns last.
    out[tier].sort(
      (a, b) =>
        (b.strictPassRate ?? -1) - (a.strictPassRate ?? -1) ||
        (a.costPerPass ?? Infinity) - (b.costPerPass ?? Infinity) ||
        a.model.localeCompare(b.model),
    );
  }

  return out;
}

export interface HarnessCell {
  verdict: Verdict;
  partialCredit: number;
  firstFailedRequired: string | null;
  date: string;
  relPath: string;
}

export interface HarnessRow {
  taskId: string;
  tier: Tier;
  expectedOutcome: string;
  /** Keyed by run mode: `noop`, `gold`. Latest record per mode. */
  modes: Record<string, HarnessCell>;
}

/**
 * The discrimination check: per task, what the no-op and the reference solution
 * scored. A task whose no-op passes grades nothing; one whose gold fails is not
 * gradable. Both halves are shown, because each alone proves half the claim.
 */
export function harnessTable(records: LoadedRecord[]): HarnessRow[] {
  const byTask = new Map<string, HarnessRow>();
  for (const rec of records) {
    if (!isHarness(rec)) continue;
    const r = rec.record;
    const row = byTask.get(r.task.id) ?? { taskId: r.task.id, tier: r.task.tier, expectedOutcome: r.task.expectedOutcome, modes: {} };
    const existing = row.modes[r.run.runMode];
    if (existing === undefined || existing.date < rec.date || (existing.date === rec.date && existing.relPath < rec.relPath)) {
      row.modes[r.run.runMode] = {
        verdict: r.verdict,
        partialCredit: r.partialCredit,
        firstFailedRequired: r.firstFailedRequired,
        date: rec.date,
        relPath: rec.relPath,
      };
    }
    byTask.set(r.task.id, row);
  }
  return [...byTask.values()].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.taskId.localeCompare(b.taskId));
}

export interface Leaderboard {
  schemaVersion: string;
  suiteVersion: string;
  /** kicad-cli major version the shared table is built on; null with no comparable record. */
  kicadMajor: string | null;
  snapshot: {
    records: number;
    agentRecords: number;
    harnessRecords: number;
    incomparable: number;
    dates: string[];
  };
  tiers: Record<Tier, Row[]>;
  incomparable: Array<{ relPath: string; model: string; task: string; reasons: string[] }>;
  harness: HarnessRow[];
}

/** Everything a generated surface needs, computed once from results/. */
export function buildLeaderboard(repoRoot: string, resultsDir: string): Leaderboard {
  const records = loadRecords(resultsDir);
  const ref = suiteReference(repoRoot);
  const { comparable, incomparable, kicadMajor: major } = segregate(records, ref);

  return {
    schemaVersion: ref.schemaVersion,
    suiteVersion: ref.suiteVersion,
    kicadMajor: major,
    snapshot: {
      records: records.length,
      agentRecords: records.filter((r) => !isHarness(r)).length,
      harnessRecords: records.filter(isHarness).length,
      incomparable: incomparable.length,
      dates: [...new Set(records.map((r) => r.date))].sort(),
    },
    tiers: aggregate(comparable),
    incomparable: incomparable
      .map(({ rec, reasons }) => ({ relPath: rec.relPath, model: rec.record.run.model, task: rec.record.task.id, reasons }))
      .sort((a, b) => a.relPath.localeCompare(b.relPath)),
    harness: harnessTable(comparable),
  };
}
