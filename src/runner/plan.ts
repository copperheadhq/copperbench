import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskManifest } from '../types.js';

/** STANDARD.md section 8: default repeat count when neither the CLI nor the
 * task manifest overrides it. */
export const DEFAULT_REPEATS = 3;

export interface RunPlanEntry {
  taskId: string;
  task: TaskManifest;
  /** 1-based. */
  repeatIndex: number;
  repeatsPlanned: number;
}

export async function discoverTaskIds(repoRoot: string): Promise<string[]> {
  const tasksDir = path.join(repoRoot, 'tasks');
  const entries = await readdir(tasksDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function loadTask(repoRoot: string, taskId: string): Promise<TaskManifest> {
  const p = path.join(repoRoot, 'tasks', taskId, 'task.json');
  return JSON.parse(await readFile(p, 'utf8')) as TaskManifest;
}

/**
 * STANDARD.md section 8: 3 repeats by default; a task may declare its own
 * lower default (create-mode tasks, where a single run is minutes long); an
 * explicit CLI override always wins over both.
 */
export function resolveRepeatCount(task: TaskManifest, override?: number): number {
  if (override !== undefined) return override;
  return task.repeats ?? DEFAULT_REPEATS;
}

/**
 * Expands a task-id list into one plan entry per (task, repeat) — the unit
 * the runner executes. Model selection is deliberately not part of this
 * plan: this pass targets a single hardcoded/CLI-supplied model, not a
 * matrix (migration step 4 is out of scope here).
 */
export async function buildRunPlan(
  repoRoot: string,
  taskIds: string[],
  repeatsOverride?: number,
): Promise<RunPlanEntry[]> {
  const plan: RunPlanEntry[] = [];
  for (const taskId of taskIds) {
    const task = await loadTask(repoRoot, taskId);
    const repeatsPlanned = resolveRepeatCount(task, repeatsOverride);
    for (let repeatIndex = 1; repeatIndex <= repeatsPlanned; repeatIndex++) {
      plan.push({ taskId, task, repeatIndex, repeatsPlanned });
    }
  }
  return plan;
}
