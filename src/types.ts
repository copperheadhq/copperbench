/**
 * Minimal task-manifest shape, kept in lockstep with schema/task.schema.json.
 * Grown field-by-field as the runner and scorer come to need them — see
 * openspec/changes/add-model-benchmark-suite/tasks.md sections 3 and 4.
 */
export interface TaskManifest {
  id: string;
  tier: 'simple' | 'medium' | 'hard';
  mode: 'do' | 'create' | 'sync' | 'check';
  fixture: { path: string; sha256: string };
  request: { prompt?: string; briefPath?: string };
  expectedOutcome: 'edit' | 'refusal' | 'flag';
  config?: {
    budgets?: Record<string, number>;
    maxTurns?: number;
    maxRepairCycles?: number;
    stageMaxTurns?: Record<string, number>;
  };
  setup?: { commands: string[] };
  caps: { turns: number; wallClockSec: number };
  repeats?: number;
  tags: string[];
  variantOf?: string;
  rubric?: string;
}

/**
 * Assertion manifest entry, kept in lockstep with schema/assertions.schema.json.
 * `args` is typed loosely (per-type shape is enforced by the schema, not
 * re-validated here) since the scorer dispatches on `type` and reads only
 * the fields that type declares.
 */
export interface AssertionManifest {
  id: string;
  type: string;
  args?: Record<string, unknown>;
  weight: number;
  required: boolean;
  note?: string;
}

/**
 * Minimal fixture-manifest shape, kept in lockstep with schema/fixture.schema.json.
 * Only the fields the scorer actually reads (paths and baseline violation
 * counts for the baseline-relative ERC/DRC assertions).
 */
export interface FixtureManifest {
  id: string;
  artifacts: { schematic: string; board: string | null; project?: string | null };
  baseline: {
    erc: {
      errors: number;
      errorTypes?: Record<string, number>;
      warnings: number;
      warningTypes?: Record<string, number>;
    };
    drc?: {
      errors: number;
      errorTypes?: Record<string, number>;
      warnings: number;
      warningTypes?: Record<string, number>;
      unconnectedItems: number;
      schematicParity: number;
      schematicParityTypes?: Record<string, number>;
    };
  };
}

/**
 * One append-only result record, kept in lockstep with
 * schema/result.schema.json. `rubric` (the fenced, off-by-default
 * model-judged tier, STANDARD.md section 12) is out of scope for this pass
 * and always omitted.
 */
export interface ResultRecord {
  schemaVersion: string;
  suiteVersion: string;
  task: {
    id: string;
    tier: 'simple' | 'medium' | 'hard';
    mode: 'do' | 'create' | 'sync' | 'check';
    expectedOutcome: 'edit' | 'refusal' | 'flag';
    manifestSha256: string;
    fixtureSha256: string;
    variantOf: string | null;
    tags: string[];
  };
  model: {
    id: string;
    provider: string;
    selectionSource: 'flag' | 'env' | 'config' | 'openai-key' | 'anthropic-key' | 'picker';
    segment: 'api-frontier' | 'api-cheap' | 'open-weight-hosted' | 'open-weight-self-hosted' | 'saved-login';
    pinning: 'strong' | 'weak';
  };
  environment: {
    copperheadVersion: string;
    copperheadCommit: string;
    kicadCliVersion: string | null;
    node: string;
    platform: string;
  };
  run: {
    repeatIndex: number;
    repeatsPlanned: number;
    startedAt: string;
    baselineCommit: string;
    llmCacheDisabled: true;
    allowDirty: false;
  };
  assertions: {
    id: string;
    type: string;
    required: boolean;
    weight: number;
    passed: boolean;
    evidenceSource: 'end-state' | 'diff' | 'transcript';
    detail: string | null;
  }[];
  verdict: { pass: boolean; partialCredit: number };
  stats: {
    exitPath:
      | 'done'
      | 'refused'
      | 'turn-budget-exhausted'
      | 'repair-cycles-exhausted'
      | 'commit-failed'
      | 'provider-error'
      | 'session-limit'
      | 'stalled'
      | 'cap-exceeded';
    turnsUsed: number;
    maxTurns: number;
    repairCyclesUsed: number;
    maxRepairCycles: number;
    tokensIn: number;
    tokensOut: number;
    durationMs: number;
    filesTouched?: string[];
  };
  cost: { usd: number | null; priceTableVersion: string | null };
  failure: {
    category:
      | 'tool-protocol'
      | 'file-revert'
      | 'turn-budget'
      | 'repair-exhausted'
      | 'obligation-open'
      | 'drift-left'
      | 'constraint-violation'
      | 'false-refusal'
      | 'stalled'
      | 'commit-failed'
      | 'wrong-target';
    firstFailedAssertion: string | null;
    dominantToolError: string | null;
  } | null;
  artifacts: {
    transcriptPath: string;
    sandboxPreserved: boolean;
    sandboxPath: string | null;
  };
}
