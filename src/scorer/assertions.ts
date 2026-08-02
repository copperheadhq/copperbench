import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { SchematicSymbol } from 'copperhead/dist/kicad/sexp.js';
import type { ConstraintRegistry } from 'copperhead/dist/memory/constraints.js';
import type { AssertionManifest, FixtureManifest, TaskManifest } from '../types.js';
import { baselineLineCount, type DiffEvidence } from './evidence/diff.js';
import { exitPathOf, refusalSummary, type TranscriptEvidence } from './evidence/transcript.js';
import {
  endStateConstraints,
  endStateDrc,
  endStateErc,
  endStateNets,
  endStateSymbols,
  evaluateNoNewViolations,
  readDoc,
  type Evidence,
} from './evidence/sandbox-state.js';
import { globToRegExp } from './glob.js';
import { scanForSecrets } from './secrets.js';

export type EvidenceSource = 'end-state' | 'diff' | 'transcript';

export interface AssertionEvalResult {
  passed: boolean;
  detail: string | null;
  evidenceSource: EvidenceSource;
}

export interface ScoreContext {
  sandboxPath: string;
  baselineCommit: string;
  task: TaskManifest;
  fixture: FixtureManifest;
  diff: DiffEvidence;
  transcript: TranscriptEvidence;
  _nets?: Evidence<string[]>;
  _symbols?: Evidence<SchematicSymbol[]>;
  _constraints?: Evidence<ConstraintRegistry>;
  _erc?: Evidence<{ errors: Record<string, number>; warnings: Record<string, number> }>;
  _drc?: Evidence<{ errors: Record<string, number>; warnings: Record<string, number> }>;
}

async function getNets(ctx: ScoreContext): Promise<Evidence<string[]>> {
  ctx._nets ??= await endStateNets(ctx.sandboxPath, ctx.fixture.artifacts.schematic);
  return ctx._nets;
}
async function getSymbols(ctx: ScoreContext): Promise<Evidence<SchematicSymbol[]>> {
  ctx._symbols ??= await endStateSymbols(ctx.sandboxPath, ctx.fixture.artifacts.schematic);
  return ctx._symbols;
}
async function getConstraints(ctx: ScoreContext): Promise<Evidence<ConstraintRegistry>> {
  ctx._constraints ??= await endStateConstraints(ctx.sandboxPath);
  return ctx._constraints;
}
async function getErc(ctx: ScoreContext) {
  ctx._erc ??= await endStateErc(ctx.sandboxPath, ctx.fixture.artifacts.schematic);
  return ctx._erc;
}
async function getDrc(ctx: ScoreContext) {
  if (!ctx._drc) {
    ctx._drc = ctx.fixture.artifacts.board
      ? await endStateDrc(ctx.sandboxPath, ctx.fixture.artifacts.board)
      : { ok: false, error: 'fixture has no board artifact' };
  }
  return ctx._drc;
}

/**
 * Vocabulary types recognized by STANDARD.md section 6 but not implemented
 * by this scorer pass — only the 14 types exercised by the two worked tasks
 * are required to work correctly (design brief for this pass). Distinct
 * from an actually-unknown type below: this is a scorer limitation stated
 * clearly, not a malformed assertions.json.
 */
const NOT_IMPLEMENTED = new Set([
  'erc_clean',
  'drc_clean',
  'check_clean',
  'drift_clean',
  'symbol_present',
  'pin_net_equals',
  'doc_row_matches',
  'rollback_byte_identical',
  'transcript_event',
]);

function args(assertion: AssertionManifest): Record<string, unknown> {
  return assertion.args ?? {};
}

