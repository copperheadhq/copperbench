// The leaderboard aggregation is the one computation every generated surface
// reads, so its rules are pinned here on synthetic records: the two headline
// numbers, the exclusion of unscoreable runs, the segregation of records whose
// stamps disagree and the separation of harness runs from model rows.

import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aggregate,
  buildLeaderboard,
  harnessTable,
  segregate,
  suiteReference,
  type LoadedRecord,
  type ResultRecord,
  type Tier,
} from '../scripts/lib/leaderboard.ts';
import { SCHEMA_VERSION, SUITE_VERSION } from '../scripts/lib/record.ts';
import { collectFacts, findRepoRoot } from '../scripts/lib/site-facts.ts';
import { REPO } from './helpers.ts';

const ref = suiteReference(REPO);
const task = [...ref.tasks.entries()][0] as [string, { tier: Tier; manifestHash: string; fixtureSha256: string }];

interface Overrides {
  model?: string;
  runMode?: string;
  verdict?: ResultRecord['verdict'];
  repeat?: number;
  usd?: number | null;
  segment?: NonNullable<ResultRecord['model']>['segment'];
  suiteVersion?: string;
  manifestHash?: string;
  kicad?: string | null;
  date?: string;
}

let n = 0;
function rec(o: Overrides = {}): LoadedRecord {
  n += 1;
  const [taskId, t] = task;
  const model = o.model ?? 'model-a';
  const record: ResultRecord = {
    schemaVersion: SCHEMA_VERSION,
    suiteVersion: o.suiteVersion ?? SUITE_VERSION,
    task: { id: taskId, tier: t.tier, mode: 'do', expectedOutcome: 'edit' },
    fixture: { id: 'fx', sha256: t.fixtureSha256 },
    run: { model, repeat: o.repeat ?? 1, runMode: o.runMode ?? 'agent', llmCache: false, baselineSha: 'x', durationMs: 1 },
    verdict: o.verdict ?? 'pass',
    partialCredit: 1,
    failureCategory: null,
    firstFailedRequired: null,
    comparability: {
      schemaVersion: SCHEMA_VERSION,
      suiteVersion: o.suiteVersion ?? SUITE_VERSION,
      taskManifestHash: o.manifestHash ?? t.manifestHash,
      fixtureSha256: t.fixtureSha256,
      copperheadVersion: '0.8.1',
      copperheadCommit: null,
      kicadCliVersion: o.kicad === undefined ? '9.0.2' : o.kicad,
      nodeVersion: 'v24',
      platform: 'linux-x64',
    },
  };
  if (o.usd !== undefined) record.cost = { usd: o.usd, priceTableVersion: '1' };
  if (o.segment !== undefined) record.model = { id: model, segment: o.segment, pinning: 'strong' };
  const date = o.date ?? '2026-09-06';
  return { record, relPath: `${date}/${model}/${taskId}/run-${n}.json`, date };
}

describe('aggregate', () => {
  it('computes strict pass rate over scoreable runs and cost per pass over passes', () => {
    const rows = aggregate([
      rec({ verdict: 'pass', usd: 1 }),
      rec({ verdict: 'fail', usd: 3 }),
      rec({ verdict: 'pass', usd: 2 }),
    ])[task[1].tier];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.runs).toBe(3);
    expect(row.strictPassRate).toBeCloseTo(2 / 3);
    // Total USD across all runs, including the failed one, divided by passes.
    expect(row.costPerPass).toBeCloseTo(6 / 2);
  });

  it('excludes unscoreable runs from the rate and counts them separately', () => {
    const row = aggregate([rec({ verdict: 'pass' }), rec({ verdict: 'unscoreable' })])[task[1].tier][0]!;
    expect(row.strictPassRate).toBe(1);
    expect(row.unscoreable).toBe(1);
    expect(row.runs).toBe(2);
  });

  it('reports null rather than zero cost when any run is uncosted', () => {
    const row = aggregate([rec({ usd: 1 }), rec({ usd: null })])[task[1].tier][0]!;
    expect(row.costUsd).toBeNull();
    expect(row.costPerPass).toBeNull();
  });

  it('never places a harness run in a model row', () => {
    const tiers = aggregate([rec({ runMode: 'gold', model: 'harness:gold' }), rec({ runMode: 'noop', model: 'harness:noop' })]);
    expect(Object.values(tiers).flat()).toHaveLength(0);
  });

  it('orders by pass rate, then cheapest pass, with unknowns last', () => {
    const rows = aggregate([
      rec({ model: 'cheap', verdict: 'pass', usd: 1 }),
      rec({ model: 'dear', verdict: 'pass', usd: 5 }),
      rec({ model: 'loser', verdict: 'fail' }),
      rec({ model: 'blocked', verdict: 'unscoreable' }),
    ])[task[1].tier];
    expect(rows.map((r) => r.model)).toEqual(['cheap', 'dear', 'loser', 'blocked']);
  });
});

