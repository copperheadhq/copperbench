// Adversarial test suite for pin_net_equals (STANDARD.md section 6, tasks.md 4.2).
//
// These tests verify that the pin_net_equals assertion handler accurately and
// deterministically evaluates pin-to-net connectivity, distinguishes wrong wiring
// from missing wiring, catches ambiguity, and refuses to produce false passes.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { evaluate, netNamesMatch, resolveNetMatch, type AssertionSpec } from '../scripts/lib/assertions.ts';
import { DiffEvidence, EndState, Transcript, type Evidence } from '../scripts/lib/evidence.ts';
import { buildRecord, writeRecord } from '../scripts/lib/record.ts';
import { scoreRun } from '../scripts/lib/score.ts';
import {
  exportNetlist,
  extractSchematicPins,
  kicadCliAvailable,
  parseNetlistSexp,
  type ParsedNetlist,
} from '../scripts/lib/verification.ts';
import { REPO } from './helpers.ts';

vi.setConfig({ testTimeout: 60_000 });

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length > 0) {
    const d = tmps.pop();
    if (d && existsSync(d)) {
      try {
        rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // ignore transient lock on Windows
      }
    }
  }
});

function tmp(prefix = 'copperbench-test-'): string {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}

function makeMockEvidence(opts: {
  netlist?: ParsedNetlist | undefined;
  kicadAvailable?: boolean | undefined;
  dir?: string | undefined;
  schematicPath?: string | undefined;
}): Evidence {
  const dir = opts.dir ?? tmp();
  const schPath = opts.schematicPath ?? 'test.kicad_sch';
  return {
    endState: new EndState(dir, schPath),
    diff: new DiffEvidence(dir, '0000000000000000000000000000000000000000'),
    transcript: new Transcript([]),
    baseline: {},
    kicadAvailable: opts.kicadAvailable ?? true,
    boardPath: null,
    netlist: opts.netlist,
  };
}

const SAMPLE_NETLIST = `(export (version "E")
  (components
    (comp (ref "U1") (value "ATmega328P") (footprint "Package_QFP:TQFP-32_7x7mm_P0.8mm"))
    (comp (ref "R1") (value "10k") (footprint "Resistor_SMD:R_0805"))
    (comp (ref "R2") (value "4k7") (footprint "Resistor_SMD:R_0805"))
    (comp (ref "C1") (value "100n") (footprint "Capacitor_SMD:C_0805"))
    (comp (ref "J1") (value "Conn_01x04") (footprint "Connector_PinHeader:PinHeader_1x04"))
  )
  (nets
    (net (code "1") (name "GND")
      (node (ref "U1") (pin "4"))
      (node (ref "R1") (pin "2"))
      (node (ref "C1") (pin "2"))
      (node (ref "J1") (pin "1"))
    )
    (net (code "2") (name "+5V")
      (node (ref "U1") (pin "20"))
      (node (ref "R2") (pin "1"))
      (node (ref "C1") (pin "1"))
      (node (ref "J1") (pin "2"))
    )
    (net (code "3") (name "SDA")
      (node (ref "U1") (pin "27") (pinfunction "ADC4/SDA") (pintype "bidirectional"))
      (node (ref "R2") (pin "2"))
      (node (ref "J1") (pin "3"))
    )
    (net (code "4") (name "/Sensors/SCL")
      (node (ref "U1") (pin "28") (pinfunction "ADC5/SCL") (pintype "bidirectional"))
      (node (ref "J1") (pin "4"))
    )
  )
)`;

