#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTaskIds, buildRunPlan, type RunPlanEntry } from '../src/runner/plan.js';
import { classifyModel } from '../src/runner/cost.js';
import { resolveCopperheadInstall } from '../src/runner/copperhead-install.js';
import { materializeSandbox } from '../src/runner/sandbox.js';
import { executeRun } from '../src/runner/run.js';
import { scoreRun } from '../src/scorer/score.js';
import { rescoreAll } from '../src/scorer/rescore.js';
import { buildResultRecord } from '../src/records/build.js';
import { writeResultRecord } from '../src/records/write.js';
import { findExistingRecord } from '../src/records/resume.js';
import type { AssertionManifest, FixtureManifest } from '../src/types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultsRoot = path.join(repoRoot, 'results');

// This pass targets one hardcoded/CLI-supplied model, not a matrix
// (migration step 4 is out of scope) — see openspec design.md.
const DEFAULT_MODEL = 'compat:qwen2.5-coder:7b';
const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

interface CliArgs {
  taskIds: string[] | undefined;
  repeats: number | undefined;
  model: string;
  baseURL: string;
  dryRun: boolean;
  rescore: string | undefined;
  force: boolean;
}

/** Rejects anything that isn't a positive integer (NaN, 0, negative, "3.5",
 * "abc") rather than letting a malformed --repeats value silently produce a
 * zero- or negative-length plan. */
function parseRepeats(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== raw.trim()) {
    throw new Error(`--repeats must be a positive integer, got "${raw}"`);
  }
  return n;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      task: { type: 'string', multiple: true },
      repeats: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      rescore: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });
  return {
    taskIds: values.task,
    repeats: values.repeats !== undefined ? parseRepeats(values.repeats) : undefined,
    model: values.model ?? DEFAULT_MODEL,
    baseURL: values['base-url'] ?? DEFAULT_BASE_URL,
    dryRun: values['dry-run'] ?? false,
    rescore: values.rescore,
    force: values.force ?? false,
  };
}

function planKey(entry: RunPlanEntry): string {
  return `${entry.taskId}#${entry.repeatIndex}`;
}

/** tasks.md 3.5: resolves which plan entries already have a written record,
 * once up front — reused for both the printed plan and the execution loop,
 * so an interrupted expensive suite is visibly resumable before it runs,
 * not just discovered mid-execution. */
async function resolveSkips(
  plan: RunPlanEntry[],
  resultsRoot: string,
  model: string,
  force: boolean,
): Promise<Map<string, string>> {
  const skips = new Map<string, string>();
  if (force) return skips;
  for (const entry of plan) {
    const existing = await findExistingRecord(resultsRoot, model, entry.taskId, entry.repeatIndex);
    if (existing) skips.set(planKey(entry), existing);
  }
  return skips;
}

function printPlan(plan: RunPlanEntry[], model: string, baseURL: string, skips: Map<string, string>): void {
  const profile = classifyModel(model, baseURL);
  const byTask = new Map<string, number>();
  for (const entry of plan) byTask.set(entry.taskId, (byTask.get(entry.taskId) ?? 0) + 1);

  console.log('copperbench run plan');
  console.log(`  model:    ${model}`);
  console.log(`  endpoint: ${baseURL}`);
  console.log(`  segment:  ${profile.segment}`);
  console.log(`  cost:     null — ${profile.note}`);
  console.log('');
  for (const [taskId, count] of byTask) {
    console.log(`  ${taskId}: ${count} repeat(s)`);
  }

  const toRun = plan.filter((e) => !skips.has(planKey(e)));
  const totalTurnCapBudget = toRun.reduce((sum, e) => sum + e.task.caps.turns, 0);
  const totalWallClockBudgetSec = toRun.reduce((sum, e) => sum + e.task.caps.wallClockSec, 0);
  console.log('');
  console.log(`  total runs planned: ${plan.length}`);
  if (skips.size > 0) {
    console.log(`  already have a record (skipped unless --force): ${skips.size}`);
  }
  console.log(`  runs that will actually execute: ${toRun.length}`);
  console.log(`  worst-case turn budget (sum of caps.turns, runs that will execute): ${totalTurnCapBudget}`);
  console.log(
    `  worst-case wall-clock budget (sum of caps.wallClockSec, runs that will execute): ${totalWallClockBudgetSec}s ` +
      `(${(totalWallClockBudgetSec / 60).toFixed(1)} min)`,
  );
}

