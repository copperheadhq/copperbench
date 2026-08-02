import { mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../util/exec.js';
import { resolveCopperheadInstall } from './copperhead-install.js';
import type { TaskManifest } from '../types.js';

export interface Sandbox {
  path: string;
  baselineCommit: string;
}

// A sandbox is copperbench's own artifact, not a design decision the model
// under test should see or be attributed by; a fixed, repo-independent
// identity keeps a baseline commit's authorship meaningful across sandboxes
// instead of depending on whatever git config happens to be global on the
// host running the suite.
const GIT_AUTHOR_NAME = 'copperbench';
const GIT_AUTHOR_EMAIL = 'copperbench@localhost';

// The assertions schema's setup.commands enum currently admits only "init":
// the one copperhead subcommand that is contractually LLM-free and
// network-free (STANDARD.md section 3.1). Checked again here, not just in
// the schema, because a validation gap between the two would let an
// unreachable command silently no-op instead of refusing.
const ALLOWED_SETUP_COMMANDS = new Set(['init']);

/**
 * STANDARD.md section 3.1 / design D4: copy the fixture tree into a fresh
 * sandbox outside any repo, `git init` it, run the task's LLM-free setup
 * commands, write the merged `.copperhead/config.json`, and commit the
 * result as the baseline. Repeats never share a sandbox — call this once per
 * (task, model, repeat) and it returns a fresh directory every time.
 *
 * The sandbox is never deleted here. Preserving it — pass or fail — is what
 * makes `--rescore` possible (STANDARD.md section 14) and is required on
 * failure by section 3.1 step 6; lifecycle management past creation is the
 * caller's job, not this function's.
 */
export async function materializeSandbox(
  task: TaskManifest,
  opts: { repoRoot: string },
): Promise<Sandbox> {
  const fixtureTree = path.join(opts.repoRoot, task.fixture.path, 'tree');
  const sandboxDir = await mkdtemp(path.join(tmpdir(), 'copperbench-'));

  await cp(fixtureTree, sandboxDir, { recursive: true });

  await run('git', ['init', '-q'], { cwd: sandboxDir });
  await run('git', ['config', 'user.name', GIT_AUTHOR_NAME], { cwd: sandboxDir });
  await run('git', ['config', 'user.email', GIT_AUTHOR_EMAIL], { cwd: sandboxDir });

  const commands = task.setup?.commands ?? [];
  const initCount = commands.filter((c) => c === 'init').length;
  if (initCount !== 1 || commands.length !== initCount) {
    throw new Error(
      `task "${task.id}" declares setup.commands ${JSON.stringify(commands)}, but exactly one "init" is required — ` +
        'writeSandboxConfig() below depends on copperhead init having scaffolded .copperhead/config.json exactly ' +
        'once (zero would leave it missing, more than one would just repeat a no-op).',
    );
  }
  const copperhead = await resolveCopperheadInstall();
  for (const command of commands) {
    if (!ALLOWED_SETUP_COMMANDS.has(command)) {
      throw new Error(
        `setup command "${command}" is not in the LLM-free/network-free allowlist (${[...ALLOWED_SETUP_COMMANDS].join(', ')})`,
      );
    }
    // --no-hooks: a pre-commit hook is a product feature for a human's repo,
    // not something this task is testing, and a hook failure would show up
    // as a harness artifact rather than a fact about the model under test.
    await run('node', [copperhead.cliEntry, '--repo', sandboxDir, 'init', '--no-hooks'], {
      cwd: sandboxDir,
    });
  }

  await writeSandboxConfig(sandboxDir, task);

  await run('git', ['add', '-A'], { cwd: sandboxDir });
  await run('git', ['commit', '-q', '-m', 'copperbench: baseline'], { cwd: sandboxDir });
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: sandboxDir });

  return { path: sandboxDir, baselineCommit: stdout.trim() };
}

/**
 * Merges the task's `config` block onto whatever `copperhead init` already
 * scaffolded (notably the `schematic`/`board` paths it detected from the
 * fixture), rather than overwriting the file outright — an overwrite would
 * silently point the sandbox at no schematic at all. `llmCache` is forced
 * off regardless of what the task or the scaffold set (STANDARD.md section
 * 3.3, design D5): a cached turn would manufacture determinism the model
 * under test does not have.
 */
async function writeSandboxConfig(sandboxDir: string, task: TaskManifest): Promise<void> {
  const configPath = path.join(sandboxDir, '.copperhead', 'config.json');
  const scaffolded = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  const merged = {
    ...scaffolded,
    ...(task.config?.budgets ? { budgets: task.config.budgets } : {}),
    ...(task.config?.maxTurns !== undefined ? { maxTurns: task.config.maxTurns } : {}),
    ...(task.config?.maxRepairCycles !== undefined ? { maxRepairCycles: task.config.maxRepairCycles } : {}),
    ...(task.config?.stageMaxTurns ? { stageMaxTurns: task.config.stageMaxTurns } : {}),
    llmCache: false,
  };
  await writeFile(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
}
