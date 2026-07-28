# Fixture standard

**Normative for everything under `fixtures/`.** Companion to [STANDARD.md](../STANDARD.md), which defines how tasks are graded; this defines what they are graded against.

A fixture is the starting state of a benchmark task: a real KiCad project, frozen, content-hashed, and copied into a fresh sandbox for every run.

## 1. Why fixtures must be real boards

A synthetic fixture measures whether a model can edit a file that looks like a schematic. A real board measures whether it can edit a schematic, and the two diverge in ways that are invisible until you try it.

- **Scale changes what a bound means.** A hand-written fixture is a few hundred lines. A real single-sheet board is several thousand, and a real multi-sheet design is tens of thousands. A diff bound stated as a fraction is a different constraint at each scale.
- **Real boards carry baseline violations.** Not because they are bad, but because a bare checkout cannot resolve the project's libraries. A `erc_clean` assertion is unachievable on a real fixture and would make every task fail for reasons unrelated to the model.
- **Real boards have real component libraries, footprints, and conventions.** Vendor-specific symbol libraries, custom design rules, hierarchical sheets, net-class assignments. A model that only ever meets a toy fixture is never tested against the thing it will actually be pointed at.
- **Toy fixtures flatter everyone.** The failure modes that matter, partial propagation across sheets and wholesale regeneration, need enough surrounding material to be distinguishable from doing the work correctly.

## 2. Selection criteria

A candidate must satisfy all of the following.

| Requirement | Why |
| --- | --- |
| **Permissively licensed** | Section 3. Non-negotiable. |
| **Modern KiCad format** | `.kicad_sch` s-expressions, file format version 20211014 or later. Legacy `.sch` files are rejected: `kicad-cli` will not process them and converting one makes the fixture a derivative we would have to maintain. |
| **Loads and verifies under the reference `kicad-cli`** | A fixture whose ERC or DRC cannot run is not gradable. |
| **Zero baseline ERC and DRC *errors*** | Warnings are expected and recorded (section 5). Errors are not: a pre-existing error is indistinguishable from one the agent introduced. |
| **Zero baseline unconnected items and schematic-parity issues** | These are the checks an edit task most needs to be clean, because they are what a bad edit breaks. |
| **Designed to be manufactured** | Someone intended to build it. Reference designs, evaluation boards, and shipped products qualify; sketches do not. |
| **Comprehensible at its tier** | A `simple` fixture must be holdable in one head. A `hard` fixture need not be, but its tasks must still target a comprehensible subsystem of it. |
| **Stable upstream** | A tagged release or a long-lived commit on a maintained repository. We pin a commit regardless, but a dead upstream makes provenance unverifiable for readers. |

## 3. License policy

Fixtures are redistributed in this repository, so licensing is a hard gate rather than a courtesy.

**Permitted, vendored directly:** Apache-2.0, MIT, BSD-2/3-Clause, CERN-OHL-P-2.0, CC0, Unlicense. Prefer Apache-2.0: it matches this repository's own license, so there is no interaction to reason about.

**Permitted with care, and only with a documented rationale:** CC-BY-4.0 and CERN-OHL-W. Attribution and notice obligations are heavier, and a reciprocal license can reach further than intended when an agent's output is published as evidence.

**Not vendored:** CC-BY-SA, CERN-OHL-S, GPL-family, and anything with a non-commercial or no-derivatives clause. Not because such designs are worse, but because a benchmark that publishes agent-modified derivatives of a reciprocally licensed board creates an obligation we would have to track per artifact, forever, for no measurement benefit.

**Every vendored fixture must carry**, in its fixture directory:

1. The upstream `LICENSE` file, verbatim and unmodified.
2. An entry in [NOTICE](../../NOTICE) at the repository root naming the project, copyright holder, license, and upstream URL.
3. A `README.md` stating upstream URL, pinned commit, retrieval date, copyright line, and exactly what was and was not copied.
4. A `modifications` field in `fixture.json` describing any change to a design file. The strongly preferred value is that no design file was altered.

## 4. Directory layout

```
fixtures/<fixture-id>/
  fixture.json       # provenance, scale, baseline counts, tree hash
  LICENSE            # upstream license, verbatim
  README.md          # attribution, rationale, what it establishes
  baseline/
    erc.json         # baseline ERC report from the reference kicad-cli
    drc.json         # baseline DRC report
  tree/              # THE ONLY THING COPIED INTO A SANDBOX
    hardware/*.kicad_*
```

Only `tree/` is copied into a sandbox and only `tree/` is hashed. Provenance, license, and baseline reports are metadata about the fixture, not part of the project an agent sees. Keeping them outside `tree/` means an agent cannot read the baseline report and cannot mistake our bookkeeping for the design's own documents.

## 5. Baseline verification, and why `erc_clean` is the wrong assertion

The measured baseline of the first real fixture in this suite, a professionally designed, shipped, Apache-2.0 board:

| Check | Errors | Warnings |
| --- | --- | --- |
| ERC | 0 | 44 |
| DRC | 0 | 13 |

