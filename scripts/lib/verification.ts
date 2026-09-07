// ERC and DRC evidence, and the baseline-relative comparison (D21, D23).
//
// The invocation here is the one the fixture READMEs document and the one the
// recorded baselines were measured with: DEFAULT severity plus
// --schematic-parity. That detail is load-bearing. `--severity-all` overrides
// the project's own .kicad_pro severities and exclusions, which on the vendored
// fixtures inflates the microphone board from 0 baseline DRC errors to 3 and
// the Orin baseboard from 6 to 24. Grading against those numbers would fail
// every task for reasons that have nothing to do with the model.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { detectKicadCliVersion } from './record.ts';

export type Severity = 'error' | 'warning';

export interface Violation {
  type: string;
  severity: string;
}

/**
 * A parsed kicad-cli JSON report. Every list keeps each entry's severity, so
 * a comparison can honor the severity the assertion asked for uniformly:
 * parity and unconnected items are graded by the same rule as violations.
 */
export interface VerificationReport {
  violations: Violation[];
  unconnected: Violation[];
  parity: Violation[];
}

/** The fixture's recorded baseline, as fixture.json records it. */
export interface BaselineCounts {
  errors: number;
  errorTypes?: Record<string, number> | undefined;
  warnings: number;
  warningTypes?: Record<string, number> | undefined;
  unconnectedItems?: number | undefined;
  schematicParity?: number | undefined;
  schematicParityTypes?: Record<string, number> | undefined;
}

/** One probe, shared with the comparability stamp, so the two cannot disagree. */
export function kicadCliAvailable(): boolean {
  return detectKicadCliVersion() !== null;
}

/**
 * Run a report against a COPY of the project, never the sandbox itself.
 *
 * kicad-cli writes project-local state (`.kicad_prl`) beside the file it reads.
 * The sandbox ignores that file from its baseline on, but the scorer still
 * must not be visible in its own evidence, so it works on a copy.
 */
function runReport(args: string[], input: string, projectDir: string): VerificationReport | undefined {
  const dir = mkdtempSync(path.join(tmpdir(), 'copperbench-vrf-'));
  const work = path.join(dir, 'project');
  const out = path.join(dir, 'report.json');
  try {
    cpSync(projectDir, work, { recursive: true });
    const copied = path.join(work, path.relative(projectDir, input));
    execFileSync('kicad-cli', [...args, '--format', 'json', '-o', out, copied], { stdio: 'ignore' });
    if (!existsSync(out)) return undefined;
    const r = JSON.parse(readFileSync(out, 'utf8')) as Record<string, any>;
    // ERC nests violations per sheet; DRC lists them flat.
    const violations: Violation[] = Array.isArray(r['sheets'])
      ? (r['sheets'] as Array<{ violations?: Violation[] }>).flatMap((s) => s.violations ?? [])
      : ((r['violations'] as Violation[]) ?? []);
    return {
      violations,
      unconnected: (r['unconnected_items'] as Violation[] | undefined) ?? [],
      parity: (r['schematic_parity'] as Violation[] | undefined) ?? [],
    };
  } catch {
    // A board that will not load is a real result, not a crash: the caller
    // reports it as a failure rather than an unevaluable assertion.
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runErc(schematicPath: string, projectDir: string): VerificationReport | undefined {
  return runReport(['sch', 'erc'], schematicPath, projectDir);
}

export function runDrc(boardPath: string, projectDir: string): VerificationReport | undefined {
  return runReport(['pcb', 'drc', '--schematic-parity'], boardPath, projectDir);
}

function atSeverity(items: Violation[], severities: Severity[]): Violation[] {
  return items.filter((v) => severities.includes(v.severity as Severity));
}

function countByType(items: Violation[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of items) out[v.type] = (out[v.type] ?? 0) + 1;
  return out;
}

/** Types exceeding their allowed count, phrased for a reader of the failure. */
function exceeding(actual: Record<string, number>, allowed: Record<string, number>, label = ''): string[] {
  const out: string[] = [];
  for (const [type, n] of Object.entries(actual)) {
    const permitted = allowed[type] ?? 0;
    if (n > permitted) {
      out.push(permitted === 0 ? `${label}${type} x${n} (not in baseline)` : `${label}${type} x${n} > baseline ${permitted}`);
    }
  }
  return out;
}

export interface Comparison {
  ok: boolean;
  detail: string;
}

/**
 * Compare a post-run report against the fixture's recorded baseline.
 *
 * The recorded enumeration is an ALLOWLIST (D23): a violation type absent from
 * it, or present but exceeding its recorded count, is a new violation. This is
 * what keeps a pre-existing error distinguishable from an agent-introduced one
 * without requiring a clean baseline that no real board can offer.
 *
 * The requested severity applies to everything the report contains. A
 * warning-level parity item counted against an error-level assertion would
 * fail a correct schematic-side edit on a board the task forbids touching.
 */
export function compareToBaseline(
  report: VerificationReport,
  baseline: BaselineCounts,
  severity: Severity,
  kind: 'ERC' | 'DRC',
): Comparison {
  // "error and above" is the default; asking for warnings includes both.
  const severities: Severity[] = severity === 'warning' ? ['error', 'warning'] : ['error'];

  const allowed: Record<string, number> = { ...(baseline.errorTypes ?? {}) };
  if (severity === 'warning') {
    for (const [t, n] of Object.entries(baseline.warningTypes ?? {})) {
      allowed[t] = (allowed[t] ?? 0) + n;
    }
  }

  const actual = countByType(atSeverity(report.violations, severities));
  const introduced = exceeding(actual, allowed);

  if (kind === 'DRC') {
    // Unconnected items are what a bad edit breaks, so they are compared too.
    const unconnected = atSeverity(report.unconnected, severities).length;
    const baseUn = baseline.unconnectedItems ?? 0;
    if (unconnected > baseUn) introduced.push(`unconnected items ${unconnected} > baseline ${baseUn}`);

    // Parity is allowlisted by type when the fixture enumerates its types, the
    // same way errors are: a board carrying metadata drift at baseline must
    // not be free to gain a net conflict under the same total.
    const parity = atSeverity(report.parity, severities);
    if (baseline.schematicParityTypes !== undefined) {
      introduced.push(...exceeding(countByType(parity), baseline.schematicParityTypes, 'parity '));
    } else {
      const basePa = baseline.schematicParity ?? 0;
      if (parity.length > basePa) introduced.push(`schematic parity ${parity.length} > baseline ${basePa}`);
    }
  }

  const total = Object.values(actual).reduce((a, n) => a + n, 0);
  return introduced.length === 0
    ? { ok: true, detail: `no new ${kind} violations at ${severity}+ (${total} present, all within the recorded baseline)` }
    : { ok: false, detail: `new ${kind} violations: ${introduced.join('; ')}` };
}
