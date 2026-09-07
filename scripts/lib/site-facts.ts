// Everything the website renders, read from the repository as checked out.
//
// The site is presentation only (site/, an Astro project). Every quantity on
// every page comes through here: the leaderboard and record counts from
// results/ via leaderboard.ts, the task manifests and assertion lists from
// tasks/, the fixture provenance and baselines from fixtures/*/fixture.json,
// the price table from pricing.json, versions from record.ts, the build commit
// from git. The one editorial input is site/status.json. Keeping the reader
// here, under the root tsconfig and the root tests, means a page cannot
// compute a number the rest of the repository does not.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { gitCapture } from './git.ts';
import { buildLeaderboard, loadRecords, type Leaderboard, type ResultRecord, type Segment, type Tier } from './leaderboard.ts';
import { taskManifestHash } from './record.ts';

export interface AssertionFact {
  id: string;
  type: string;
  args: Record<string, unknown>;
  weight: number;
  required: boolean;
  note: string | null;
}

export interface TaskFact {
  id: string;
  tier: Tier;
  mode: string;
  expectedOutcome: string;
  /** The fixture id, i.e. the basename of the manifest's fixture path. */
  fixture: string;
  fixtureSha256: string;
  prompt: string | null;
  briefPath: string | null;
  setup: string[];
  config: Record<string, unknown>;
  caps: Record<string, number>;
  tags: string[];
  variantOf: string | null;
  /** The comparability stamp a record must carry to count against this task. */
  manifestHash: string;
  assertions: AssertionFact[];
}

export interface FixtureFact {
  id: string;
  sha256: string;
  complexity: Tier;
  name: string;
  url: string;
  commit: string;
  retrieved: string;
  license: string;
  copyright: string;
  modifications: string;
  sheets: number;
  symbols: number;
  schematicLines: number;
  boardLines: number;
  signalNets: string[];
  powerNets: string[];
  kicad: { authoredVersion: string; fileFormatVersion: string; verifiedWithKicadCli: string };
  artifacts: Record<string, string>;
  baseline: {
    /** `errorTypes` enumerates every baseline error by type; the fixture standard requires it whenever `errors` is non-zero. */
    erc: { errors: number; errorTypes: Record<string, number>; warnings: number; warningTypes: Record<string, number> };
    drc: {
      errors: number;
      errorTypes: Record<string, number>;
      warnings: number;
      warningTypes: Record<string, number>;
      unconnectedItems: number;
      schematicParity: number;
    };
    note: string | null;
  };
}

export interface RecordFact {
  /** `<date>/<model>/<task-id>/run-<n>.json`, relative to results/. */
  relPath: string;
  date: string;
  model: string;
  task: string;
  tier: Tier;
  repeat: number;
  runMode: string;
  verdict: ResultRecord['verdict'];
  firstFailedRequired: string | null;
  /** Whether the record shares a table with the suite as checked out; the reasons when it does not. */
  comparable: boolean;
  reasons: string[];
  record: ResultRecord;
}

export interface PriceRow {
  id: string;
  segment: Segment;
  pinning: 'strong' | 'weak';
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export interface NullCostRoute {
  id: string;
  segment: Segment;
  pinning: 'strong' | 'weak';
  reason: string;
}

export interface PricingFact {
  tableVersion: string;
  effectiveDate: string;
  currency: string;
  unit: string;
  comment: string | null;
  models: PriceRow[];
  nullCostRoutes: NullCostRoute[];
}

export interface StatusEntry {
  state: 'done' | 'next' | 'pending';
  title: string;
  text: string;
  link?: string;
  label?: string;
}

export interface Facts {
  version: string;
  repoUrl: string;
  commit: string | null;
  tasks: TaskFact[];
  fixtures: FixtureFact[];
  records: RecordFact[];
  pricing: PricingFact;
  status: StatusEntry[];
  leaderboard: Leaderboard;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/**
 * The repository root, found by walking up from `start` to the directory whose
 * package.json names this project. Astro bundles the site's modules into
 * dist/.prerender before running them, so a path relative to import.meta.url
 * is wrong at exactly the moment it is needed; the working directory and the
 * package name are stable.
 */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if (readJson<{ name?: string }>(pkg).name === 'copperbench') return dir;
      } catch {
        // Not ours; keep walking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`copperbench repository root not found above ${start}`);
    dir = parent;
  }
}

