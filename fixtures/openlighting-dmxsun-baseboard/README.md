# Fixture: openlighting-dmxsun-baseboard

The 2-slot baseboard of dmxsun, an RP2040-based DMX512 lighting controller: a Raspberry Pi Pico, a WIZnet W5500 Ethernet module, an nRF24 radio, and two edge-connector slots that accept isolated or unisolated DMX I/O daughterboards.

## Attribution

Upstream: [OpenLightingProject/rp2040-dmxsun](https://github.com/OpenLightingProject/rp2040-dmxsun) at commit `f3b1749c`, retrieved 2026-07-29.
Attributed to the [Open Lighting Project](https://www.openlighting.org/), which is named as the company in the schematic title block. The upstream README licenses "source code, schematics and board layouts" under Apache-2.0, which is explicit that the hardware and not merely the firmware is covered; the license text is preserved verbatim in [LICENSE](LICENSE). Upstream states no explicit copyright line and leaves the license appendix unfilled.

Design files are copied unmodified. The upstream `hardware/` layout is preserved rather than flattened, because the project's `sym-lib-table` and `fp-lib-table` resolve through `${KIPRJMOD}/../symbols` and `${KIPRJMOD}/../footprints`; flattening would silently break library resolution and change the baseline. Only the two symbol libraries and two footprint libraries those tables actually name were copied. The five sibling board variants, the unreferenced `NC3FD-H.pretty` and `RJ45_Sparkfun.pretty`, the legacy `.dcm` descriptions, firmware, documentation, and `.kicad_prl` were not.

## Why this board

Two reasons, one about the design and one about the suite.

The design is a real, manufactured lighting controller from a project that ships them, and it is small enough to hold in one head: 45 components on one sheet, 48 nets, three power nets. That is the same virtue the microphone board has, at roughly twice the size.

The suite reason is origin diversity. Before this fixture, every board in copperbench came from Antmicro, which means the benchmark measured how well models handle one organization's conventions. The Open Lighting Project is a different culture entirely: hobbyist-adjacent, community-maintained, and it shows in the files. This board carries a stale `baseboard_4slots-rescue:` `lib_id` left over from a KiCad rescue operation, referencing a library that does not exist upstream and resolving from the embedded symbol cache. Antmicro's boards do not look like that. Most of the world's KiCad projects do.

## Baseline

Measured with `kicad-cli` 10.0.4:

| Check | Errors | Warnings | Detail |
| --- | --- | --- | --- |
| ERC | 0 | 182 | 109 `lib_symbol_issues`, 72 `endpoint_off_grid`, 1 `footprint_link_issues` |
| DRC | 1 | 31 | 1 `courtyards_overlap`; 30 `lib_footprint_mismatch`, 1 `lib_footprint_issues` |
| Unconnected | 0 | | |
| Parity | 1 | | 1 `footprint_symbol_mismatch` |

This is the cleanest baseline of every candidate vetted for this suite apart from the microphone board itself.

The single DRC error deserves an account, because a non-zero error count is now permitted only when every error is enumerated and explained ([FIXTURES.md](../FIXTURES.md) section 5). It is one `courtyards_overlap`: two component courtyards intersecting. The board was laid out under KiCad 8 and is being checked by KiCad 10, whose courtyard evaluation is stricter, and this project's `.kicad_pro` leaves `courtyards_overlap` at error severity rather than downgrading it as some projects do. It is recorded in `fixture.json` as the DRC allowlist, so `drc_no_new_violations` still fails on anything an agent adds.

## Scale, and what it does to a surgicality bound

The schematic is 15,122 lines and the board is 37,794. A minimal correct net rename on this schematic touches on the order of ten to twenty lines, so a bound near 1 percent (roughly 150 lines) is generous by an order of magnitude and still far below what regenerating the sheet would cost. Do not inherit AC-3.7's nominal 5 percent, which here would permit 756 lines.

## Verifying this fixture

```bash
node scripts/hash-fixture.mjs --check fixtures/openlighting-dmxsun-baseboard
```

## Regenerating the baseline reports

Only when the reference `kicad-cli` version changes, and the new counts belong in `fixture.json` in the same commit. Note that `kicad-cli` writes a `.kicad_prl` next to the project as a side effect; delete it before rehashing, or the tree hash will change:

```bash
cd fixtures/openlighting-dmxsun-baseboard/tree/hardware/baseboard_2slots
kicad-cli sch erc --format json -o ../../../baseline/erc.json baseboard_2slots.kicad_sch
kicad-cli pcb drc --format json --schematic-parity -o ../../../baseline/drc.json baseboard_2slots.kicad_pcb
rm -f baseboard_2slots.kicad_prl
```