describe('parseNetlistSexp parser', () => {
  it('parses components and nets from standard kicadsexpr text', () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    expect(nl.components.has('U1')).toBe(true);
    expect(nl.components.has('R1')).toBe(true);
    expect(nl.components.has('C1')).toBe(true);
    expect(nl.pinToNet.get('U1:27')).toBe('SDA');
    expect(nl.pinToNet.get('U1:4')).toBe('GND');
    expect(nl.pinToNet.get('R2:2')).toBe('SDA');
    expect(nl.componentPins.get('U1')?.has('27')).toBe(true);
  });

  it('handles empty or malformed netlist text gracefully without throwing', () => {
    const nlEmpty = parseNetlistSexp('');
    expect(nlEmpty.components.size).toBe(0);
    expect(nlEmpty.pinToNet.size).toBe(0);

    const nlGarbage = parseNetlistSexp('not an s-expression at all (');
    expect(nlGarbage.components.size).toBe(0);
  });

  it('flags ambiguous connectivity when the same pin appears on conflicting nets', () => {
    const ambiguousText = `(export (version "E")
      (components (comp (ref "U1")))
      (nets
        (net (code "1") (name "NET_A") (node (ref "U1") (pin "1")))
        (net (code "2") (name "NET_B") (node (ref "U1") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(ambiguousText);
    expect(nl.ambiguousPins.has('U1:1')).toBe(true);
    expect(nl.ambiguousPins.get('U1:1')).toEqual(['NET_A', 'NET_B']);
  });

  it('detects duplicate component reference designators', () => {
    const duplicateText = `(export (version "E")
      (components
        (comp (ref "R1"))
        (comp (ref "R1"))
      )
      (nets
        (net (code "1") (name "GND") (node (ref "R1") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(duplicateText);
    expect(nl.duplicateRefdes.has('R1')).toBe(true);
  });
});

describe('Group A: Correct connectivity', () => {
  it('passes when refdes, pin, and net match exactly', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });
    const spec: AssertionSpec = {
      id: 'sda-conn',
      type: 'pin_net_equals',
      args: { refdes: 'U1', pin: '27', net: 'SDA' },
      weight: 1,
      required: true,
    };
    const outcome = await evaluate(spec, ev);
    expect(outcome.status).toBe('pass');
    expect(outcome.detail).toContain('is connected to net SDA');
  });

  it('passes when multiple pins are connected to the same net', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const u1Gnd = await evaluate(
      { id: 'u1-gnd', type: 'pin_net_equals', args: { refdes: 'U1', pin: '4', net: 'GND' }, weight: 1, required: true },
      ev,
    );
    const r1Gnd = await evaluate(
      { id: 'r1-gnd', type: 'pin_net_equals', args: { refdes: 'R1', pin: '2', net: 'GND' }, weight: 1, required: true },
      ev,
    );
    const c1Gnd = await evaluate(
      { id: 'c1-gnd', type: 'pin_net_equals', args: { refdes: 'C1', pin: '2', net: 'GND' }, weight: 1, required: true },
      ev,
    );

    expect(u1Gnd.status).toBe('pass');
    expect(r1Gnd.status).toBe('pass');
    expect(c1Gnd.status).toBe('pass');
  });

  it('resolves canonical root-sheet net prefix', async () => {
    // In KiCad, root sheet local net 'DATA' is exported as '/DATA'
    const netlistText = `(export (version "E")
      (components (comp (ref "U1")))
      (nets (net (code "1") (name "/DATA") (node (ref "U1") (pin "1"))))
    )`;
    const nl = parseNetlistSexp(netlistText);
    const ev = makeMockEvidence({ netlist: nl });

    // Matching without leading slash
    const res1 = await evaluate(
      { id: 'test-1', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(res1.status).toBe('pass');

    // Matching with explicit leading slash
    const res2 = await evaluate(
      { id: 'test-2', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: '/DATA' }, weight: 1, required: true },
      ev,
    );
    expect(res2.status).toBe('pass');
  });

  it('resolves hierarchical sub-sheet nets when fully qualified', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const res = await evaluate(
      { id: 'scl-hier', type: 'pin_net_equals', args: { refdes: 'U1', pin: '28', net: '/Sensors/SCL' }, weight: 1, required: true },
      ev,
    );
    expect(res.status).toBe('pass');
  });

  it('yields stable verdicts across repeated identical evaluations', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });
    const spec: AssertionSpec = {
      id: 'sda-conn',
      type: 'pin_net_equals',
      args: { refdes: 'U1', pin: '27', net: 'SDA' },
      weight: 1,
      required: true,
    };

    const run1 = await evaluate(spec, ev);
    const run2 = await evaluate(spec, ev);
    const run3 = await evaluate(spec, ev);

    expect(run1.status).toBe('pass');
    expect(run2.status).toBe('pass');
    expect(run3.status).toBe('pass');
    expect(run1.detail).toBe(run2.detail);
    expect(run2.detail).toBe(run3.detail);
  });
});

