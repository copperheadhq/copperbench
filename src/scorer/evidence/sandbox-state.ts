import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { listNets, listSymbols, type SchematicSymbol } from 'copperhead/dist/kicad/sexp.js';
import { runErc, runDrc } from 'copperhead/dist/kicad/cli.js';
import { loadConstraints, type ConstraintRegistry } from 'copperhead/dist/memory/constraints.js';
import type { Violation } from 'copperhead/dist/kicad/report.js';

/**
 * kicad-cli's ERC/DRC invocation opens the .kicad_pro project and writes a
 * `.kicad_prl` (project-local settings) side-effect file next to it —
 * confirmed empirically (git status before/after a runErc call), not
 * documented by kicad-cli itself. Left alone, it becomes a new untracked
 * file the FIRST time the scorer checks a sandbox, which then makes
 * files_touched_subset spuriously fail on any SUBSEQUENT scoring pass of
 * that same sandbox — exactly the workflow --rescore exists for. Every
 * vendored fixture explicitly excludes .kicad_prl at vendoring time (see
 * each fixture.json's upstream.modifications note under fixtures/), so it
 * never legitimately belongs in a sandbox; removing it unconditionally after
 * every check keeps verification read-only from the sandbox's perspective,
 * matching STANDARD.md section 4's evidence-reading (not evidence-creating)
 * framing.
 */
async function cleanupKicadProjectLocal(sandboxPath: string, artifactRelPath: string): Promise<void> {
  const prlRelPath = artifactRelPath.replace(/\.(kicad_sch|kicad_pcb)$/, '.kicad_prl');
  if (prlRelPath === artifactRelPath) return; // path didn't have the expected extension
  await rm(path.join(sandboxPath, prlRelPath), { force: true });
}

/**
 * A schematic that a bad edit made unloadable, or a constraints.json that
 * failed to parse, is real evidence (the run broke something), not a
 * scorer-crashing condition — every function here returns a tagged result
 * instead of letting the underlying error propagate, so assertion
 * evaluation can fail the specific assertion with a clear reason rather than
 * aborting the whole scoring run.
 */
export type Evidence<T> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Evidence<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function endStateNets(sandboxPath: string, schematicRelPath: string): Promise<Evidence<string[]>> {
  return attempt(() => listNets(path.join(sandboxPath, schematicRelPath)));
}

export function endStateSymbols(
  sandboxPath: string,
  schematicRelPath: string,
): Promise<Evidence<SchematicSymbol[]>> {
  return attempt(() => listSymbols(path.join(sandboxPath, schematicRelPath)));
}

export function endStateConstraints(sandboxPath: string): Promise<Evidence<ConstraintRegistry>> {
  return attempt(() => loadConstraints(sandboxPath));
}

/** null (not an Evidence-wrapped error) means the doc simply doesn't exist —
 * a normal, common state for doc_contains to handle, not a failure. */
export async function readDoc(sandboxPath: string, docsDir: string, docName: string): Promise<string | null> {
  try {
    return await readFile(path.join(sandboxPath, docsDir, docName), 'utf8');
  } catch {
    return null;
  }
}

export interface ViolationCounts {
  errors: Record<string, number>;
  warnings: Record<string, number>;
}

function countByType(violations: Violation[], severity: 'error' | 'warning'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of violations) {
    if (v.severity !== severity) continue;
    counts[v.type] = (counts[v.type] ?? 0) + 1;
  }
  return counts;
}

export function endStateErc(sandboxPath: string, schematicRelPath: string): Promise<Evidence<ViolationCounts>> {
  return attempt(async () => {
    try {
      const report = await runErc(path.join(sandboxPath, schematicRelPath));
      return { errors: countByType(report.violations, 'error'), warnings: countByType(report.violations, 'warning') };
    } finally {
      await cleanupKicadProjectLocal(sandboxPath, schematicRelPath);
    }
  });
}

export function endStateDrc(sandboxPath: string, boardRelPath: string): Promise<Evidence<ViolationCounts>> {
  return attempt(async () => {
    try {
      const report = await runDrc(path.join(sandboxPath, boardRelPath));
      return { errors: countByType(report.violations, 'error'), warnings: countByType(report.violations, 'warning') };
    } finally {
      await cleanupKicadProjectLocal(sandboxPath, boardRelPath);
    }
  });
}

/**
 * STANDARD.md section 6: `erc_no_new_violations`/`drc_no_new_violations`
 * pass when nothing new appears relative to the fixture's recorded baseline,
 * by violation type and count. `severity: "error"` (default) checks only
 * error-level violations — the baseline-relative form exists precisely
 * because real fixtures carry permanent warning-level noise; `"warning"`
 * checks both.
 */
export function evaluateNoNewViolations(
  actual: ViolationCounts,
  baseline: { errorTypes?: Record<string, number>; warningTypes?: Record<string, number> },
  severity: 'error' | 'warning',
): { passed: boolean; detail: string | null } {
  const baselineErrors = baseline.errorTypes ?? {};
  const baselineWarnings = severity === 'warning' ? (baseline.warningTypes ?? {}) : {};
  const newFindings: string[] = [];

  for (const [type, count] of Object.entries(actual.errors)) {
    const allowed = baselineErrors[type] ?? 0;
    if (count > allowed) newFindings.push(`error:${type} (${count} > baseline ${allowed})`);
  }
  if (severity === 'warning') {
    for (const [type, count] of Object.entries(actual.warnings)) {
      const allowed = baselineWarnings[type] ?? 0;
      if (count > allowed) newFindings.push(`warning:${type} (${count} > baseline ${allowed})`);
    }
  }

  return {
    passed: newFindings.length === 0,
    detail: newFindings.length ? `new/increased violations: ${newFindings.join(', ')}` : null,
  };
}