describe('segregate', () => {
  it('keeps records whose stamps match the checked-out suite', () => {
    const { comparable, incomparable } = segregate([rec()], ref);
    expect(comparable).toHaveLength(1);
    expect(incomparable).toHaveLength(0);
  });

  it('segregates a suite-version mismatch with its reason', () => {
    const { comparable, incomparable } = segregate([rec({ suiteVersion: '0.0.1' })], ref);
    expect(comparable).toHaveLength(0);
    expect(incomparable[0]?.reasons.join()).toMatch(/suiteVersion/);
  });

  it('segregates a task manifest edit', () => {
    const { incomparable } = segregate([rec({ manifestHash: 'f'.repeat(64) })], ref);
    expect(incomparable[0]?.reasons.join()).toMatch(/manifest hash/);
  });

  it('segregates the older kicad-cli major, not the newer', () => {
    const { comparable, incomparable, kicadMajor } = segregate(
      [rec({ kicad: '8.0.9', date: '2026-01-01' }), rec({ kicad: '9.0.2', date: '2026-09-06' })],
      ref,
    );
    expect(kicadMajor).toBe('9');
    expect(comparable).toHaveLength(1);
    expect(incomparable[0]?.reasons.join()).toMatch(/kicad-cli major version 8/);
  });

  it('treats a missing kicad-cli as one value rather than a wildcard', () => {
    const { comparable } = segregate([rec({ kicad: null }), rec({ kicad: null })], ref);
    expect(comparable).toHaveLength(2);
  });
});

describe('harnessTable', () => {
  it('keeps the latest record per task and mode', () => {
    const rows = harnessTable([
      rec({ runMode: 'noop', model: 'harness:noop', verdict: 'fail', date: '2026-01-01' }),
      rec({ runMode: 'noop', model: 'harness:noop', verdict: 'unscoreable', date: '2026-09-06' }),
      rec({ runMode: 'gold', model: 'harness:gold', verdict: 'pass' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.modes['noop']?.verdict).toBe('unscoreable');
    expect(rows[0]?.modes['gold']?.verdict).toBe('pass');
  });
});

describe('the checked-in records', () => {
  it('are all comparable with the suite as checked out', () => {
    const lb = buildLeaderboard(REPO, path.join(REPO, 'results'));
    expect(lb.snapshot.records).toBeGreaterThan(0);
    expect(lb.incomparable).toEqual([]);
  });

  it('show a no-op and a reference run for every task', () => {
    const lb = buildLeaderboard(REPO, path.join(REPO, 'results'));
    expect(lb.harness.map((r) => r.taskId).sort()).toEqual([...ref.tasks.keys()].sort());
    for (const row of lb.harness) {
      expect(row.modes['noop']).toBeDefined();
      expect(row.modes['gold']).toBeDefined();
      // The negative half of the invariant: a no-op never passes.
      expect(row.modes['noop']?.verdict).not.toBe('pass');
    }
  });
});

describe('collectFacts', () => {
  it('finds the repository root from any directory inside it', () => {
    expect(findRepoRoot(path.join(REPO, 'site', 'src', 'lib'))).toBe(REPO);
    expect(() => findRepoRoot(tmpdir())).toThrow(/not found/);
  });

  it('reads every quantity the page shows from the repository', () => {
    const facts = collectFacts(REPO);
    expect(facts.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(facts.repoUrl).toMatch(/^https:\/\/github\.com\//);
    expect(facts.tasks.map((t) => t.id)).toEqual([...ref.tasks.keys()].sort());
    expect(facts.fixtures.length).toBeGreaterThan(0);
    for (const f of facts.fixtures) expect(f.license).toBe('Apache-2.0');
    expect(facts.leaderboard.suiteVersion).toBe(SUITE_VERSION);
  });

  it('keeps the editorial status free of numerals', () => {
    // A quantity belongs in a generated cell, not in prose that goes stale.
    for (const e of collectFacts(REPO).status) expect(`${e.title} ${e.text}`).not.toMatch(/\d/);
  });
});
