#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTaskIds, buildRunPlan, type RunPlanEntry } from '../src/runner/plan.js';
import { classifyModel } from '../src/runner/cost.js';
import { resolveCopperheadInstall } from '../src/runner/copperhead-install.js';
import { materializeSandbox } from '../src/runner/sandbox.js';
import { executeRun } from '../src/runner/run.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    },
  });
  return {
    taskIds: values.task,
    repeats: values.repeats !== undefined ? Number.parseInt(values.repeats, 10) : undefined,
    model: values.model ?? DEFAULT_MODEL,
    baseURL: values['base-url'] ?? DEFAULT_BASE_URL,
    dryRun: values['dry-run'] ?? false,
  };
}

function printPlan(plan: RunPlanEntry[], model: string, baseURL: string): void {
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

  const totalTurnCapBudget = plan.reduce((sum, e) => sum + e.task.caps.turns, 0);
  const totalWallClockBudgetSec = plan.reduce((sum, e) => sum + e.task.caps.wallClockSec, 0);
  console.log('');
  console.log(`  total runs planned: ${plan.length}`);
  console.log(`  worst-case turn budget (sum of caps.turns across all runs): ${totalTurnCapBudget}`);
  console.log(
    `  worst-case wall-clock budget (sum of caps.wallClockSec): ${totalWallClockBudgetSec}s ` +
      `(${(totalWallClockBudgetSec / 60).toFixed(1)} min)`,
  );
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const taskIds = args.taskIds ?? (await discoverTaskIds(repoRoot));
  const plan = await buildRunPlan(repoRoot, taskIds, args.repeats);

  printPlan(plan, args.model, args.baseURL);

  if (args.dryRun) {
    console.log('\n--dry-run: executing nothing.');
    return;
  }

  console.log(
    '\nExecuting plan. This orchestrates sandbox materialization + run execution only — scoring ' +
      'and result-record writing land in later steps (4.x/5.1), so no results/ file is written yet.\n',
  );

  const copperhead = await resolveCopperheadInstall();
  for (const entry of plan) {
    const label = `[${entry.taskId} repeat ${entry.repeatIndex}/${entry.repeatsPlanned}]`;
    console.log(`${label} materializing sandbox...`);
    const sandbox = await materializeSandbox(entry.task, { repoRoot });
    console.log(`${label} sandbox: ${sandbox.path}`);
    console.log(`${label} running...`);
    const result = await executeRun({
      sandbox,
      task: entry.task,
      model: args.model,
      copperhead,
      compat: { baseURL: args.baseURL },
    });
    console.log(
      `${label} done: exitCode=${result.processExitCode} signal=${result.processSignal} ` +
        `killedForWallClock=${result.killedForWallClock} durationMs=${result.durationMs} ` +
        `transcript=${result.transcriptDir ?? '(none)'}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
