// Validation refusal paths (tasks.md 2.10). Every case here is a way a suite
// can be wrong that must be caught *before* a run spends money, and every one
// is checked offline with no provider and no network.

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateSuite, type Finding } from '../scripts/validate.ts';
import { REPO, makeSuite, type Suite } from './helpers.ts';

let suite: Suite | undefined;

afterEach(() => {
  suite?.cleanup();
  suite = undefined;
});

function fresh(): Suite {
  suite = makeSuite();
  return suite;
}

/** Findings rendered as one searchable string, so a test asserts on meaning. */
function text(findings: Finding[]): string {
  return findings.map((f) => `${f.where}: ${f.what} ${(f.detail ?? []).join(' ')}`).join('\n');
}

describe('the committed suite', () => {
  it('validates clean', () => {
    const result = validateSuite(REPO);
    expect(text(result.findings)).toBe('');
    expect(result.ok).toBe(true);
  });

  it('reports the fixtures and tasks it checked', () => {
    const result = validateSuite(REPO);
    expect(result.fixtures).toBeGreaterThan(0);
    expect(result.tasks).toBeGreaterThan(0);
  });
});

describe('the synthetic baseline suite', () => {
  it('validates clean before any mutation', () => {
    const s = fresh();
    expect(text(validateSuite(s.root).findings)).toBe('');
  });
});

describe('closed assertion vocabulary', () => {
  it('rejects an unknown assertion type and names the vocabulary', () => {
    const s = fresh();
    s.patch('tasks/do-demo/assertions.json', (a) => {
      a[0].type = 'net_smells_right';
    });

    const out = text(validateSuite(s.root).findings);
    expect(out).toContain('tasks/do-demo');
    expect(out).toContain('assertion list does not satisfy its schema');
    // The author who mistyped a type needs to see what was allowed instead.
    expect(out).toContain('net_present');
  });

  it('rejects a task whose assertions are all optional', () => {
    const s = fresh();
    s.patch('tasks/do-demo/assertions.json', (a) => {
      a[0].required = false;
    });
    expect(text(validateSuite(s.root).findings)).toContain('cannot fail');
  });

  it('rejects duplicate assertion ids within a task', () => {
    const s = fresh();
    s.patch('tasks/do-demo/assertions.json', (a) => {
      a.push({ ...a[0], type: 'net_absent', args: { net: 'A' } });
    });
    expect(text(validateSuite(s.root).findings)).toContain('duplicate assertion id');
  });
});

describe('fixture pinning', () => {
  it('refuses a fixture whose tree does not hash to its recorded value', () => {
    const s = fresh();
    // Any byte change to tree/ invalidates the pin, which is the point.
    s.write('fixtures/demo-board/tree/demo.kicad_sch', '(kicad_sch (version 20231120))\n');

    const out = text(validateSuite(s.root).findings);
    expect(out).toContain('fixture tree hash does not match');
    expect(out).toContain('expected');
    expect(out).toContain('actual');
  });

  it('refuses a task whose recorded hash disagrees with the fixture manifest', () => {
    const s = fresh();
    s.patch('tasks/do-demo/task.json', (t) => {
      t.fixture.sha256 = 'b'.repeat(64);
    });
    expect(text(validateSuite(s.root).findings)).toContain('disagrees with the fixture manifest');
  });

  it('refuses a task pointing at a fixture that does not exist', () => {
    const s = fresh();
    s.patch('tasks/do-demo/task.json', (t) => {
      t.fixture.path = 'fixtures/no-such-board';
    });
    expect(text(validateSuite(s.root).findings)).toContain('does not name a known fixture');
  });
});

describe('fixture admissibility', () => {
  it('rejects a legacy KiCad schematic', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      f.artifacts.schematic = 'demo.sch';
    });
    expect(text(validateSuite(s.root).findings)).toContain('legacy KiCad schematic format');
  });

  it('rejects baseline errors that are not accounted for by type', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      f.baseline.drc.errors = 3;
      f.baseline.drc.errorTypes = { hole_clearance: 1 };
    });
    // D23: the enumeration is the allowlist. Under-counting it silently widens
    // what a run is permitted to introduce.
    expect(text(validateSuite(s.root).findings)).toContain('accounts for 1 of 3 errors');
  });

  it('rejects baseline errors with no enumeration at all', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      f.baseline.drc.errors = 2;
    });
    // The schema requires errorTypes whenever errors is non-zero.
    expect(text(validateSuite(s.root).findings)).toContain('does not satisfy its schema');
  });

  it('accepts baseline errors that are fully enumerated', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      f.baseline.drc.errors = 3;
      f.baseline.drc.errorTypes = { hole_clearance: 2, courtyards_overlap: 1 };
    });
    expect(text(validateSuite(s.root).findings)).toBe('');
  });

  it('rejects non-zero unconnected items', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      f.baseline.drc.unconnectedItems = 1;
    });
    expect(text(validateSuite(s.root).findings)).toContain('unconnectedItems is 1');
  });

  it('rejects structural parity issues but tolerates metadata drift', () => {
    const structural = fresh();
    structural.patch('fixtures/demo-board/fixture.json', (f) => {
      f.baseline.drc.schematicParity = 2;
      f.baseline.drc.schematicParityTypes = { duplicate_footprints: 2 };
    });
    expect(text(validateSuite(structural.root).findings)).toContain('structural parity issues');
    structural.cleanup();

    const metadata = fresh();
    metadata.patch('fixtures/demo-board/fixture.json', (f) => {
      f.baseline.drc.schematicParity = 2;
      f.baseline.drc.schematicParityTypes = { footprint_symbol_field_mismatch: 2 };
    });
    expect(text(validateSuite(metadata.root).findings)).toBe('');
  });

  it('rejects a reciprocally licensed design', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      f.upstream.license = 'GPL-3.0';
    });
    expect(text(validateSuite(s.root).findings)).toContain('does not satisfy its schema');
  });

  it('rejects a fixture with no NOTICE entry', () => {
    const s = fresh();
    writeFileSync(path.join(s.root, 'NOTICE'), 'nothing relevant here\n');
    expect(text(validateSuite(s.root).findings)).toContain('no NOTICE entry found');
  });

  it('rejects provenance pointing at a missing file', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      f.upstream.licenseFile = 'LICENSE.absent';
    });
    expect(text(validateSuite(s.root).findings)).toContain('points at a missing file');
  });

  it('rejects a moving upstream reference', () => {
    const s = fresh();
    s.patch('fixtures/demo-board/fixture.json', (f) => {
      // A tag or branch is not sufficient: both move.
      f.upstream.commit = 'v1.0.0';
    });
    expect(text(validateSuite(s.root).findings)).toContain('does not satisfy its schema');
  });
});

describe('task identity', () => {
  it('rejects a task id that does not match its directory', () => {
    const s = fresh();
    s.patch('tasks/do-demo/task.json', (t) => {
      t.id = 'do-something-else';
    });
    expect(text(validateSuite(s.root).findings)).toContain('does not match its directory name');
  });

  it('rejects a variantOf naming a task that does not exist', () => {
    const s = fresh();
    s.patch('tasks/do-demo/task.json', (t) => {
      t.variantOf = 'do-ghost';
    });
    expect(text(validateSuite(s.root).findings)).toContain('variantOf names a task that does not exist');
  });

  it('rejects a do-mode task with no prompt', () => {
    const s = fresh();
    s.patch('tasks/do-demo/task.json', (t) => {
      t.request = { briefPath: 'briefs/demo.md' };
    });
    expect(text(validateSuite(s.root).findings)).toContain('must declare request.prompt');
  });
});
