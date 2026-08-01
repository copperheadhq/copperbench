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