/** The repository's GitHub address, from package.json, without the git+ scheme or the .git suffix. */
export function repoUrlOf(repoRoot: string): string {
  const pkg = readJson<{ repository?: { url?: string } }>(path.join(repoRoot, 'package.json'));
  return (pkg.repository?.url ?? 'https://github.com/chouhanindustries/copperbench').replace(/^git\+/, '').replace(/\.git$/, '');
}

function subdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function gitCommit(repoRoot: string): string | null {
  try {
    return gitCapture(repoRoot, ['rev-parse', '--short', 'HEAD']).trim();
  } catch {
    // Not a git checkout, or git is absent. The page says so instead of guessing.
    return null;
  }
}

interface TaskManifest {
  tier: Tier;
  mode: string;
  expectedOutcome: string;
  fixture: { path: string; sha256: string };
  request: { prompt?: string; briefPath?: string };
  setup?: { commands?: string[] };
  config?: Record<string, unknown>;
  caps?: Record<string, number>;
  tags?: string[];
  variantOf?: string | null;
}

interface AssertionManifest {
  id: string;
  type: string;
  args?: Record<string, unknown>;
  weight: number;
  required: boolean;
  note?: string;
}

function readTasks(repoRoot: string): TaskFact[] {
  return subdirs(path.join(repoRoot, 'tasks')).map((id) => {
    const dir = path.join(repoRoot, 'tasks', id);
    const m = readJson<TaskManifest>(path.join(dir, 'task.json'));
    const assertions = readJson<AssertionManifest[]>(path.join(dir, 'assertions.json'));
    return {
      id,
      tier: m.tier,
      mode: m.mode,
      expectedOutcome: m.expectedOutcome,
      fixture: path.basename(m.fixture.path),
      fixtureSha256: m.fixture.sha256,
      prompt: m.request.prompt ?? null,
      briefPath: m.request.briefPath ?? null,
      setup: m.setup?.commands ?? [],
      config: m.config ?? {},
      caps: m.caps ?? {},
      tags: m.tags ?? [],
      variantOf: m.variantOf ?? null,
      manifestHash: taskManifestHash(dir),
      assertions: assertions.map((a) => ({
        id: a.id,
        type: a.type,
        args: a.args ?? {},
        weight: a.weight,
        required: a.required,
        note: a.note ?? null,
      })),
    };
  });
}

interface FixtureManifest {
  sha256: string;
  complexity: Tier;
  upstream: { name: string; url: string; commit: string; retrieved: string; license: string; copyright: string; modifications: string };
  kicad: { authoredVersion: string; fileFormatVersion: string; verifiedWithKicadCli: string };
  artifacts: Record<string, string>;
  scale: { sheets: number; symbols: number; schematicLines: number; boardLines: number; signalNets: string[]; powerNets: string[] };
  baseline: {
    erc: { errors: number; errorTypes?: Record<string, number>; warnings: number; warningTypes?: Record<string, number> };
    drc: {
      errors: number;
      errorTypes?: Record<string, number>;
      warnings: number;
      warningTypes?: Record<string, number>;
      unconnectedItems: number;
      schematicParity: number;
    };
    note?: string;
  };
}

