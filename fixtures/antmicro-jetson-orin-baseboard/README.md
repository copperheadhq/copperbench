# Fixture: antmicro-jetson-orin-baseboard

A carrier board for the NVIDIA Jetson Orin system-on-module: a ten-sheet hierarchical design covering the SoM connectors, a multi-rail power tree, USB 2.0 and USB 3.0, gigabit Ethernet, HDMI, four-lane MIPI CSI camera inputs, M.2 sockets, and assorted peripherals.

This is the suite's hard-tier fixture.

## Attribution

Upstream: [antmicro/jetson-orin-baseboard](https://github.com/antmicro/jetson-orin-baseboard) at commit `34f0e7f5`, retrieved 2026-07-29.
Copyright (c) 2022-2026 [Antmicro](https://www.antmicro.com) per the upstream README, licensed Apache-2.0. The upstream license text is preserved verbatim in [LICENSE](LICENSE).

All ten schematic sheets, the board, the project file, the custom design rules (`.kicad_dru`), and the project `sym-lib-table` and `fp-lib-table` are copied unmodified. Documentation, rendered images, and `.kicad_prl` were not copied. No design file was altered.

The two lib tables are copied even though both are empty (`(version 7)` and nothing else), because an empty project library table is a meaningful state: it is *why* the design resolves its symbols from the embedded cache, and omitting the files would misrepresent the fixture.

## Why this board, and not Glasgow

[FIXTURES.md](../FIXTURES.md) named `GlasgowEmbedded/glasgow` revD0 as the lead hard-tier candidate and this board as the alternate. Measurement reversed that ordering.

| Candidate | Sheets | ERC errors | DRC errors | Unconnected | Parity |
| --- | --- | --- | --- | --- | --- |
| Glasgow revD0 | 11 | 26 | 1 | 0 | 0 |
| **Jetson Orin baseboard** | 10 | **0** | 6 | 0 | **0** |

Glasgow's 26 ERC errors (24 `power_pin_not_driven`, 2 `pin_to_pin`) are not a library-resolution artifact. The obvious hypothesis was that they came from the bare checkout, so the experiment was run: revD0 was re-measured with `Glasgow.kicad_sym` and `Glasgow.pretty` vendored alongside it and project-local lib tables pointing at them. The result was byte-identical — same 26 errors, same 741 warnings. Those errors are genuine design state that upstream tolerates.

Zero ERC errors matters more than six geometry DRC errors, because ERC is what a schematic edit task is graded on. This board also happens to be the more interesting subject: a SoM carrier with a real power tree and several high-speed interfaces in tension is exactly the shape the hard tier was defined for.

Glasgow remains an attractive future fixture, and under the recorded-allowlist rule it is now vendorable; its 26 errors would simply have to be enumerated. It is not rejected, only outranked.

## Baseline

Measured with `kicad-cli` 10.0.6:

| Check | Errors | Warnings | Detail |
| --- | --- | --- | --- |
| ERC | 0 | 1,751 | 1,066 `lib_symbol_issues`, 678 `footprint_link_issues`, 6 `same_local_global_label`, 1 `ground_pin_not_ground` |
| DRC | 6 | 226 | 4 `hole_clearance`, 1 `courtyards_overlap`, 1 `zones_intersect`; 199 `lib_footprint_issues`, 14 `silk_over_copper`, 10 `silk_overlap`, 3 `silk_edge_clearance` |
| Unconnected | 0 | | |
| Parity | 0 | | |

Zero ERC errors, zero unconnected items and zero parity issues across ten hierarchical sheets is the best result of any hard-tier candidate vetted, and better than most simple-tier ones.

The six DRC errors are all geometry rules KiCad tightened after this board was laid out under KiCad 8: four `hole_clearance` (a hole closer to another feature than the 0.16 mm board-setup constraint allows), one `courtyards_overlap`, one `zones_intersect`. They are enumerated in `fixture.json` as the recorded allowlist, so `drc_no_new_violations` still fails on any error type that appears at run time but is absent there, or that exceeds its recorded count.

The 1,751 ERC warnings are the ordinary bare-checkout condition at this scale: the design references Antmicro's vendor symbol and footprint libraries, and its own project lib tables are empty. All but one are library resolution; the lone `ground_pin_not_ground` appeared when the reference CLI moved from 10.0.4 to 10.0.6, and is a warning rather than an error, so it changes nothing a task is graded on.

## Scale, and what it does to a surgicality bound

This fixture is two orders of magnitude larger than the simple tier, and the arithmetic is what makes a stated diff bound meaningful or meaningless.

| Sheet | Lines |
| --- | --- |
| `usb.kicad_sch` | 67,406 |
| `supply.kicad_sch` | 53,202 |
| `som.kicad_sch` | 45,043 |
| `peripherals.kicad_sch` | 39,797 |
| `csi.kicad_sch` | 31,290 |
| `m-2.kicad_sch` | 31,153 |
| `jetson-orin-baseboard.kicad_sch` (root) | 26,553 |
| `usb3.kicad_sch` | 25,875 |
| `hdmi.kicad_sch` | 23,289 |
| `ethernet.kicad_sch` | 20,408 |
| **Total** | **364,016** |

The board is 1,799,902 lines.

**A `diff_ratio_max` on this fixture must name the sheet it constrains.** Five percent of the whole schematic set is 18,200 lines, which is not a constraint at all — it is permission to rewrite four sheets. Even 1 percent, the figure that works on the microphone board, is 3,640 lines here. A task that renames a net inside `ethernet.kicad_sch` should be bounded against that file's 20,408 lines, at a ratio sized to roughly ten times a correct minimal edit, and should say so in its README. This is the fixture that makes the per-task calibration rule in [FIXTURES.md](../FIXTURES.md) section 6 non-negotiable rather than advisory.

The hierarchy is also the point. Ten sheets is enough for partial propagation to be a distinguishable failure mode: an agent that renames a net on `supply.kicad_sch` and does not carry it to the sheet pins on the root is doing something visibly different from doing the work correctly, which is precisely what a single-sheet fixture cannot show.

## A note on size

The tree is 44 MB, of which 36 MB is the board file. It is copied into a fresh sandbox for every (task, model, repeat), so a 3-repeat run of one task across eight models copies roughly 1 GB. That is a real cost and it is the largest fixture the suite should acquire without first measuring sandbox materialization time; a hard-tier fixture is worth it once, but a second one at this size would want justification. Tasks that only need the schematic still pay for the board, because the sandbox is the whole tree.

## Verifying this fixture

```bash
node scripts/hash-fixture.mjs --check fixtures/antmicro-jetson-orin-baseboard
```

## Regenerating the baseline reports

Only when the reference `kicad-cli` version changes, and the new counts belong in `fixture.json` in the same commit. `kicad-cli` writes a `.kicad_prl` next to the project as a side effect; delete it before rehashing, or the tree hash will change:

```bash
cd fixtures/antmicro-jetson-orin-baseboard/tree
kicad-cli sch erc --format json -o ../baseline/erc.json jetson-orin-baseboard.kicad_sch
kicad-cli pcb drc --format json --schematic-parity -o ../baseline/drc.json jetson-orin-baseboard.kicad_pcb
rm -f jetson-orin-baseboard.kicad_prl
```
