import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeSandbox, type Sandbox } from '../src/runner/sandbox.js';
import { run } from '../src/util/exec.js';
import type { TaskManifest, AssertionManifest, FixtureManifest } from '../src/types.js';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface TaskFixtures {
  task: TaskManifest;
  assertions: AssertionManifest[];
  fixture: FixtureManifest;
}

export async function loadTaskFixtures(taskId: string): Promise<TaskFixtures> {
  const task = JSON.parse(await readFile(path.join(repoRoot, 'tasks', taskId, 'task.json'), 'utf8')) as TaskManifest;
  const assertions = JSON.parse(
    await readFile(path.join(repoRoot, 'tasks', taskId, 'assertions.json'), 'utf8'),
  ) as AssertionManifest[];
  const fixture = JSON.parse(
    await readFile(path.join(repoRoot, task.fixture.path, 'fixture.json'), 'utf8'),
  ) as FixtureManifest;
  return { task, assertions, fixture };
}

export function materializeTestSandbox(task: TaskManifest): Promise<Sandbox> {
  return materializeSandbox(task, { repoRoot });
}

export async function cleanupSandbox(sandbox: Sandbox | undefined): Promise<void> {
  if (!sandbox) return;
  await rm(sandbox.path, { recursive: true, force: true });
}

let syntheticRunCounter = 0;

/** Writes a synthetic transcript.jsonl into the sandbox — standing in for a
 * real copperhead run, which offline tests must not invoke (design D2).
 * Each call gets a distinct run directory so multiple transcripts can
 * coexist in one sandbox without overwriting each other. */
export async function writeSyntheticTranscript(
  sandbox: Sandbox,
  events: { type: string; data: unknown }[],
): Promise<string> {
  const ts = `2026-08-01T12-00-00-${String(syntheticRunCounter++).padStart(3, '0')}Z`;
  const dir = path.join(sandbox.path, '.copperhead', 'runs', ts);
  await mkdir(dir, { recursive: true });
  // Date.UTC, not a hand-formatted template: a template like
  // `12:00:0${i}` produces an invalid instant ("12:00:010.000Z") once a
  // transcript needs 10+ synthetic events, since the seconds field stops
  // being zero-padded to two digits.
  const lines = events.map((e, i) =>
    JSON.stringify({ ts: new Date(Date.UTC(2026, 7, 1, 12, 0, i)).toISOString(), ...e }),
  );
  await writeFile(path.join(dir, 'transcript.jsonl'), lines.join('\n') + '\n', 'utf8');
  return dir;
}

export async function commitAll(sandboxPath: string, message: string): Promise<void> {
  await run('git', ['add', '-A'], { cwd: sandboxPath });
  await run('git', ['commit', '-q', '-m', message], { cwd: sandboxPath });
}