All 57 warnings are library resolution: the design references vendor symbol and footprint libraries that are not vendored with it. This is the ordinary condition of any real design in a bare checkout, and it will be true of essentially every fixture we add.

Therefore:

- **Every fixture records its baseline reports** under `baseline/`, generated by the reference `kicad-cli`, with counts summarized in `fixture.json`.
- **Tasks on real fixtures assert `erc_no_new_violations` and `drc_no_new_violations`**, which compare the post-run report against the recorded baseline and pass when no violation appears that was not already there. Both accept a `severity` argument, defaulting to `error` and above.
- **`erc_clean` and `drc_clean` remain in the vocabulary** for synthetic fixtures and for a fixture whose libraries are fully vendored, where a clean report is genuinely achievable.
- **Baselines are regenerated only when the reference `kicad-cli` version changes**, and the new counts land in `fixture.json` in the same commit. A silent baseline drift would let an agent-introduced violation hide inside an updated expectation, which is precisely the failure this machinery exists to prevent.

## 6. Scale, and calibrating a surgicality bound

Fixture scale is recorded in `fixture.json` so that a task author sets a diff bound against a known denominator.

AC-3.7 states surgicality as 5 percent of a file's lines. That figure was calibrated against a small synthetic schematic where 5 percent is roughly fourteen lines. On an 8,489-line real schematic, 5 percent is 424 lines: enough to rewrite whole subsystems and still pass.

**A surgicality bound is calibrated per task against the file it constrains, not inherited as a constant.** The rule of thumb: bound at roughly ten times the size of a correct minimal edit, so that a correct-but-inelegant run passes and a regenerating run cannot. State the reasoning in the task's README.

## 7. Preparation procedure

1. **Vet the license** against section 3 before anything else. If it does not pass, stop; a good board with the wrong license is not a candidate.
2. **Clone at a pinned commit** and record the full SHA.
3. **Copy only design files** into `tree/`: `.kicad_sch`, `.kicad_pcb`, `.kicad_pro`, `.kicad_dru`, and any vendored library the project needs to resolve. Do not copy `.kicad_prl` (local editor state), CI configuration, rendered assets, or documentation PDFs. They inflate the sandbox copy for every run of every repeat and none of them affect grading.
4. **Run the reference `kicad-cli`** for ERC and DRC, write the reports to `baseline/`, and confirm zero errors, zero unconnected items, and zero parity issues. If any is non-zero, reject the candidate or vendor the missing libraries and re-measure.
5. **Hash the tree** with `node scripts/hash-fixture.mjs fixtures/<id>/tree`.
6. **Write `fixture.json`** against [schema/fixture.schema.json](../schema/fixture.schema.json), including scale and baseline counts.
7. **Write `README.md`** with attribution and rationale, and **add the NOTICE entry**.
8. **Bump the suite version**, since fixture content is part of the comparability stamp.

## 8. Coverage targets

The suite should span scale and subject matter, and no single upstream vendor should dominate it. A benchmark drawn entirely from one organization's boards measures how well models handle that organization's conventions.

| Tier | Shape | Status |
| --- | --- | --- |
| Simple | Single sheet, roughly 10 to 30 components, one subsystem | [antmicro-microphone-board](antmicro-microphone-board/) |
| Medium | 2 to 5 sheets, a power tree plus 2 or 3 interfaces, real budgets in tension | Needed |
| Hard | Multi-sheet SoM or SBC class, high-speed interfaces, many-layer board | Candidate identified, not vetted |
| Adversarial | A design with a genuine over-constraint, for `refusal` tasks | Needed |

### Candidate shortlist

License, file-format version, and design-file scale verified 2026-07-29 from repository metadata. **Verified here means the license and format gates pass**; every candidate still needs steps 4 through 8 of section 7, above all a baseline ERC and DRC measurement, before it becomes a fixture.

#### Accepted for vetting

