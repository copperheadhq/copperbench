# Fixture: zhiayang-mikoto

An nRF52840 module in a Pro Micro footprint: SoC, 2.4 GHz meander antenna and matching network, USB-C with CC resistors, a lithium charger with battery-management I2C, and regulated rails.

## Attribution

Upstream: [zhiayang/mikoto](https://github.com/zhiayang/mikoto) at commit `86318f6c`, retrieved 2026-07-29.
Authored by [zhiayang](https://github.com/zhiayang), licensed Apache-2.0. The upstream license text is preserved verbatim in [LICENSE](LICENSE). Note that upstream declares Apache-2.0 in its README but states no explicit copyright line and leaves the license appendix's `Copyright [yyyy] [name of copyright owner]` unfilled, so the attribution recorded here is to the repository author rather than to a stated copyright holder.

Design files are copied unmodified from the upstream repository root, together with the project `sym-lib-table` and `fp-lib-table` and the two libraries they name: `lib/mikoto.kicad_sym` and `footprints.pretty`. `empty.kicad_wks` is included because the project file names it as the page layout.

Two things were deliberately not copied. `footprints.pretty/3d/` holds 388 KB of STEP models, which are rendering assets: they do not participate in ERC, DRC, or parity, and they would be copied into every sandbox for every repeat of every task. The separate `flashbed/` board is a different design and would be a different fixture. `misc/`, `pins.txt`, `CHANGELOG.md`, and `.kicad_prl` were also excluded. No design file was altered.

## Why this board

It is the first fixture in copperbench designed by an individual rather than an organization, and that is the point of including it.

Antmicro's boards are house-style: consistent net naming, vendor libraries, a design review behind them. The Open Lighting Project's board is community-maintained. This one is one person's work, and it carries the marks — 193 off-grid wire endpoints, a symbol library with a `.bak` file next to it upstream, board and schematic metadata that have drifted apart in 84 places. None of that makes it a bad design; it is a real, working, manufactured RF module with a matched antenna. It makes it a *representative* design, and a benchmark drawn only from organizationally-produced boards would never test an agent against it.

It also sits at a useful scale. At 67 components on one sheet it is five times the microphone board and still comprehensible, which is what the medium tier is for even though it is single-sheet rather than hierarchical.

## Baseline

Measured with `kicad-cli` 10.0.6:

| Check | Errors | Warnings | Detail |
| --- | --- | --- | --- |
| ERC | 0 | 295 | 102 `lib_symbol_issues`, 193 `endpoint_off_grid` |
| DRC | 1 | 2 | 1 `zones_intersect`; 2 `lib_footprint_mismatch` |
| Unconnected | 0 | | |
| Parity | 84 | | 65 `footprint_symbol_field_mismatch`, 19 `footprint_symbol_mismatch` |

The one DRC error is `zones_intersect`: two copper zones overlapping without distinct priorities. KiCad 10 rules on this more strictly than the KiCad 8 the board was laid out in. It is enumerated in `fixture.json` as the DRC allowlist.

The 84 parity issues need a clearer account, because parity is normally the check an edit task most depends on. Every one of them is **metadata, not electrical**: `footprint_symbol_field_mismatch` is a `Description` or `LCSC Part` field differing between the board and the schematic, and the `footprint_symbol_mismatch` entries here are attribute flags such as *Do not populate*. No footprint is missing, none is duplicated, and no net differs. The netlist parity that a bad edit actually breaks is intact, and because `drc_no_new_violations` compares against this record by type and count, an agent that breaks real parity still fails.

The 193 `endpoint_off_grid` warnings are worth keeping rather than regretting. They are a fingerprint of the existing geometry, so an agent that reflows or regenerates the sheet instead of making a surgical edit will move that count and be caught by it.

## Scale, and what it does to a surgicality bound

The schematic is 19,991 lines; the board is 26,468. A minimal correct edit here — renaming a net, adding a decoupling capacitor — is on the order of ten to thirty lines. A bound near 1 percent is roughly 200 lines: an order of magnitude of headroom for a clumsy-but-correct run, and still nowhere near the cost of regenerating a 67-component sheet. AC-3.7's nominal 5 percent would permit 1,000 lines and is not a constraint at this scale.

## Verifying this fixture

```bash
node scripts/hash-fixture.mjs --check fixtures/zhiayang-mikoto
```

## Regenerating the baseline reports

Only when the reference `kicad-cli` version changes, and the new counts belong in `fixture.json` in the same commit. `kicad-cli` writes a `.kicad_prl` next to the project as a side effect; delete it before rehashing, or the tree hash will change:

```bash
cd fixtures/zhiayang-mikoto/tree
kicad-cli sch erc --format json -o ../baseline/erc.json mikoto.kicad_sch
kicad-cli pcb drc --format json --schematic-parity -o ../baseline/drc.json mikoto.kicad_pcb
rm -f mikoto.kicad_prl
```
