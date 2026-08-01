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