| Candidate | License | Format | Scale | Why it is interesting |
| --- | --- | --- | --- | --- |
| [antmicro/pdm-microphone-board](https://github.com/antmicro/pdm-microphone-board) | Apache-2.0 | 20231120 (8.x) | 8.5k-line sch, 12 symbols, 1 sheet | **Vendored.** Simple tier. |
| [GlasgowEmbedded/glasgow](https://github.com/GlasgowEmbedded/glasgow) | 0BSD **or** Apache-2.0 | 20260306 (10.0) | revD0: hierarchical, 532 KB + 490 KB sheets, 10.3 MB board | The strongest candidate found. A manufactured, sold, actively maintained debug tool with FPGA, level shifters, and a power tree. Dual-licensed with an explicit patent grant chosen to protect open-hardware manufacturers, and its format matches the reference `kicad-cli` exactly. Its `test-jig` board is a separate, much smaller design from the same project, useful as a medium-tier fixture. |
| [byrantech/laptop](https://github.com/byrantech/laptop) (anyon\_e) | MIT | 20241004 (8.99) | motherboard 1.37 MB sch, 8.45 MB board; separate power, keyboard, audio boards | A complete high-end laptop. The hardest realistic target available, and it decomposes: the audio and power boards stand alone as smaller fixtures. Two cautions: the format is a development build between KiCad 8 and 9 and needs a load check, and it vendors a TI symbol carrying its own license file. |
| [OpenLightingProject/rp2040-dmxsun](https://github.com/OpenLightingProject/rp2040-dmxsun) | Apache-2.0 | 20231120 (8.x) | six sibling boards, 0.7 to 1.5 MB each | RP2040 plus DMX isolation, as a family of baseboard and I/O-board variants. The family is the appeal: near-identical designs differing in isolation and port count make good material for tasks about propagating a change to the right variant. |
| [Ottercast/OtterCastAudioV2](https://github.com/Ottercast/OtterCastAudioV2) | MIT | 20230121 (7.x) | Power 340 KB, MIPI 204 KB, root 176 KB, 2.3 MB board | A shipped Linux audio streamer with a genuine multi-sheet split. Medium tier, and a different design culture from the others. |
| [zhiayang/mikoto](https://github.com/zhiayang/mikoto) | Apache-2.0 | 20231120 (8.x) | 321 KB sch, 793 KB board, single sheet | nRF52840 in a Pro Micro footprint. Small, single-sheet, real, and from an individual designer rather than an organization. Good simple-to-medium tier and good for origin diversity. |
| [foostan/crkbd](https://github.com/foostan/crkbd) (Corne) | CC-BY-4.0 | 20230121 (7.x) | left and right sheets ~300 KB, 4.7 MB board | Attribution-only, so permitted under section 3's second tier with a documented rationale. Probably the most-manufactured board on this list. Left and right halves are a natural symmetry-propagation task. |
| [CERN KiCad libraries](https://gitlab.com/ohwr/cern-kicad-libs) | CERN-OHL-P-2.0 | 9.x | 17,000 parts | Not a board. A vendored symbol and footprint source, if we decide a warning-free fixture is worth the tree size. |
| [antmicro/jetson-orin-baseboard](https://github.com/antmicro/jetson-orin-baseboard) | Apache-2.0 | 9.x | nine hierarchical sheets | SoM carrier: supply, USB, USB3, Ethernet, HDMI, CSI, M.2, peripherals. Hard tier, pending a KiCad 9 load check. |
| [antmicro/signal-integrity-test-board](https://github.com/antmicro/signal-integrity-test-board), [antmicro/jetson-nano-baseboard](https://github.com/antmicro/jetson-nano-baseboard) | Apache-2.0 | unverified | unverified | Not yet checked. |

#### Rejected, with reasons

| Candidate | License | Reason |
| --- | --- | --- |
| [RespiraWorks/Ventilator](https://github.com/RespiraWorks/Ventilator) | Apache-2.0 | **Format.** Thirty legacy `.sch` files, no s-expression schematics. A genuine loss: a safety-critical ICU ventilator with real budgets in tension would have made an excellent adversarial fixture. |
| [antmicro/m2-smart-iot-module](https://github.com/antmicro/m2-smart-iot-module) | Apache-2.0 | **Format.** Legacy KiCad 5 `.sch`. |
| [mattdibi/redox-keyboard](https://github.com/mattdibi/redox-keyboard) | MIT | **Format.** Legacy `.sch`. |
| [martinribelotta/imxrt1020-module](https://github.com/martinribelotta/imxrt1020-module) | BSD-3-Clause | **Format.** Legacy `.sch`. |
| [gregdavill/OrangeCrab](https://github.com/gregdavill/OrangeCrab) | unspecified | **License and format.** No SPDX-identifiable license, and legacy `.sch`. |
| [antmicro/quickfeather-dev-board](https://github.com/antmicro/quickfeather-dev-board) | CC-BY-SA-4.0 | **License.** Reciprocal, excluded by section 3. |
| [sqfmi/Watchy](https://github.com/sqfmi/Watchy), [makerdiary/nrf52832-mdk](https://github.com/makerdiary/nrf52832-mdk) | MIT | **No sources.** Neither repository contains KiCad design files. |

#### Vetting cautions learned from this pass

- **A repository license may not be the design files' license.** Glasgow is dual-licensed and says so explicitly for design files; other projects license software permissively and hardware reciprocally. Check for per-directory license files and for a licensing statement in the documentation, not only the GitHub-reported SPDX identifier.
- **Vendored third-party symbols carry their own terms.** `byrantech/laptop` includes a TI symbol with a separate license file. Anything vendored into `tree/` inherits an obligation.
- **Legacy format is the single largest disqualifier.** Most rejections here are format, not license. Many of the best-known open-hardware projects predate the s-expression schematic and have never been migrated.
- **Development-build formats need a load check.** A `generator_version` such as `8.99` is a nightly between releases and may not load cleanly under a released `kicad-cli`.

Vendor diversity, previously the open gap, is now addressable: this list spans a manufactured debug tool, a laptop, a lighting-control family, an audio streamer, a keyboard, and an individual designer's module, across five origins other than Antmicro.
