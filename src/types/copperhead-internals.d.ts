/**
 * Ambient types for the copperhead internals copperbench deep-imports from
 * `dist/`. copperhead ships no `.d.ts` (see CLAUDE.md and package.json's own
 * comment: these are not a stable public API), so this file is the single
 * place that names exactly which functions and shapes we depend on — pin an
 * exact copperhead version/commit (design D8) and treat a mismatch here
 * against copperhead's actual exports as a suite-version event, the same as
 * any other internals change. Grown module-by-module as the runner and
 * scorer come to need more of copperhead's internals.
 */

declare module 'copperhead/dist/config.js' {
  /**
   * True when baseURL is a loopback host (localhost/127.0.0.1/::1/.local),
   * per copperhead's own credential-waiver rule for local endpoints like
   * Ollama.
   */
  export function isLocalEndpoint(baseURL: string | undefined): boolean;
}

declare module 'copperhead/dist/kicad/sexp.js' {
  export interface SchematicSymbol {
    ref: string;
    value: string;
    footprint: string;
    libId: string;
    sheet: string;
    at: { x: number; y: number; rot: number };
    uuid: string;
  }

  export function listSymbols(rootSch: string): Promise<SchematicSymbol[]>;
  export function listNets(rootSch: string): Promise<string[]>;
}

declare module 'copperhead/dist/kicad/report.js' {
  export interface ViolationItem {
    description: string;
    x?: number;
    y?: number;
  }

  export interface Violation {
    severity: 'error' | 'warning' | string;
    type: string;
    description: string;
    sheet?: string;
    items: ViolationItem[];
  }

  export interface CheckReport {
    ok: boolean;
    source: 'erc' | 'drc';
    violations: Violation[];
  }
}

declare module 'copperhead/dist/kicad/cli.js' {
  import type { CheckReport } from 'copperhead/dist/kicad/report.js';

  export function runErc(schPath: string): Promise<CheckReport>;
  export function runDrc(pcbPath: string): Promise<CheckReport>;
}

declare module 'copperhead/dist/memory/constraints.js' {
  export interface Constraint {
    min?: number;
    max?: number;
    forbidden?: string[];
    value?: string | number;
    source: string;
    affects: string[];
    deferred?: string[];
  }

  export type ConstraintRegistry = Record<string, Constraint>;

  export function loadConstraints(repoRoot: string): Promise<ConstraintRegistry>;
}
