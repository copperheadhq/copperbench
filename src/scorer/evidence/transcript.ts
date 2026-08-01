import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface TranscriptEvent {
  ts: string;
  type: string;
  data: unknown;
}

export interface TranscriptEvidence {
  events: TranscriptEvent[];
  runStart: TranscriptEvent | null;
  runEnd: TranscriptEvent | null;
}

/**
 * STANDARD.md section 4 / design D3: the transcript is one of exactly three
 * evidence sources. `transcriptDir: null` (a wall-clock kill before
 * Transcript.init(), or any other pre-init crash) and a transcript with no
 * `run-end` event (a wall-clock kill mid-run — design decision confirmed
 * with the user in the 3.2 write-up) are both real, valid evidence states,
 * not parse failures — callers must not treat a missing run-end as an error.
 */
export async function readTranscript(transcriptDir: string | null): Promise<TranscriptEvidence> {
  if (!transcriptDir) return { events: [], runStart: null, runEnd: null };
  let raw: string;
  try {
    raw = await readFile(path.join(transcriptDir, 'transcript.jsonl'), 'utf8');
  } catch {
    return { events: [], runStart: null, runEnd: null };
  }
  const events: TranscriptEvent[] = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TranscriptEvent);
  return {
    events,
    runStart: events.find((e) => e.type === 'run-start') ?? null,
    runEnd: events.find((e) => e.type === 'run-end') ?? null,
  };
}

/**
 * The `run-end` exit path, per STANDARD.md section 11 / the assertion
 * vocabulary's `exit_path_in` enum. `null` means no run-end event exists —
 * real evidence of an incomplete run (see readTranscript's note), never
 * defaulted to a named path.
 */
export function exitPathOf(evidence: TranscriptEvidence): string | null {
  const data = evidence.runEnd?.data as { exitPath?: string } | undefined;
  return data?.exitPath ?? null;
}

/** The `run-refused` event's summary text — the only place a refusal's
 * reasoning lives, so it's what `refusal_cites_budget` reads. */
export function refusalSummary(evidence: TranscriptEvidence): string | null {
  const refused = evidence.events.find((e) => e.type === 'run-refused');
  const data = refused?.data as { summary?: string } | undefined;
  return data?.summary ?? null;
}