export async function evaluateAssertion(
  ctx: ScoreContext,
  assertion: AssertionManifest,
): Promise<AssertionEvalResult> {
  const type = assertion.type;

  if (NOT_IMPLEMENTED.has(type)) {
    throw new Error(
      `assertion type "${type}" is in the closed vocabulary but not implemented by this scorer pass ` +
        `(task "${ctx.task.id}", assertion "${assertion.id}")`,
    );
  }

  switch (type) {
    case 'net_present': {
      const r = await getNets(ctx);
      if (!r.ok) return { passed: false, detail: `schematic unreadable: ${r.error}`, evidenceSource: 'end-state' };
      const net = args(assertion).net as string;
      const found = r.value.includes(net);
      return { passed: found, detail: found ? null : `net "${net}" not found`, evidenceSource: 'end-state' };
    }
    case 'net_absent': {
      const r = await getNets(ctx);
      if (!r.ok) return { passed: false, detail: `schematic unreadable: ${r.error}`, evidenceSource: 'end-state' };
      const net = args(assertion).net as string;
      const found = r.value.includes(net);
      return { passed: !found, detail: found ? `net "${net}" still present` : null, evidenceSource: 'end-state' };
    }
    case 'symbol_absent': {
      const r = await getSymbols(ctx);
      if (!r.ok) return { passed: false, detail: `schematic unreadable: ${r.error}`, evidenceSource: 'end-state' };
      const refdes = args(assertion).refdes as string;
      const found = r.value.some((s) => s.ref === refdes);
      return { passed: !found, detail: found ? `symbol ${refdes} exists` : null, evidenceSource: 'end-state' };
    }
    case 'doc_contains': {
      const a = args(assertion);
      const doc = a.doc as string;
      const absent = Boolean(a.absent);
      const content = await readDoc(ctx.sandboxPath, 'docs', doc);
      if (content === null) {
        return { passed: absent, detail: absent ? null : `doc ${doc} not found`, evidenceSource: 'end-state' };
      }
      const matches = new RegExp(a.pattern as string).test(content);
      const want = !absent;
      const passed = matches === want;
      return {
        passed,
        detail: passed ? null : want ? `pattern not found in ${doc}` : `pattern unexpectedly found in ${doc}`,
        evidenceSource: 'end-state',
      };
    }
    case 'constraint_registered': {
      const r = await getConstraints(ctx);
      if (!r.ok) {
        return { passed: false, detail: `constraints.json unreadable: ${r.error}`, evidenceSource: 'end-state' };
      }
      const a = args(assertion);
      const key = a.key as string;
      const entry = r.value[key];
      if (!entry) {
        return {
          passed: false,
          detail: `key "${key}" not found in .copperhead/constraints.json`,
          evidenceSource: 'end-state',
        };
      }
      if (a.source && entry.source !== a.source) {
        return {
          passed: false,
          detail: `source mismatch: expected "${a.source as string}", got "${entry.source}"`,
          evidenceSource: 'end-state',
        };
      }
      if (a.affects) {
        const wanted = a.affects as string[];
        const missing = wanted.filter((w) => !entry.affects?.includes(w));
        if (missing.length) {
          return { passed: false, detail: `affects missing: ${missing.join(', ')}`, evidenceSource: 'end-state' };
        }
      }
      return { passed: true, detail: null, evidenceSource: 'end-state' };
    }
    case 'erc_no_new_violations': {
      const r = await getErc(ctx);
      if (!r.ok) return { passed: false, detail: `ERC could not run: ${r.error}`, evidenceSource: 'end-state' };
      const severity = (args(assertion).severity as 'error' | 'warning' | undefined) ?? 'error';
      const result = evaluateNoNewViolations(r.value, ctx.fixture.baseline.erc, severity);
      return { ...result, evidenceSource: 'end-state' };
    }
    case 'drc_no_new_violations': {
      const baseline = ctx.fixture.baseline.drc;
      if (!baseline) {
        return { passed: false, detail: 'fixture has no recorded DRC baseline', evidenceSource: 'end-state' };
      }
      const r = await getDrc(ctx);
      if (!r.ok) return { passed: false, detail: `DRC could not run: ${r.error}`, evidenceSource: 'end-state' };
      const severity = (args(assertion).severity as 'error' | 'warning' | undefined) ?? 'error';
      const result = evaluateNoNewViolations(r.value, baseline, severity);
      return { ...result, evidenceSource: 'end-state' };
    }
    case 'files_touched_subset': {
      const allowed = (args(assertion).allowed as string[]).map(globToRegExp);
      const touched = [...ctx.diff.changedFiles.map((f) => f.path), ...ctx.diff.untrackedFiles];
      const violations = touched.filter((f) => !allowed.some((p) => p.test(f)));
      return {
        passed: violations.length === 0,
        detail: violations.length ? `touched outside allowlist: ${violations.join(', ')}` : null,
        evidenceSource: 'diff',
      };
    }
    case 'file_unchanged': {
      const p = args(assertion).path as string;
      const touched = ctx.diff.changedFiles.some((f) => f.path === p) || ctx.diff.untrackedFiles.includes(p);
      return { passed: !touched, detail: touched ? `${p} was modified` : null, evidenceSource: 'diff' };
    }
    case 'diff_ratio_max': {
      const a = args(assertion);
      const p = a.path as string;
      const maxRatio = a.ratio as number;
      const delta = ctx.diff.changedFiles.find((f) => f.path === p);
      const changedLines = delta ? delta.added + delta.removed : 0;
      let baseline: number;
      try {
        baseline = await baselineLineCount(ctx.sandboxPath, ctx.baselineCommit, p);
      } catch (err) {
        // A file the agent created outright (never present at the baseline
        // commit) is real, valid evidence for this assertion to fail on, not
        // a reason to crash the rest of scoreRun's assertion loop — every
        // other evidence read in this file (getNets/getSymbols/etc.) already
        // returns a tagged failure instead of throwing, for the same reason.
        return {
          passed: false,
          detail: `baseline for ${p} unreadable at ${ctx.baselineCommit}: ${(err as Error).message}`,
          evidenceSource: 'diff',
        };
      }
      const ratio = baseline === 0 ? (changedLines === 0 ? 0 : Number.POSITIVE_INFINITY) : changedLines / baseline;
      return {
        passed: ratio <= maxRatio,
        detail: `${changedLines} line(s) changed of ${baseline} baseline (ratio ${ratio.toFixed(4)}, max ${maxRatio})`,
        evidenceSource: 'diff',
      };
    }
    case 'commit_count': {
      const a = args(assertion);
      const n = ctx.diff.commitCount;
      const passed =
        a.equals !== undefined ? n === a.equals : n <= ((a.max as number | undefined) ?? Number.POSITIVE_INFINITY);
      return { passed, detail: `commit count ${n}`, evidenceSource: 'diff' };
    }
    case 'no_secret': {
      const touched = [...ctx.diff.changedFiles.map((f) => f.path), ...ctx.diff.untrackedFiles];
      const findings: string[] = [];
      for (const rel of touched) {
        let content: string;
        try {
          content = await readFile(path.join(ctx.sandboxPath, rel), 'utf8');
        } catch {
          continue; // deleted/binary/unreadable — can't leak a live secret onward
        }
        const hits = scanForSecrets(content);
        if (hits.length) findings.push(`${rel}: ${hits.join(',')}`);
      }
      return {
        passed: findings.length === 0,
        detail: findings.length ? findings.join('; ') : null,
        evidenceSource: 'diff',
      };
    }
    case 'exit_path_in': {
      const paths = args(assertion).paths as string[];
      const exitPath = exitPathOf(ctx.transcript);
      const passed = exitPath !== null && paths.includes(exitPath);
      return {
        passed,
        detail: `exit path: ${exitPath ?? '(none — no run-end event, e.g. a wall-clock kill)'}`,
        evidenceSource: 'transcript',
      };
    }
    case 'refusal_cites_budget': {
      const budgetKey = args(assertion).budgetKey as string;
      const exitPath = exitPathOf(ctx.transcript);
      if (exitPath !== 'refused') {
        return {
          passed: false,
          detail: `exit path is "${exitPath ?? 'none'}", not "refused"`,
          evidenceSource: 'transcript',
        };
      }
      const summary = refusalSummary(ctx.transcript) ?? '';
      const cited = summary.toLowerCase().includes(budgetKey.toLowerCase());
      return {
        passed: cited,
        detail: cited ? null : `refusal summary does not mention "${budgetKey}": ${summary}`,
        evidenceSource: 'transcript',
      };
    }
    default:
      throw new Error(
        `assertion type "${type}" is outside the closed vocabulary (STANDARD.md section 2.2) — this is a ` +
          'validation error, not a skip',
      );
  }
}
