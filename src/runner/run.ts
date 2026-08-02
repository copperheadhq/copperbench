import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Sandbox } from './sandbox.js';
import type { CopperheadInstall } from './copperhead-install.js';
import type { TaskManifest } from '../types.js';
import { run } from '../util/exec.js';

export interface CompatEndpoint {
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1 for Ollama. */
  baseURL: string;
  /**
   * Name of the env var holding the endpoint's key. Omit for a loopback
   * endpoint: copperhead's own isLocalEndpoint() check waives the credential
   * requirement entirely for localhost/127.0.0.1/::1/.local (design D4 of
   * add-openai-compatible-provider), so Ollama needs nothing here.
   */
  apiKeyEnv?: string;
}

export interface RunExecutionOptions {
  sandbox: Sandbox;
  task: TaskManifest;
  model: string;
  copperhead: CopperheadInstall;
  compat?: CompatEndpoint;
}

export interface RunExecutionResult {
  /**
   * `.copperhead/runs/<ts>/` this invocation created, or null if the process
   * never got far enough to initialize one — a pre-run environment failure
   * (bad model id, missing kicad-cli, etc.), not a benchmarkable model
   * outcome, and the caller should treat it as distinct from a graded run.
   */
  transcriptDir: string | null;
  processExitCode: number | null;
  processSignal: NodeJS.Signals | null;
  /**
   * True when the runner killed the subprocess for exceeding
   * caps.wallClockSec. copperhead has no run-level wall-clock cap of its own
   * (only a per-turn watchdog, turnTimeoutMs), so this is the only
   * enforcement path for it (STANDARD.md section 3.3). When true, the
   * transcript may end with no run-end event — that is expected evidence of
   * a real cap breach (design decision confirmed with the user), not a
   * corrupt read, and the scorer/failure-classifier must treat it as such.
   */
  killedForWallClock: boolean;
  durationMs: number;
  /**
   * Operational diagnostics only — never evidence for grading (STANDARD.md
   * section 4, design D3). Stdout/stderr are presentation and may change
   * without a spec change; nothing here may feed an assertion.
   */
  stdout: string;
  stderr: string;
}

const MODES_IMPLEMENTED = new Set(['do']);

/**
 * child.kill() only signals the direct child (copperhead's cli.js) — it does
 * not reach kicad-cli or any other descendant copperhead itself spawns, so a
 * plain SIGKILL on wall-clock timeout can leave a grandchild process running
 * against the sandbox after the runner has already moved on (the same class
 * of orphaned-process bug observed firsthand earlier in this project: a
 * killed parent left a child alive and still touching the filesystem).
 * `detached: true` at spawn time puts the child in its own process group on
 * POSIX so `-pid` reaches the whole tree; on Windows, group membership has no
 * such signal-targeting effect, so `taskkill /T` is used instead to walk the
 * process tree by PID. Best-effort: the child may have already exited by the
 * time this runs, which both platforms report as a failure that is safe to
 * ignore here.
 */
async function killProcessTree(pid: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Already exited, or exited between the timeout firing and this call —
    // not a failure worth surfacing.
  }
}

/**
 * STANDARD.md section 3.2 / design D5: drive copperhead against an
 * already-materialized sandbox for one (task, model, repeat).
 *
 * caps.turns is handed to copperhead's own `--max-turns`, so a breach
 * surfaces natively as copperhead's `turn-budget-exhausted` exit path in the
 * transcript — no extra enforcement needed on this side. task.json's
 * `config.maxTurns` (written into the sandbox in 3.1) and `caps.turns` are
 * typically equal, but `caps.turns` is the authoritative hard cap per
 * STANDARD.md section 2.1, so it always wins via the CLI flag regardless.
 */
export async function executeRun(opts: RunExecutionOptions): Promise<RunExecutionResult> {
  if (!MODES_IMPLEMENTED.has(opts.task.mode)) {
    throw new Error(
      `task mode "${opts.task.mode}" has no run-execution path yet (only "do" is implemented, ` +
        'for the two worked tasks); sync/create/check each need their own before a task in that mode can run.',
    );
  }
  return executeDoRun(opts);
}

async function listRunDirs(sandboxPath: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(path.join(sandboxPath, '.copperhead', 'runs')));
  } catch {
    return new Set();
  }
}

async function executeDoRun(opts: RunExecutionOptions): Promise<RunExecutionResult> {
  const { sandbox, task, model, copperhead, compat } = opts;
  const prompt = task.request.prompt;
  if (!prompt) {
    throw new Error(`task "${task.id}" is mode "do" but declares no request.prompt`);
  }

  const before = await listRunDirs(sandbox.path);

  const args = [
    copperhead.cliEntry,
    '--repo', sandbox.path,
    '--json',
    'do', prompt,
    '--model', model,
    '--max-turns', String(task.caps.turns),
    // --allow-dirty is never passed (STANDARD.md section 3.3, design D5):
    // the sandbox starts clean, and a benchmark run has no legitimate reason
    // to relax that gate. --interactive is likewise never passed, so a
    // change proposal is auto-approved rather than pausing for a human.
  ];

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (compat) {
    env.COPPERHEAD_BASE_URL = compat.baseURL;
    if (compat.apiKeyEnv) env.COPPERHEAD_API_KEY_ENV = compat.apiKeyEnv;
  }

  const startedAt = Date.now();
  const child = spawn(process.execPath, args, {
    cwd: sandbox.path,
    env,
    // Explicit pipes, never 'inherit': a benchmark run must be structurally
    // non-interactive. copperhead's own budgetContinuePrompt() decides that
    // from process.stdin.isTTY inside the CHILD process, which piping
    // guarantees is false regardless of whether this process is itself
    // attached to a terminal.
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group on POSIX so a wall-clock kill can reach descendant
    // processes (kicad-cli) via killProcessTree, not just this direct child.
    detached: process.platform !== 'win32',
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });

  let killedForWallClock = false;
  const timer = setTimeout(() => {
    killedForWallClock = true;
    if (child.pid) void killProcessTree(child.pid);
    else child.kill('SIGKILL');
  }, task.caps.wallClockSec * 1000);
  timer.unref();

  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    },
  );
  clearTimeout(timer);

  const durationMs = Date.now() - startedAt;
  const after = await listRunDirs(sandbox.path);
  const newDirs = [...after].filter((d) => !before.has(d)).sort();
  const latest = newDirs.at(-1);
  const transcriptDir = latest ? path.join(sandbox.path, '.copperhead', 'runs', latest) : null;

  return {
    transcriptDir,
    processExitCode: code,
    processSignal: signal,
    killedForWallClock,
    durationMs,
    stdout,
    stderr,
  };
}
