import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scanForSecrets } from '../scorer/secrets.js';
import type { ResultRecord } from '../types.js';

/** Characters illegal in a Windows path component, plus ':' specifically
 * because compat model ids look like "compat:qwen2.5-coder:7b" — replaced
 * rather than stripped, so two distinct ids never collide into one path. */
export function sanitizeForPath(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, '-');
}

export function resultRecordPath(resultsRoot: string, record: ResultRecord): string {
  const date = record.run.startedAt.slice(0, 10); // YYYY-MM-DD, from the run's own evidence, not write time
  return path.join(
    resultsRoot,
    date,
    sanitizeForPath(record.model.id),
    record.task.id,
    `run-${record.run.repeatIndex}.json`,
  );
}

export class SecretFoundError extends Error {
  constructor(readonly matches: string[]) {
    super(`refusing to write a result record: matched credential pattern(s) ${matches.join(', ')} (STANDARD.md section 6.1)`);
    this.name = 'SecretFoundError';
  }
}

export class RecordAlreadyExistsError extends Error {
  constructor(readonly filePath: string) {
    super(`refusing to overwrite an existing result record: ${filePath} (STANDARD.md section 13: records are append-only)`);
    this.name = 'RecordAlreadyExistsError';
  }
}

/**
 * STANDARD.md section 13 / design D19: before any artifact lands under
 * results/, it is scanned against the credential pattern set (shared with
 * the `no_secret` assertion via src/scorer/secrets.ts, so the two can't
 * drift apart). A match hard-fails the write — never scrub-and-continue,
 * per the explicit instruction: a redacted-but-written record would still
 * be evidence that a credential reached this far, and silently editing it
 * would hide that fact rather than surface it. Records are also
 * append-only: an existing file at the target path is refused, not
 * overwritten.
 */
export async function writeResultRecord(resultsRoot: string, record: ResultRecord): Promise<string> {
  const serialized = JSON.stringify(record, null, 2) + '\n';

  const matches = scanForSecrets(serialized);
  if (matches.length > 0) {
    throw new SecretFoundError(matches);
  }

  const filePath = resultRecordPath(resultsRoot, record);
  const exists = await access(filePath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    throw new RecordAlreadyExistsError(filePath);
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, serialized, 'utf8');
  return filePath;
}
