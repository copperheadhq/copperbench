// The three evidence sources, and exactly three (STANDARD.md section 4, D3).
//
//   1. Sandbox end state, via copperhead's read-only s-expression parser.
//   2. The diff against the run's baseline commit, plus untracked files.
//   3. The transcript, including run-start and run-end.
//
// CLI stdout and stderr are NOT evidence. Output formatting is presentation and
// may change without a spec change, so grading against it would score cosmetic
// edits as behavior regressions. The transcript is the contract surface.
//
// All three are files on disk, which is what makes re-scoring possible with no
// provider and no network.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';

import { listNets, listSymbols } from 'copperhead/dist/kicad/sexp.js';

import { baselineLineCount, changedPaths, commitsSince, diffStatFor, treeIsByteIdenticalTo } from './git.ts';

// ---------------------------------------------------------------------------
// 1. Sandbox end state
// ---------------------------------------------------------------------------

export interface SymbolInfo {
  ref: string;
  value: string;
  footprint?: string | undefined;
}

export class EndState {
  constructor(
    readonly dir: string,
    /** Path to the root schematic, relative to the sandbox. */
    readonly schematicPath: string,
  ) {}

  private netsCache: string[] | undefined;
  private symbolsCache: SymbolInfo[] | undefined;

  get schematicAbs(): string {
    return path.join(this.dir, this.schematicPath);
  }

  async nets(): Promise<string[]> {
    if (this.netsCache === undefined) {
      this.netsCache = existsSync(this.schematicAbs) ? await listNets(this.schematicAbs) : [];
    }
    return this.netsCache;
  }

  async symbols(): Promise<SymbolInfo[]> {
    if (this.symbolsCache === undefined) {
      this.symbolsCache = existsSync(this.schematicAbs)
        ? ((await listSymbols(this.schematicAbs)) as SymbolInfo[])
        : [];
    }
    return this.symbolsCache;
  }

  /** Read a document relative to the sandbox, or undefined when absent. */
  doc(rel: string): string | undefined {
    const candidates = [rel, path.join('docs', rel)];
    for (const c of candidates) {
      const abs = path.join(this.dir, c);
      if (existsSync(abs)) return readFileSync(abs, 'utf8');
    }
    return undefined;
  }

  /** The recorded constraint set copperhead maintains. */
  constraints(): Record<string, unknown> | undefined {
    const abs = path.join(this.dir, '.copperhead', 'constraints.json');
    if (!existsSync(abs)) return undefined;
    try {
      return JSON.parse(readFileSync(abs, 'utf8')) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  /** Every regular file in the sandbox, excluding .git, for the secret scan. */
  allFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSyncSafe(dir)) {
        if (e.name === '.git') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) out.push(full);
      }
    };
    walk(this.dir);
    return out;
  }
}

function readdirSyncSafe(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. The diff
// ---------------------------------------------------------------------------

export class DiffEvidence {
  constructor(
    readonly dir: string,
    readonly baselineSha: string,
  ) {}

  changed(): string[] {
    return changedPaths(this.dir, this.baselineSha);
  }

  commits(): number {
    return commitsSince(this.dir, this.baselineSha);
  }

  changedLinesIn(filePath: string): number {
    return diffStatFor(this.dir, this.baselineSha, filePath);
  }

  baselineLines(filePath: string): number {
    return baselineLineCount(this.dir, this.baselineSha, filePath);
  }

  isPristine(): boolean {
    return treeIsByteIdenticalTo(this.dir, this.baselineSha);
  }
}

// ---------------------------------------------------------------------------
// 3. The transcript
// ---------------------------------------------------------------------------

export interface TranscriptEvent {
  type: string;
  [k: string]: unknown;
}

export class Transcript {
  constructor(readonly events: TranscriptEvent[]) {}

  /** Read `.copperhead/runs/<ts>/transcript.jsonl`, newest run wins. */
  static fromSandbox(dir: string): Transcript {
    const runsDir = path.join(dir, '.copperhead', 'runs');
    if (!existsSync(runsDir)) return new Transcript([]);
    const stamps = readdirSyncSafe(runsDir)
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const latest = stamps[stamps.length - 1];
    if (latest === undefined) return new Transcript([]);
    return Transcript.fromFile(path.join(runsDir, latest, 'transcript.jsonl'));
  }

  static fromFile(file: string): Transcript {
    if (!existsSync(file)) return new Transcript([]);
    const events: TranscriptEvent[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        events.push(JSON.parse(trimmed) as TranscriptEvent);
      } catch {
        // A malformed line is not evidence; it is also not a reason to abandon
        // the rest of the transcript.
      }
    }
    return new Transcript(events);
  }

  runEnd(): TranscriptEvent | undefined {
    return this.events.find((e) => e.type === 'run-end');
  }

  exitPath(): string | undefined {
    const end = this.runEnd();
    return typeof end?.['exitPath'] === 'string' ? (end['exitPath'] as string) : undefined;
  }

  of(type: string): TranscriptEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Whole transcript as text, for citation and secret checks. */
  text(): string {
    return this.events.map((e) => JSON.stringify(e)).join('\n');
  }
}

export interface Evidence {
  endState: EndState;
  diff: DiffEvidence;
  transcript: Transcript;
  /** Fixture baseline reports, for the baseline-relative assertions. */
  baseline: Record<string, unknown>;
  /** False when kicad-cli is absent, which makes ERC/DRC unevaluable. */
  kicadAvailable: boolean;
}