function readFixtures(repoRoot: string): FixtureFact[] {
  return subdirs(path.join(repoRoot, 'fixtures')).map((id) => {
    const m = readJson<FixtureManifest>(path.join(repoRoot, 'fixtures', id, 'fixture.json'));
    return {
      id,
      sha256: m.sha256,
      complexity: m.complexity,
      name: m.upstream.name,
      url: m.upstream.url,
      commit: m.upstream.commit,
      retrieved: m.upstream.retrieved,
      license: m.upstream.license,
      copyright: m.upstream.copyright,
      modifications: m.upstream.modifications,
      sheets: m.scale.sheets,
      symbols: m.scale.symbols,
      schematicLines: m.scale.schematicLines,
      boardLines: m.scale.boardLines,
      signalNets: m.scale.signalNets,
      powerNets: m.scale.powerNets,
      kicad: m.kicad,
      artifacts: m.artifacts,
      baseline: {
        erc: {
          errors: m.baseline.erc.errors,
          errorTypes: m.baseline.erc.errorTypes ?? {},
          warnings: m.baseline.erc.warnings,
          warningTypes: m.baseline.erc.warningTypes ?? {},
        },
        drc: {
          errors: m.baseline.drc.errors,
          errorTypes: m.baseline.drc.errorTypes ?? {},
          warnings: m.baseline.drc.warnings,
          warningTypes: m.baseline.drc.warningTypes ?? {},
          unconnectedItems: m.baseline.drc.unconnectedItems,
          schematicParity: m.baseline.drc.schematicParity,
        },
        note: m.baseline.note ?? null,
      },
    };
  });
}

function readRecords(resultsDir: string, leaderboard: Leaderboard): RecordFact[] {
  const reasons = new Map(leaderboard.incomparable.map((r) => [r.relPath, r.reasons]));
  return loadRecords(resultsDir).map(({ record, relPath, date }) => ({
    relPath,
    date,
    model: record.model?.id ?? record.run.model,
    task: record.task.id,
    tier: record.task.tier,
    repeat: record.run.repeat,
    runMode: record.run.runMode,
    verdict: record.verdict,
    firstFailedRequired: record.firstFailedRequired,
    comparable: !reasons.has(relPath),
    reasons: reasons.get(relPath) ?? [],
    record,
  }));
}

interface PricingFile {
  $comment?: string;
  tableVersion: string;
  effectiveDate: string;
  currency: string;
  unit: string;
  models: Record<string, string | { segment: Segment; pinning: 'strong' | 'weak'; input: number | null; output: number | null; cacheRead?: number | null; cacheWrite?: number | null }>;
  nullCostRoutes: Record<string, string | { segment: Segment; pinning: 'strong' | 'weak'; reason: string }>;
}

function readPricing(repoRoot: string): PricingFact {
  const p = readJson<PricingFile>(path.join(repoRoot, 'pricing.json'));
  const models: PriceRow[] = [];
  for (const [id, row] of Object.entries(p.models)) {
    if (typeof row === 'string') continue; // the `$comment` key
    models.push({ id, segment: row.segment, pinning: row.pinning, input: row.input, output: row.output, cacheRead: row.cacheRead ?? null, cacheWrite: row.cacheWrite ?? null });
  }
  const nullCostRoutes: NullCostRoute[] = [];
  for (const [id, row] of Object.entries(p.nullCostRoutes)) {
    if (typeof row === 'string') continue;
    nullCostRoutes.push({ id, segment: row.segment, pinning: row.pinning, reason: row.reason });
  }
  return {
    tableVersion: p.tableVersion,
    effectiveDate: p.effectiveDate,
    currency: p.currency,
    unit: p.unit,
    comment: p.$comment ?? null,
    models,
    nullCostRoutes,
  };
}

export function collectFacts(repoRoot: string, resultsDir = path.join(repoRoot, 'results')): Facts {
  const pkg = readJson<{ version: string }>(path.join(repoRoot, 'package.json'));
  const statusFile = path.join(repoRoot, 'site', 'status.json');
  const leaderboard = buildLeaderboard(repoRoot, resultsDir);

  return {
    version: pkg.version,
    repoUrl: repoUrlOf(repoRoot),
    commit: gitCommit(repoRoot),
    tasks: readTasks(repoRoot),
    fixtures: readFixtures(repoRoot),
    records: readRecords(resultsDir, leaderboard),
    pricing: readPricing(repoRoot),
    status: existsSync(statusFile) ? readJson<StatusEntry[]>(statusFile) : [],
    leaderboard,
  };
}