async function runRescore(rescorePath: string): Promise<void> {
  console.log(`copperbench --rescore ${rescorePath}`);
  console.log('(no provider credential or network reachable from this path — evidence is files on disk)\n');
  const { outcomes, failures } = await rescoreAll(repoRoot, rescorePath);
  if (!outcomes.length && !failures.length) {
    console.log('no run-*.json result records found under that path.');
    return;
  }
  let mismatches = 0;
  for (const o of outcomes) {
    const status = o.matches ? 'MATCH' : 'MISMATCH';
    if (!o.matches) mismatches++;
    console.log(
      `[${status}] ${o.resultPath} (${o.taskId}): ` +
        `stored pass=${o.originalVerdict.pass} credit=${o.originalVerdict.partialCredit.toFixed(3)} | ` +
        `recomputed pass=${o.recomputed.verdict.pass} credit=${o.recomputed.verdict.partialCredit.toFixed(3)}` +
        (o.recomputed.failure ? ` | failure=${o.recomputed.failure.category}` : ''),
    );
  }
  for (const f of failures) {
    console.log(`[UNRESCOREABLE] ${f.resultPath}: ${f.error}`);
  }
  console.log(
    `\n${outcomes.length - mismatches}/${outcomes.length} records reproduced identically` +
      (failures.length ? `, ${failures.length} unrescoreable` : '') +
      '.',
  );
  if (mismatches > 0 || failures.length > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.rescore) {
    await runRescore(args.rescore);
    return;
  }

  const taskIds = args.taskIds ?? (await discoverTaskIds(repoRoot));
  const plan = await buildRunPlan(repoRoot, taskIds, args.repeats);
  const skips = await resolveSkips(plan, resultsRoot, args.model, args.force);

  printPlan(plan, args.model, args.baseURL, skips);

  if (args.dryRun) {
    console.log('\n--dry-run: executing nothing.');
    return;
  }

  console.log('\nExecuting plan: sandbox + run + score + write result record.\n');

  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as { suiteVersion: unknown };
  if (typeof pkg.suiteVersion !== 'string' || pkg.suiteVersion.length === 0) {
    throw new Error(
      `package.json's "suiteVersion" must be a non-empty string, got ${JSON.stringify(pkg.suiteVersion)} — ` +
        'every result record is stamped with it (STANDARD.md section 9), so an absent/renamed field would ' +
        'silently write invalid records only after the run already finished.',
    );
  }
  const suiteVersion = pkg.suiteVersion;
  const copperhead = await resolveCopperheadInstall();
  let failures = 0;
  for (const entry of plan) {
    const label = `[${entry.taskId} repeat ${entry.repeatIndex}/${entry.repeatsPlanned}]`;

    const existing = skips.get(planKey(entry));
    if (existing) {
      console.log(`${label} skipped: record already exists at ${path.relative(repoRoot, existing)} (--force to redo)`);
      continue;
    }

    try {
      console.log(`${label} materializing sandbox...`);
      const sandbox = await materializeSandbox(entry.task, { repoRoot });
      console.log(`${label} sandbox: ${sandbox.path}`);
      console.log(`${label} running...`);
      const run = await executeRun({
        sandbox,
        task: entry.task,
        model: args.model,
        copperhead,
        compat: { baseURL: args.baseURL },
      });
      console.log(
        `${label} run done: exitCode=${run.processExitCode} signal=${run.processSignal} ` +
          `killedForWallClock=${run.killedForWallClock} durationMs=${run.durationMs} ` +
          `transcript=${run.transcriptDir ?? '(none)'}`,
      );

      const assertions = JSON.parse(
        await readFile(path.join(repoRoot, 'tasks', entry.taskId, 'assertions.json'), 'utf8'),
      ) as AssertionManifest[];
      const fixture = JSON.parse(
        await readFile(path.join(repoRoot, entry.task.fixture.path, 'fixture.json'), 'utf8'),
      ) as FixtureManifest;

      const score = await scoreRun({
        task: entry.task,
        assertions,
        fixture,
        sandboxPath: sandbox.path,
        baselineCommit: sandbox.baselineCommit,
        transcriptDir: run.transcriptDir,
        killedForWallClock: run.killedForWallClock,
      });
      console.log(
        `${label} verdict: pass=${score.verdict.pass} partialCredit=${score.verdict.partialCredit.toFixed(3)}` +
          (score.failure ? ` failure=${score.failure.category}` : ''),
      );
      for (const a of score.assertions) {
        if (!a.passed) console.log(`${label}   [FAIL] ${a.id} (${a.type}) — ${a.detail ?? ''}`);
      }

      const record = await buildResultRecord({
        repoRoot,
        suiteVersion,
        entry,
        model: args.model,
        baseURL: args.baseURL,
        copperhead,
        sandbox,
        run,
        score,
      });
      const recordPath = await writeResultRecord(resultsRoot, record);
      console.log(`${label} wrote ${path.relative(repoRoot, recordPath)}`);
    } catch (err) {
      failures++;
      console.error(`${label} FAILED: ${(err as Error).stack ?? (err as Error).message}`);
      console.error(`${label} continuing with the remaining plan entries.`);
    }
  }
  if (failures > 0) {
    console.error(`\n${failures}/${plan.length} plan entries failed before writing a result record.`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
