// Sandbox materialization (tasks.md 3.1, STANDARD.md section 3.1).
//
// One sandbox per (task, model, repeat), in a temp directory OUTSIDE any
// repository, so a run can never touch the copperhead or copperbench working
// tree. Repeats never share a sandbox: a repeat that inherited a previous
// attempt's partial work would measure something other than the task.

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { git, gitCapture } from './git.ts';

export interface SandboxOptions {
  /** Absolute path to the fixture's `tree/` directory. */
  treeDir: string;
  /** Task `config` block, written to .copperhead/config.json. */
  config?: Record<string, unknown> | undefined;
  /** Task `setup.commands`, run before the baseline commit. */
  setupCommands?: string[] | undefined;
  /** Runs setup commands. Returns false when the tool is unavailable. */
  runSetup?: ((sandboxDir: string, command: string) => boolean) | undefined;
}

export interface Sandbox {
  dir: string;
  /** SHA of the baseline commit every diff assertion measures against. */
  baselineSha: string;
  /** Setup commands that could not be run, with the reason. */
  setupSkipped: Array<{ command: string; reason: string }>;
  cleanup(): void;
}

/**
 * Copy the pinned fixture tree into a fresh sandbox, initialize git, apply the
 * task's config with the response cache forced off, run any setup commands, and
 * commit the baseline.
 */
export function materialize(opts: SandboxOptions): Sandbox {
  const dir = mkdtempSync(path.join(tmpdir(), 'copperbench-run-'));

  // Only tree/ is ever copied: provenance, license, and baseline reports live
  // outside it so the agent under test cannot read our bookkeeping.
  cpSync(opts.treeDir, dir, { recursive: true });

  git(dir, ['init', '-q']);
  // Identity is set locally so the runner works on a machine with no git config.
  git(dir, ['config', 'user.email', 'benchmark@copperbench.invalid']);
  git(dir, ['config', 'user.name', 'copperbench']);

  // llmCache is forced off and is not settable by a task: a cached turn would
  // manufacture determinism the model does not have.
  const config = { ...(opts.config ?? {}), llmCache: false };
  mkdirSync(path.join(dir, '.copperhead'), { recursive: true });
  writeFileSync(
    path.join(dir, '.copperhead', 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  // A task's declared budgets ARE the recorded constraints the agent must
  // respect, so they are established at baseline. That is what makes
  // `constraint_registered` a meaningful check: it grades whether the run
  // silently relaxed or deleted the budget that blocked it, which is the most
  // dangerous available shortcut and would otherwise look like a clean refusal.
  const budgets = (opts.config?.['budgets'] ?? {}) as Record<string, unknown>;
  if (Object.keys(budgets).length > 0) {
    writeFileSync(
      path.join(dir, '.copperhead', 'constraints.json'),
      `${JSON.stringify(budgets, null, 2)}\n`,
    );
  }

  const setupSkipped: Array<{ command: string; reason: string }> = [];
  for (const command of opts.setupCommands ?? []) {
    // Setup runs BEFORE the baseline commit, so its output is part of the
    // starting state rather than the graded diff.
    const ok = opts.runSetup?.(dir, command) ?? false;
    if (!ok) setupSkipped.push({ command, reason: 'setup command unavailable in this environment' });
  }

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'baseline', '--allow-empty']);
  const baselineSha = gitCapture(dir, ['rev-parse', 'HEAD']).trim();

  return {
    dir,
    baselineSha,
    setupSkipped,
    cleanup() {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
