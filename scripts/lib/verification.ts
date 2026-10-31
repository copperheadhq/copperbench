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
import { child, children, isList, parseSexp } from 'copperhead/dist/kicad/sexp.js';

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

// ---------------------------------------------------------------------------
// Netlist connectivity extraction and parsing
// ---------------------------------------------------------------------------

export interface ParsedNetlist {
  /** All component reference designators present in the design. */
  components: Set<string>;
  /** Map of refdes -> set of known pin numbers for that component. */
  componentPins: Map<string, Set<string>>;
  /** Map of `${refdes}:${pin}` -> netName */
  pinToNet: Map<string, string>;
  /** Map of `${refdes}:${pin}` -> conflicting net names if ambiguous */
  ambiguousPins: Map<string, string[]>;
  /** Set of duplicate component reference designators */
  duplicateRefdes: Set<string>;
  /** List of all net names */
  nets: string[];
}

function atom(node: unknown, idx: number): string | undefined {
  if (!Array.isArray(node)) return undefined;
  const v = node[idx];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Parse a KiCad s-expression netlist export (`kicad-cli sch export netlist --format kicadsexpr`).
 * Pure parser: does not touch disk or invoke subprocesses.
 */
export function parseNetlistSexp(text: string): ParsedNetlist {
  const root = parseSexp(text)[0];
  const components = new Set<string>();
  const componentPins = new Map<string, Set<string>>();
  const pinToNet = new Map<string, string>();
  const ambiguousPins = new Map<string, string[]>();
  const duplicateRefdes = new Set<string>();
  const nets: string[] = [];

  if (!root || !isList(root)) {
    return { components, componentPins, pinToNet, ambiguousPins, duplicateRefdes, nets };
  }

  const compsNode = child(root, 'components');
  if (compsNode) {
    for (const comp of children(compsNode, 'comp')) {
      const ref = atom(child(comp, 'ref'), 1);
      if (ref && !ref.startsWith('#')) {
        if (components.has(ref)) {
          duplicateRefdes.add(ref);
        }
        components.add(ref);
        if (!componentPins.has(ref)) {
          componentPins.set(ref, new Set());
        }
      }
    }
  }

  const netsNode = child(root, 'nets');
  if (netsNode) {
    for (const net of children(netsNode, 'net')) {
      const netName = atom(child(net, 'name'), 1);
      if (!netName) continue;
      nets.push(netName);

      for (const node of children(net, 'node')) {
        const ref = atom(child(node, 'ref'), 1);
        const pin = atom(child(node, 'pin'), 1);
        if (!ref || !pin || ref.startsWith('#')) continue;

        components.add(ref);
        if (!componentPins.has(ref)) {
          componentPins.set(ref, new Set());
        }
        componentPins.get(ref)!.add(pin);

        const key = `${ref}:${pin}`;
        if (pinToNet.has(key)) {
          const existing = pinToNet.get(key)!;
          if (existing !== netName) {
            const amb: string[] = ambiguousPins.get(key) ?? [existing];
            if (!amb.includes(netName)) amb.push(netName);
            ambiguousPins.set(key, amb);
          }
        } else {
          pinToNet.set(key, netName);
        }
      }
    }
  }

  return { components, componentPins, pinToNet, ambiguousPins, duplicateRefdes, nets };
}

/**
 * Traverse the schematic (including hierarchical subsheets) to extract all
 * component reference designators and their defined pins from `lib_symbols`.
 */
export function extractSchematicPins(rootSch: string): {
  componentPins: Map<string, Set<string>>;
  duplicateRefdes: Set<string>;
} {
  const componentPins = new Map<string, Set<string>>();
  const duplicateRefdes = new Set<string>();
  const seenSheets = new Set<string>();
  const seenInstances = new Map<string, { libId: string; units: Set<string> }>();
  const pinDefs = new Map<string, Set<string>>();
  const symbolExtensions = new Map<string, string>();

  function walkSheet(filePath: string): void {
    const abs = path.resolve(filePath);
    if (seenSheets.has(abs) || !existsSync(abs)) return;
    seenSheets.add(abs);

    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      return;
    }
    const root = parseSexp(text)[0];
    if (!root || !isList(root)) return;

    // Collect pin definitions from lib_symbols in this sheet
    const libSymbols = child(root, 'lib_symbols');
    if (libSymbols) {
      for (const sym of children(libSymbols, 'symbol')) {
        const name = atom(sym, 1);
        if (!name) continue;
        const extendsSym = atom(child(sym, 'extends'), 1);
        if (extendsSym) {
          symbolExtensions.set(name, extendsSym);
        }
        const pins = new Set<string>();
        const walkPinNodes = (n: unknown): void => {
          if (!isList(n)) return;
          if (n[0] === 'pin') {
            const num = atom(child(n, 'number'), 1);
            if (num !== undefined) pins.add(String(num));
          }
          for (const c of n) walkPinNodes(c);
        };
        walkPinNodes(sym);
        pinDefs.set(name, pins);
      }
    }

    // Collect component instances on this sheet
    for (const s of children(root, 'symbol')) {
      const libId = atom(child(s, 'lib_id'), 1);
      if (!libId || libId.startsWith('power:')) continue;
      let ref: string | undefined;
      for (const p of children(s, 'property')) {
        if (atom(p, 1) === 'Reference') {
          ref = atom(p, 2);
          break;
        }
      }
      if (!ref || ref.startsWith('#')) continue;

      const unit = atom(child(s, 'unit'), 1) ?? '1';

      if (!seenInstances.has(ref)) {
        seenInstances.set(ref, { libId, units: new Set([unit]) });
      } else {
        const existingInst = seenInstances.get(ref)!;
        if (existingInst.libId !== libId || existingInst.units.has(unit)) {
          duplicateRefdes.add(ref);
        } else {
          existingInst.units.add(unit);
        }
      }

      const existing = componentPins.get(ref) ?? new Set<string>();
      const defPins = pinDefs.get(libId);
      if (defPins) {
        for (const p of defPins) existing.add(p);
      }
      componentPins.set(ref, existing);
    }

    // Recurse into hierarchical subsheets
    for (const sheet of children(root, 'sheet')) {
      let subFile: string | undefined;
      for (const p of children(sheet, 'property')) {
        const key = atom(p, 1);
        if (key === 'Sheetfile' || key === 'Sheet file') {
          subFile = atom(p, 2);
          break;
        }
      }
      if (subFile) {
        walkSheet(path.resolve(path.dirname(abs), subFile));
      }
    }
  }

  walkSheet(rootSch);

  // Resolve symbol inheritance for pin definitions (multi-level inheritance support)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [derived, base] of symbolExtensions) {
      const basePins = pinDefs.get(base);
      if (basePins) {
        let derivedPins = pinDefs.get(derived);
        if (!derivedPins) {
          derivedPins = new Set<string>();
          pinDefs.set(derived, derivedPins);
        }
        for (const p of basePins) {
          if (!derivedPins.has(p)) {
            derivedPins.add(p);
            changed = true;
          }
        }
      }
    }
  }

  // Populate component pins for all instances from fully resolved pin definitions
  for (const [ref, inst] of seenInstances) {
    const defPins = pinDefs.get(inst.libId);
    if (defPins) {
      const compPins = componentPins.get(ref) ?? new Set<string>();
      for (const p of defPins) compPins.add(p);
      componentPins.set(ref, compPins);
    }
  }

  return { componentPins, duplicateRefdes };
}

