# Fixture: antmicro-microphone-board

A PDM microphone breakout: a Knowles SPH0644LM4H-1 microphone routed to a zero-insertion-force connector, with supply filtering and ESD protection.

## Attribution

Upstream: [antmicro/pdm-microphone-board](https://github.com/antmicro/pdm-microphone-board) at commit `20813e2b`, retrieved 2026-07-28.
Copyright (c) 2024-2025 [Antmicro](https://www.antmicro.com), licensed Apache-2.0. The upstream license text is preserved verbatim in [LICENSE](LICENSE).

Design files under `tree/hardware/` are copied unmodified. Repository assets, documentation PDFs, CI configuration, and the local `.kicad_prl` state file were not copied. No design file was altered in any way.

## Why this board

It is a real board that was designed to be manufactured, by people who do this professionally, and it is small enough to reason about completely. Twelve components, one sheet, three signal nets, three power nets. The upstream project is Apache-2.0, which is the same license this repository uses, so vendoring carries no license friction at all.

It is deliberately not impressive. A fixture's job is to make agent behavior legible, and a board an author can hold entirely in their head is what makes an unexpected diff obviously unexpected.

## What it establishes about real fixtures

Running verification on it at baseline, with `kicad-cli` 10.0.4:

| Check | Errors | Warnings | Detail |
| --- | --- | --- | --- |
| ERC | 0 | 44 | 32 `lib_symbol_issues`, 12 `footprint_link_issues` |
| DRC | 0 | 13 | 13 `lib_footprint_issues`, 0 unconnected, 0 parity |

Every one of those 57 warnings is library resolution: the design references upstream `antmicro-footprints` and `antmicro-symbols` libraries that are not vendored here. Nothing electrical is outstanding, and the two checks that matter most for an edit task, unconnected items and schematic-to-board parity, are both zero.

This is the normal condition of a real design in a bare checkout, and it is why tasks on this fixture assert `erc_no_new_violations` rather than `erc_clean`. See [FIXTURES.md](../FIXTURES.md) for the rule and the reasoning.

## Scale, and what it does to a surgicality bound

The schematic is 8,489 lines; the board is 35,688. For comparison, a synthetic fixture is a few hundred lines total.

That difference is not cosmetic. AC-3.7's 5 percent diff bound was calibrated against a small hand-written schematic, where 5 percent is roughly fourteen lines and therefore a real constraint. Five percent of this schematic is 424 lines, which is enough to rewrite entire subsystems while still passing. Tasks here use a bound near 1 percent, and the general rule now stated in [FIXTURES.md](../FIXTURES.md) is that a surgicality bound is calibrated per task against the file it constrains, not inherited as a constant.

## Verifying this fixture

```bash
node scripts/hash-fixture.mjs --check fixtures/antmicro-microphone-board
```

## Regenerating the baseline reports

Only when the reference `kicad-cli` version changes, and the new counts belong in `fixture.json` in the same commit:

```bash
cd fixtures/antmicro-microphone-board/tree/hardware
kicad-cli sch erc --format json -o ../../baseline/erc.json microphone-board.kicad_sch
kicad-cli pcb drc --format json -o ../../baseline/drc.json microphone-board.kicad_pcb
```
