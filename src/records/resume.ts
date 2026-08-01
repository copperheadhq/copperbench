import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeForPath } from './write.js';

async function fileExists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

/**
 * tasks.md section 3.5: a completed (task, model, repeat) with an existing
 * record is skipped unless `--force`, so an interrupted expensive suite
 * resumes rather than restarting. A record's path is dated by when its run
 * *started* (STANDARD.md section 13's `results/<date>/...` layout), which
 * the caller doesn't know in advance — so this searches every date
 * directory under `resultsRoot` for the exact (model, task, repeat) triple,
 * rather than checking one predictable path.
 */
export async function findExistingRecord(
  resultsRoot: string,
  modelId: string,
  taskId: string,
  repeatIndex: number,
): Promise<string | null> {
  let dateDirs: string[];
  try {
    dateDirs = await readdir(resultsRoot);
  } catch {
    return null; // results/ doesn't exist yet — nothing to resume from
  }
  const sanitizedModel = sanitizeForPath(modelId);
  const targetName = `run-${repeatIndex}.json`;
  for (const date of dateDirs) {
    const candidate = path.join(resultsRoot, date, sanitizedModel, taskId, targetName);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}