/**
 * Export a netlist using kicad-cli against a copy of the project, never the sandbox.
 * Enriches the parsed netlist with all known component pins from the schematic
 * so disconnected pins and missing pins remain distinguishable.
 */
export function exportNetlist(schematicPath: string, projectDir: string): ParsedNetlist | undefined {
  const dir = mkdtempSync(path.join(tmpdir(), 'copperbench-nl-'));
  const work = path.join(dir, 'project');
  const out = path.join(dir, 'netlist.net');
  try {
    cpSync(projectDir, work, { recursive: true });
    const copied = path.join(work, path.relative(projectDir, schematicPath));
    execFileSync('kicad-cli', ['sch', 'export', 'netlist', '--format', 'kicadsexpr', '-o', out, copied], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (!existsSync(out)) return undefined;
    const netlist = parseNetlistSexp(readFileSync(out, 'utf8'));

    // Supplement with schematic pin definitions so disconnected pins are known
    try {
      const schInfo = extractSchematicPins(schematicPath);
      for (const [ref, pins] of schInfo.componentPins) {
        netlist.components.add(ref);
        const compPins = netlist.componentPins.get(ref) ?? new Set<string>();
        for (const p of pins) compPins.add(p);
        netlist.componentPins.set(ref, compPins);
      }
      for (const ref of schInfo.duplicateRefdes) {
        netlist.duplicateRefdes.add(ref);
      }
    } catch {
      // Schematic extraction is best-effort enrichment on top of the netlist
    }

    return netlist;
  } catch {
    return undefined;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Ignore transient cleanup locks
    }
  }
}