describe('Group B: Wrong connectivity', () => {
  it('fails when component exists but requested pin does not', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '99', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('pin 99 not found on component U1');
  });

  it('fails when component is missing completely', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U99', pin: '1', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('component U99 not found in schematic');
  });

  it('fails when pin is connected to the wrong net', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    // U1 pin 4 is GND, but we assert it is +5V
    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '4', net: '+5V' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('is connected to net "GND", expected "+5V"');
  });

  it('fails when the expected net exists elsewhere but target pin is not on it', async () => {
    // SDA exists in design on U1 pin 27, but we query U1 pin 20 (which is +5V)
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '20', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('is connected to net "+5V", expected "SDA"');
  });

  it('fails when pins are swapped', async () => {
    const swappedNetlist = `(export (version "E")
      (components (comp (ref "U1")))
      (nets
        (net (code "1") (name "TX") (node (ref "U1") (pin "2")))
        (net (code "2") (name "RX") (node (ref "U1") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(swappedNetlist);
    const ev = makeMockEvidence({ netlist: nl });

    // We expected pin 1 to be TX
    const r1 = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'TX' }, weight: 1, required: true },
      ev,
    );
    expect(r1.status).toBe('fail');
    expect(r1.detail).toContain('is connected to net "RX", expected "TX"');
  });

  it('fails when pin is disconnected (exists on part but has no net)', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    // Add known pin 5 to U1 with no net attached
    nl.componentPins.get('U1')?.add('5');
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '5', net: 'GND' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('is not connected to any net (disconnected)');
  });
});

describe('Group C: Adversarial ambiguity', () => {
  it('does not accept prefix collisions as matching', async () => {
    const prefixNetlist = `(export (version "E")
      (components (comp (ref "U1")))
      (nets
        (net (code "1") (name "DATA_VALID") (node (ref "U1") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(prefixNetlist);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('is connected to net "DATA_VALID", expected "DATA"');
  });

  it('enforces case-sensitive net name matching', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '27', net: 'sda' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('is connected to net "SDA", expected "sda"');
  });

  it('enforces case-sensitive refdes matching', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'u1', pin: '27', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('component u1 not found');
  });

  it('does not conflate hierarchical sub-sheet nets with root-sheet query', async () => {
    // SAMPLE_NETLIST has /Sensors/SCL on U1:28
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '28', net: 'SCL' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('is connected to net "/Sensors/SCL", expected "SCL"');
  });

  it('fails on ambiguous pins appearing in multiple conflicting nets', async () => {
    const ambiguousText = `(export (version "E")
      (components (comp (ref "U1")))
      (nets
        (net (code "1") (name "NET_A") (node (ref "U1") (pin "1")))
        (net (code "2") (name "NET_B") (node (ref "U1") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(ambiguousText);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'NET_A' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('ambiguous connectivity');
  });

  it('fails on duplicate component reference designators', async () => {
    const duplicateText = `(export (version "E")
      (components
        (comp (ref "R1"))
        (comp (ref "R1"))
      )
      (nets
        (net (code "1") (name "GND") (node (ref "R1") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(duplicateText);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'R1', pin: '1', net: 'GND' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('ambiguous component');
  });

  it('resolves exact global net without leading slash', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '4', net: 'GND' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('pass');
  });

  it('resolves exact root-local net with leading slash', async () => {
    const netlistText = `(export (version "E")
      (components (comp (ref "U1")))
      (nets (net (code "1") (name "/DATA") (node (ref "U1") (pin "1"))))
    )`;
    const nl = parseNetlistSexp(netlistText);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: '/DATA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('pass');
  });

  it('bare-name root normalization resolves /DATA when no global DATA exists', async () => {
    const netlistText = `(export (version "E")
      (components (comp (ref "U1")))
      (nets
        (net (code "1") (name "/DATA") (node (ref "U1") (pin "1")))
        (net (code "2") (name "GND") (node (ref "U1") (pin "2")))
      )
    )`;
    const nl = parseNetlistSexp(netlistText);
    const ev = makeMockEvidence({ netlist: nl });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('pass');
  });

  it('fails closed on shorthand query when schematic contains distinct global and root-local nets of same name', async () => {
    const collisionNetlist = `(export (version "E")
      (components
        (comp (ref "U1"))
        (comp (ref "U2"))
      )
      (nets
        (net (code "1") (name "DATA") (node (ref "U1") (pin "1")))
        (net (code "2") (name "/DATA") (node (ref "U2") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(collisionNetlist);
    const ev = makeMockEvidence({ netlist: nl });

    // Query "DATA" directly matches the actual global net "DATA" without ambiguity
    const rGlobal = await evaluate(
      { id: 'test-global', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rGlobal.status).toBe('pass');
    expect(rGlobal.detail).toContain('is connected to net DATA');

    // But query "DATA" fallback-matching root-local "/DATA" fails closed because global "DATA" coexists
    const rRoot = await evaluate(
      { id: 'test-root', type: 'pin_net_equals', args: { refdes: 'U2', pin: '1', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rRoot.status).toBe('fail');
    expect(rRoot.detail).toContain('ambiguous net "DATA": schematic contains distinct electrical nets "DATA" and "/DATA"');

    // Explicitly qualified root-local "/DATA" resolves without ambiguity
    const rExplicit = await evaluate(
      { id: 'test-explicit', type: 'pin_net_equals', args: { refdes: 'U2', pin: '1', net: '/DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rExplicit.status).toBe('pass');
  });

  it('distinguishes identically named local nets in different hierarchical child sheets', async () => {
    const multiSheetNetlist = `(export (version "E")
      (components
        (comp (ref "U1"))
        (comp (ref "U2"))
      )
      (nets
        (net (code "1") (name "/Audio/DATA") (node (ref "U1") (pin "1")))
        (net (code "2") (name "/Sensors/DATA") (node (ref "U2") (pin "1")))
      )
    )`;
    const nl = parseNetlistSexp(multiSheetNetlist);
    const ev = makeMockEvidence({ netlist: nl });

    // Fully qualified paths match their respective pins
    const rAudio = await evaluate(
      { id: 'audio', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: '/Audio/DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rAudio.status).toBe('pass');

    const rSensors = await evaluate(
      { id: 'sensors', type: 'pin_net_equals', args: { refdes: 'U2', pin: '1', net: '/Sensors/DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rSensors.status).toBe('pass');

    // Cross-sheet query fails
    const rCross = await evaluate(
      { id: 'cross', type: 'pin_net_equals', args: { refdes: 'U2', pin: '1', net: '/Audio/DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rCross.status).toBe('fail');
    expect(rCross.detail).toContain('is connected to net "/Sensors/DATA", expected "/Audio/DATA"');

    // Bare shorthand does not match child-sheet nets
    const rBare = await evaluate(
      { id: 'bare', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rBare.status).toBe('fail');
    expect(rBare.detail).toContain('is connected to net "/Audio/DATA", expected "DATA"');
  });

  it('handles empty or malformed names safely without throwing exceptions', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const rEmptyNet = await evaluate(
      { id: 't1', type: 'pin_net_equals', args: { refdes: 'U1', pin: '27', net: '' }, weight: 1, required: true },
      ev,
    );
    expect(rEmptyNet.status).toBe('fail');

    const rEmptyPin = await evaluate(
      { id: 't2', type: 'pin_net_equals', args: { refdes: 'U1', pin: '', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(rEmptyPin.status).toBe('fail');

    const rEmptyRef = await evaluate(
      { id: 't3', type: 'pin_net_equals', args: { refdes: '', pin: '1', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(rEmptyRef.status).toBe('fail');

    // Empty net query must never match root net "/"
    const rootNetlist = `(export (version "E")
      (components (comp (ref "U1")))
      (nets (net (code "1") (name "/") (node (ref "U1") (pin "1"))))
    )`;
    const nlRoot = parseNetlistSexp(rootNetlist);
    const evRoot = makeMockEvidence({ netlist: nlRoot });
    const rEmptyAgainstSlash = await evaluate(
      { id: 't4', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: '' }, weight: 1, required: true },
      evRoot,
    );
    expect(rEmptyAgainstSlash.status).toBe('fail');
  });
});

describe('Group D: Evidence and environment failures', () => {
  it('returns unevaluable when kicad-cli is unavailable and no netlist is provided', async () => {
    const ev = makeMockEvidence({ kicadAvailable: false, netlist: undefined });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('unevaluable');
    expect(r.detail).toContain('requires kicad-cli');
  });

  it('fails when schematic export produces no netlist', async () => {
    // kicadAvailable is true, but schematic does not exist or export returns null
    const ev = makeMockEvidence({ kicadAvailable: true, netlist: undefined, schematicPath: 'nonexistent.kicad_sch' });

    const r = await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'SDA' }, weight: 1, required: true },
      ev,
    );
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('schematic could not be netlisted by kicad-cli');
  });
});

describe('Group E: Sandbox integrity', () => {
  it('leaves the graded sandbox byte-identical and without stray temporary files', async () => {
    const sandboxDir = tmp('copperbench-sandbox-');
    const schPath = path.join(sandboxDir, 'board.kicad_sch');
    writeFileSync(schPath, '(kicad_sch (version 20231120) (generator eeschema))\n');

    const filesBefore = readdirSync(sandboxDir).sort();

    const ev: Evidence = {
      endState: new EndState(sandboxDir, 'board.kicad_sch'),
      diff: new DiffEvidence(sandboxDir, '0000000000000000000000000000000000000000'),
      transcript: new Transcript([]),
      baseline: {},
      kicadAvailable: false,
      boardPath: null,
    };

    await evaluate(
      { id: 'test', type: 'pin_net_equals', args: { refdes: 'U1', pin: '1', net: 'SDA' }, weight: 1, required: true },
      ev,
    );

    const filesAfter = readdirSync(sandboxDir).sort();
    expect(filesAfter).toEqual(filesBefore);
    expect(existsSync(path.join(sandboxDir, '.kicad_prl'))).toBe(false);
  });
});

describe('Group G: Scoring integration', () => {
  it('causes scoreRun() to fail when a required pin_net_equals assertion fails', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const assertions: AssertionSpec[] = [
      { id: 'a1', type: 'pin_net_equals', args: { refdes: 'U1', pin: '27', net: 'SDA' }, weight: 1, required: true },
      { id: 'a2', type: 'pin_net_equals', args: { refdes: 'U1', pin: '4', net: 'WRONG' }, weight: 1, required: true },
    ];

    const outcomes = await Promise.all(assertions.map((a) => evaluate(a, ev)));
    const score = scoreRun(outcomes, ev);
    expect(score.verdict).toBe('fail');
    expect(score.firstFailedRequired).toBe('a2');
    expect(score.partialCredit).toBe(0.5);
  });

  it('causes scoreRun() to be unscoreable when a required pin_net_equals is unevaluable', async () => {
    const ev = makeMockEvidence({ kicadAvailable: false, netlist: undefined });

    const assertions: AssertionSpec[] = [
      { id: 'a1', type: 'pin_net_equals', args: { refdes: 'U1', pin: '27', net: 'SDA' }, weight: 1, required: true },
    ];

    const outcomes = await Promise.all(assertions.map((a) => evaluate(a, ev)));
    const score = scoreRun(outcomes, ev);
    expect(score.verdict).toBe('unscoreable');
  });

  it('allows overall pass when all required assertions pass and optional passes', async () => {
    const nl = parseNetlistSexp(SAMPLE_NETLIST);
    const ev = makeMockEvidence({ netlist: nl });

    const assertions: AssertionSpec[] = [
      { id: 'a1', type: 'pin_net_equals', args: { refdes: 'U1', pin: '27', net: 'SDA' }, weight: 2, required: true },
      { id: 'a2', type: 'pin_net_equals', args: { refdes: 'U1', pin: '4', net: 'GND' }, weight: 1, required: false },
    ];

    const outcomes = await Promise.all(assertions.map((a) => evaluate(a, ev)));
    const score = scoreRun(outcomes, ev);
    expect(score.verdict).toBe('pass');
    expect(score.partialCredit).toBe(1.0);
  });
});

describe('Real schematic pin extraction', () => {
  it('extracts pins from real fixture antmicro-microphone-board', () => {
    const schPath = path.join(
      REPO,
      'fixtures',
      'antmicro-microphone-board',
      'tree',
      'hardware',
      'microphone-board.kicad_sch',
    );
    if (!existsSync(schPath)) return;

    const schInfo = extractSchematicPins(schPath);
    expect(schInfo.componentPins.has('J1')).toBe(true);
    expect(schInfo.componentPins.get('J1')?.has('1')).toBe(true);
    expect(schInfo.componentPins.get('J1')?.has('MP')).toBe(true);
    expect(schInfo.componentPins.has('MK1')).toBe(true);
    expect(schInfo.componentPins.has('R1')).toBe(true);
    expect(schInfo.componentPins.get('R1')?.has('1')).toBe(true);
    expect(schInfo.componentPins.get('R1')?.has('2')).toBe(true);
  });

  it('resolves multi-level symbol inheritance (C extends B extends A) and order-independent pin definitions', () => {
    const dir = tmp('copperbench-sch-inherit-');
    const schPath = path.join(dir, 'test.kicad_sch');
    // Notice: symbol instance U1 appears BEFORE its lib_symbols definition in the sexp,
    // and symbol inheritance has C extending B, which extends A
    const schContent = `(kicad_sch (version 20231120) (generator eeschema)
      (symbol
        (lib_id "Lib:DerivedC")
        (at 100 100 0)
        (unit 1)
        (property "Reference" "U1")
      )
      (lib_symbols
        (symbol "Lib:DerivedC"
          (extends "Lib:DerivedB")
          (symbol "DerivedC_1_1" (pin input line (number "3")))
        )
        (symbol "Lib:DerivedB"
          (extends "Lib:BaseA")
          (symbol "DerivedB_1_1" (pin input line (number "2")))
        )
        (symbol "Lib:BaseA"
          (symbol "BaseA_1_1" (pin input line (number "1")))
        )
      )
    )`;
    writeFileSync(schPath, schContent);

    const schInfo = extractSchematicPins(schPath);
    expect(schInfo.componentPins.has('U1')).toBe(true);
    const u1Pins = schInfo.componentPins.get('U1')!;
    expect(u1Pins.has('1')).toBe(true); // From BaseA
    expect(u1Pins.has('2')).toBe(true); // From DerivedB
    expect(u1Pins.has('3')).toBe(true); // From DerivedC
  });
});

describe('Native KiCad integration', () => {
  it.skipIf(!kicadCliAvailable())('runs real kicad-cli exportNetlist and evaluates live connectivity on antmicro-microphone-board', async () => {
    const dir = tmp();
    cpSync(path.join(REPO, 'fixtures', 'antmicro-microphone-board', 'tree'), dir, { recursive: true });
    const schRel = 'hardware/microphone-board.kicad_sch';
    const ev: Evidence = {
      endState: new EndState(dir, schRel),
      diff: new DiffEvidence(dir, 'HEAD'),
      transcript: new Transcript([]),
      baseline: {},
      kicadAvailable: true,
      boardPath: null,
    };

    // J1 pin 5 connects to /DATA (matched by query "DATA")
    const rPass = await evaluate(
      { id: 't1', type: 'pin_net_equals', args: { refdes: 'J1', pin: '5', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rPass.status).toBe('pass');

    // J1 pin 5 connects to /DATA (matched by query "/DATA")
    const rPassSlash = await evaluate(
      { id: 't1s', type: 'pin_net_equals', args: { refdes: 'J1', pin: '5', net: '/DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rPassSlash.status).toBe('pass');

    // J1 pin 3 connects to /CLK, not DATA
    const rWrongPin = await evaluate(
      { id: 't2', type: 'pin_net_equals', args: { refdes: 'J1', pin: '3', net: 'DATA' }, weight: 1, required: true },
      ev,
    );
    expect(rWrongPin.status).toBe('fail');
    expect(rWrongPin.detail).toContain('CLK');

    // C1 pin 1 connects to GND
    const rGnd = await evaluate(
      { id: 't3', type: 'pin_net_equals', args: { refdes: 'C1', pin: '1', net: 'GND' }, weight: 1, required: true },
      ev,
    );
    expect(rGnd.status).toBe('pass');
  });

  it.skipIf(!kicadCliAvailable())('handles multi-unit symbols on complex 10-sheet fixture antmicro-jetson-orin-baseboard without false duplicateRefdes', async () => {
    const dir = tmp();
    cpSync(path.join(REPO, 'fixtures', 'antmicro-jetson-orin-baseboard', 'tree'), dir, { recursive: true });
    const schRel = 'jetson-orin-baseboard.kicad_sch';
    const ev: Evidence = {
      endState: new EndState(dir, schRel),
      diff: new DiffEvidence(dir, 'HEAD'),
      transcript: new Transcript([]),
      baseline: {},
      kicadAvailable: true,
      boardPath: null,
    };

    const nl = await ev.endState.netlist(true);
    expect(nl).toBeDefined();
    expect(nl!.components.size).toBeGreaterThan(600);
    expect(nl!.duplicateRefdes.size).toBe(0);
    // U6 is a multi-unit IC (TPS65988DHRSHR with 3 units)
    expect(nl!.components.has('U6')).toBe(true);
  });
});

describe('Phase 2: End-to-end grading, record serialization, and offline rescoring round trip', () => {
  it.skipIf(!kicadCliAvailable())(
    'completes full end-to-end grading, record serialization, and rescoring round trip on real fixture',
    async () => {
      // 1. Real KiCad schematic with known pin-to-net connection
      const sandboxDir = tmp('copperbench-rescore-sandbox-');
      cpSync(path.join(REPO, 'fixtures', 'antmicro-microphone-board', 'tree'), sandboxDir, { recursive: true });
      const schRel = 'hardware/microphone-board.kicad_sch';

      const filesBefore = readdirSync(sandboxDir).sort();

      // 2. Normal Copperbench scoring path evaluates pin_net_equals
      const ev: Evidence = {
        endState: new EndState(sandboxDir, schRel),
        diff: new DiffEvidence(sandboxDir, 'HEAD'),
        transcript: new Transcript([]),
        baseline: {},
        kicadAvailable: true,
        boardPath: null,
      };

      const assertions: AssertionSpec[] = [
        { id: 'j1-data-shorthand', type: 'pin_net_equals', args: { refdes: 'J1', pin: '5', net: 'DATA' }, weight: 1, required: true },
        { id: 'j1-data-qualified', type: 'pin_net_equals', args: { refdes: 'J1', pin: '5', net: '/DATA' }, weight: 1, required: true },
        { id: 'c1-gnd', type: 'pin_net_equals', args: { refdes: 'C1', pin: '1', net: 'GND' }, weight: 1, required: true },
      ];

      const outcomes = await Promise.all(assertions.map((a) => evaluate(a, ev)));
      const score = scoreRun(outcomes, ev);

      expect(score.verdict).toBe('pass');
      expect(score.partialCredit).toBe(1.0);
      expect(outcomes.every((o) => o.status === 'pass')).toBe(true);

      // 3. Serialized through the production result-record path
      const recInput = {
        taskId: 'synthetic-pin-net-task',
        tier: 'simple',
        mode: 'do',
        expectedOutcome: 'edit',
        model: 'harness:gold',
        repeat: 1,
        fixtureId: 'antmicro-microphone-board',
        fixtureSha256: '0'.repeat(64),
        taskManifestHash: '0'.repeat(64),
        baselineSha: '0'.repeat(40),
        runMode: 'gold',
        llmCache: false as const,
        setupSkipped: [],
        durationMs: 120,
        score,
      };
      const builtRecord = buildRecord(REPO, recInput);
      const resultsDir = tmp('copperbench-rescore-results-');
      writeRecord(resultsDir, builtRecord, 'run-1.json');

      // 4. Persisted evidence is reloaded using production offline rescoring path
      const persistedPath = path.join(resultsDir, 'run-1.json');
      expect(existsSync(persistedPath)).toBe(true);
      const persisted = JSON.parse(readFileSync(persistedPath, 'utf8')) as Record<string, any>;

      expect(persisted.schemaVersion).toBe('1.0.0');
      expect(persisted.suiteVersion).toBe('0.2.0');
      expect(persisted.verdict).toBe('pass');
      expect(persisted.assertions).toHaveLength(3);

      // 5. Re-scoring produces identical assertion verdict and diagnostic
      const rescoreEv: Evidence = {
        endState: new EndState(sandboxDir, schRel),
        diff: new DiffEvidence(sandboxDir, 'HEAD'),
        transcript: new Transcript([]),
        baseline: {},
        kicadAvailable: true,
        boardPath: null,
      };
      const rescoreOutcomes = await Promise.all(assertions.map((a) => evaluate(a, rescoreEv)));
      const rescoreScore = scoreRun(rescoreOutcomes, rescoreEv);

      const before = (persisted.assertions as any[]).map((o) => `${o.id}=${o.status}`).join(',');
      const after = rescoreScore.outcomes.map((o) => `${o.id}=${o.status}`).join(',');
      expect(after).toBe(before);
      expect(rescoreScore.verdict).toBe(persisted.verdict);
      expect(rescoreOutcomes[0]?.detail).toBe(persisted.assertions[0]?.detail);

      // 6. Deliberately modified, incorrect verdict is detected as drift
      const tamperedVerdict = { ...persisted, verdict: 'fail' };
      const verdictDrift = tamperedVerdict.verdict !== rescoreScore.verdict;
      expect(verdictDrift).toBe(true);

      const tamperedAssertions = (persisted.assertions as any[]).map((a, i) => (i === 0 ? { ...a, status: 'fail' } : a));
      const tamperedBefore = tamperedAssertions.map((o) => `${o.id}=${o.status}`).join(',');
      const assertionDrift = tamperedBefore !== after;
      expect(assertionDrift).toBe(true);

      // 7. Wrong-pin mutation produces a failing assertion
      const wrongPinSpec: AssertionSpec = {
        id: 'j1-wrong-pin',
        type: 'pin_net_equals',
        args: { refdes: 'J1', pin: '3', net: 'DATA' },
        weight: 1,
        required: true,
      };
      const wrongPinOutcome = await evaluate(wrongPinSpec, ev);
      expect(wrongPinOutcome.status).toBe('fail');
      expect(wrongPinOutcome.detail).toContain('is connected to net "/CLK", expected "DATA"');

      // 8. Original sandbox remains unchanged
      const filesAfter = readdirSync(sandboxDir).sort();
      expect(filesAfter).toEqual(filesBefore);
      expect(existsSync(path.join(sandboxDir, '.kicad_prl'))).toBe(false);
    },
  );
});
