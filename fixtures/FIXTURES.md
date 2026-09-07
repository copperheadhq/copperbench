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
| **A characterized baseline** | Errors, warnings, and parity issues are all recorded by type and count (section 5). A baseline error is permitted only when it is enumerated and accounted for; an unaccounted one is disqualifying. |
| **Zero baseline unconnected items** | This is the check an edit task most needs clean, because it is what a bad edit breaks. Unlike the other counts, a non-zero value here must be argued for, not merely recorded. |
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
2. An entry in [NOTICE](../NOTICE) at the repository root naming the project, copyright holder, license, and upstream URL.
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
    ...              # upstream's own layout, preserved
```

Only `tree/` is copied into a sandbox and only `tree/` is hashed. Provenance, license, and baseline reports are metadata about the fixture, not part of the project an agent sees. Keeping them outside `tree/` means an agent cannot read the baseline report and cannot mistake our bookkeeping for the design's own documents.

**The layout inside `tree/` mirrors upstream and is not normalized.** The first fixture happens to keep its design files in `hardware/`, which is that project's convention rather than a rule here; `zhiayang-mikoto` keeps them at the tree root and `openlighting-dmxsun-baseboard` keeps them under `hardware/<board>/`. Flattening is not a cosmetic choice: a project's `sym-lib-table` and `fp-lib-table` resolve libraries through `${KIPRJMOD}`-relative paths, so moving files changes which symbols resolve and therefore changes the measured baseline. Where a fixture vendors libraries, copy only the ones its lib tables actually name, and preserve the relative path between the project and them.

## 5. Baseline verification, and why a clean baseline is the wrong requirement

The measured baseline of the first real fixture in this suite, a professionally designed, shipped, Apache-2.0 board:

| Check | Errors | Warnings |
| --- | --- | --- |
| ERC | 0 | 44 |
| DRC | 0 | 13 |

All 57 warnings are library resolution: the design references vendor symbol and footprint libraries that are not vendored with it. This is the ordinary condition of any real design in a bare checkout, and it will be true of essentially every fixture we add.

### 5.1 The zero-errors rule did not survive contact with real boards

That first fixture is a twelve-component breakout, and a rule calibrated on it generalized badly. A vetting sweep on 2026-07-29 measured 19 board configurations across 8 upstream projects with `kicad-cli` 10.0.4 (section 8.2). The result:

- **Zero ERC errors is achievable.** Eight of the nineteen configurations reached it, including two ten- and eight-sheet hierarchical designs.
- **Zero DRC errors is not.** Every one of the nineteen carried at least one, the best being a single violation and the median well into double digits.

The recurring DRC error types — `courtyards_overlap`, `hole_clearance`, `zones_intersect`, `copper_edge_clearance`, `solder_mask_bridge` — are geometry rules KiCad has tightened across releases. These are manufactured boards, laid out and fabricated under KiCad 7 or 8, being judged by 10.0.4's ruleset. The errors are mostly not defects the designers shipped; they are the cost of pinning a reference CLI newer than the designs.

Held literally, therefore, a zero-errors gate admitted no real board beyond the trivial one already vendored, and the coverage table in section 8 could never have been filled.

### 5.2 The rule that replaced it: enumerate and account

The original rationale was that "a pre-existing error is indistinguishable from one the agent introduced." That is false as stated, and its own machinery is why: `drc_no_new_violations` compares a post-run report against **the recorded baseline**, not against zero. A pre-existing error is distinguishable precisely because it was written down.

So the requirement is no longer *no errors*. It is *no unaccounted errors*:

- **A baseline error count may be non-zero, but every error type must be enumerated** in `fixture.json` as `errorTypes` (the schema requires it whenever `errors` is non-zero) **and accounted for in the fixture README.** "Six DRC errors" is not acceptable; "four `hole_clearance`, one `courtyards_overlap`, one `zones_intersect`, all KiCad 10 geometry rules applied to a KiCad 8 layout" is.
- **The enumeration is an allowlist.** An error type appearing at run time that is absent from `errorTypes`, or that exceeds its recorded count, is a new violation and fails the assertion. Recording an error does not forgive it; it makes it a fixed point that an agent must not move.
- **Unconnected items are still held to zero in practice.** They are what a bad edit breaks, so a non-zero count materially weakens the fixture. The schema permits recording one, but the README must argue why the fixture is still worth having.
- **Parity issues must be typed.** `footprint_symbol_field_mismatch` is metadata drift between board and schematic — a `Description` or `LCSC Part` field differing — and is common in real projects and tolerable. `duplicate_footprints`, `extra_footprint`, and `missing_footprint` are structural, and a candidate carrying them in quantity should be rejected rather than recorded.

The discipline this preserves is the one that matters: a score still depends only on what changed relative to a frozen, published, offline-checkable record.

### 5.3 Standing rules

- **Every fixture records its baseline reports** under `baseline/`, generated by the reference `kicad-cli`, with counts summarized in `fixture.json`.
- **Tasks on real fixtures assert `erc_no_new_violations` and `drc_no_new_violations`**, which compare the post-run report against the recorded baseline and pass when no violation appears that was not already there. Both accept a `severity` argument, defaulting to `error` and above.
- **`erc_clean` and `drc_clean` remain in the vocabulary** for synthetic fixtures and for a fixture whose libraries are fully vendored, where a clean report is genuinely achievable. No real board vendored so far qualifies.
- **Baselines are regenerated only when the reference `kicad-cli` version changes**, and the new counts land in `fixture.json` in the same commit. The reference moved from 10.0.4 to **10.0.6** on 2026-09-07 and every baseline was regenerated under it; the 10.0.4 figures quoted in section 8.2 and in the candidate table are the historical record of that dated sweep and are deliberately left as measured. Errors, error types, unconnected items, and parity reproduced exactly across all four vendored fixtures under 10.0.6, so nothing a task is graded on moved; warnings drifted on two of them (`antmicro-jetson-orin-baseboard` 1,750 to 1,751 ERC and 251 to 226 DRC, `openlighting-dmxsun-baseboard` 182 to 224 ERC and 31 to 43 DRC). A silent baseline drift would let an agent-introduced violation hide inside an updated expectation, which is precisely the failure this machinery exists to prevent. Under the allowlist rule this matters more, not less: an upward-drifting `errorTypes` count is exactly how a regression would hide.

## 6. Scale, and calibrating a surgicality bound

Fixture scale is recorded in `fixture.json` so that a task author sets a diff bound against a known denominator.

AC-3.7 states surgicality as 5 percent of a file's lines. That figure was calibrated against a small synthetic schematic where 5 percent is roughly fourteen lines. On an 8,489-line real schematic, 5 percent is 424 lines: enough to rewrite whole subsystems and still pass.

**A surgicality bound is calibrated per task against the file it constrains, not inherited as a constant.** The rule of thumb: bound at roughly ten times the size of a correct minimal edit, so that a correct-but-inelegant run passes and a regenerating run cannot. State the reasoning in the task's README.

## 7. Preparation procedure

1. **Vet the license** against section 3 before anything else. If it does not pass, stop; a good board with the wrong license is not a candidate.
2. **Clone at a pinned commit** and record the full SHA.
3. **Copy only design files** into `tree/`: `.kicad_sch`, `.kicad_pcb`, `.kicad_pro`, `.kicad_dru`, the project `sym-lib-table` and `fp-lib-table`, and any vendored library those tables name. Do not copy `.kicad_prl` (local editor state), CI configuration, rendered assets, documentation PDFs, or 3D models (`.step`, `.wrl`) inside a `.pretty` directory. They inflate the sandbox copy for every run of every repeat and none of them affect grading. Copy an empty lib table rather than omitting it: an empty project library table is a meaningful state, and it explains why a design resolves from its embedded symbol cache.
4. **Run the reference `kicad-cli`** for ERC and DRC and write the reports to `baseline/`. Then apply section 5.2: unconnected items should be zero, structural parity issues should be absent, and every remaining error must be enumerable and explainable. If an error type cannot be accounted for, or the baseline is pervasively dirty, reject the candidate. Vendoring the project's missing libraries and re-measuring is worth trying first, but do not assume it helps — on `GlasgowEmbedded/glasgow` revD0 it changed nothing at all (section 8.2).
5. **Sweep KiCad's own artifacts out of `tree/`, then hash** with `node scripts/hash-fixture.mjs fixtures/<id>/tree`.

   KiCad writes into the project directory as a side effect of merely looking at a design, and every such file is copied into every sandbox and silently baked into the fixture hash:

   | Artifact | Written by |
   | --- | --- |
   | `*.kicad_prl` | `kicad-cli sch erc` / `pcb drc`, and the GUI |
   | `~*.lck` | the GUI, while a file is open |
   | `.history/` | the GUI's local-history feature — an entire nested git repository |
   | `fp-info-cache` | footprint library scans |

   ```bash
   find fixtures/<id>/tree \( -name '*.kicad_prl' -o -name '~*.lck' -o -name 'fp-info-cache' \) -delete
   rm -rf fixtures/<id>/tree/.history
   ```

   **Do not open a vendored fixture in the KiCad GUI.** Inspect a copy outside `fixtures/` instead. A `--check` mismatch is the symptom; compare the file list against the recorded count before assuming a design file changed, because these artifacts change the hash without touching the design at all.
6. **Write `fixture.json`** against [schema/fixture.schema.json](../schema/fixture.schema.json), including scale and baseline counts.
7. **Write `README.md`** with attribution and rationale, and **add the NOTICE entry**.
8. **Bump the suite version**, since fixture content is part of the comparability stamp.

## 8. Coverage targets

The suite should span scale and subject matter, and no single upstream vendor should dominate it. A benchmark drawn entirely from one organization's boards measures how well models handle that organization's conventions.

| Tier | Shape | Status |
| --- | --- | --- |
| Simple | Single sheet, roughly 10 to 30 components, one subsystem | [antmicro-microphone-board](antmicro-microphone-board/), [openlighting-dmxsun-baseboard](openlighting-dmxsun-baseboard/) |
| Medium | 2 to 5 sheets, a power tree plus 2 or 3 interfaces, real budgets in tension | [zhiayang-mikoto](zhiayang-mikoto/) fills it by component count and complexity but is single-sheet. A genuinely multi-sheet medium fixture is still needed; see 8.2 for why the obvious candidates failed. |
| Hard | Multi-sheet SoM or SBC class, high-speed interfaces, many-layer board | [antmicro-jetson-orin-baseboard](antmicro-jetson-orin-baseboard/) |
| Adversarial | A design with a genuine over-constraint, for `refusal` tasks | Needed. No candidate found: an over-constrained design is not something projects publish, so this tier will likely have to be constructed from a real board plus a stated brief rather than vendored. |

Four fixtures across three upstream origins: Antmicro (two boards), the Open Lighting Project, and one individual designer. No single origin dominates, which was the stated goal.

### 8.1 Candidate shortlist

License, file-format version, and design-file scale verified 2026-07-29 from repository metadata. **Verified here means the license and format gates pass**; every candidate still needs steps 4 through 8 of section 7, above all a baseline ERC and DRC measurement, before it becomes a fixture. Entries marked **vendored** or **measured** have been through that.

#### Accepted for vetting

| Candidate | License | Format | Scale | Why it is interesting |
| --- | --- | --- | --- | --- |
| [antmicro/pdm-microphone-board](https://github.com/antmicro/pdm-microphone-board) | Apache-2.0 | 20231120 (8.x) | 8.5k-line sch, 12 symbols, 1 sheet | **Vendored.** Simple tier. The only candidate with a fully clean baseline. |
| [antmicro/jetson-orin-baseboard](https://github.com/antmicro/jetson-orin-baseboard) | Apache-2.0 | 20231120 (8.x, not 9.x as previously recorded) | 364k-line sch set over 10 sheets, 1.8M-line board | **Vendored.** Hard tier. Zero ERC errors, zero unconnected, zero parity; six enumerated DRC geometry errors. The 44 MB tree is the cost. |
| [OpenLightingProject/rp2040-dmxsun](https://github.com/OpenLightingProject/rp2040-dmxsun) | Apache-2.0 | 20231120 (8.x) | six sibling boards, 0.7 to 1.5 MB each | **Vendored** (`baseboard_2slots`). Simple tier, and the cleanest baseline after the microphone board. The family remains the long-term appeal: near-identical variants differing in isolation and port count are good material for tasks about propagating a change to the right variant. The five other variants measured worse (8 to 23 DRC errors) and were not vendored. |
| [zhiayang/mikoto](https://github.com/zhiayang/mikoto) | Apache-2.0 | 20231120 (8.x) | 20k-line sch, 26k-line board, 67 symbols, single sheet | **Vendored.** Medium tier by complexity. nRF52840 in a Pro Micro footprint, from an individual designer rather than an organization. |
| [GlasgowEmbedded/glasgow](https://github.com/GlasgowEmbedded/glasgow) | 0BSD **or** Apache-2.0 | 20260306 (10.0) | revD0: 8 sheets, 10.3 MB board | **Measured, not vendored, still attractive.** Previously called "the strongest candidate found"; measurement did not support that. revD0 carries 26 ERC errors (24 `power_pin_not_driven`, 2 `pin_to_pin`) against the Orin baseboard's zero, and vendoring its libraries does not clear them (8.2). Its genuine advantages stand: the licensing statement explicitly covers design files, the patent grant was chosen to protect open-hardware manufacturers, and its format matches the reference CLI exactly. Under the section 5.2 allowlist rule it is now vendorable if its 26 errors are enumerated. Note its `test-jig` board has **no schematic**, only a `.kicad_pcb`, so it cannot serve as the medium-tier fixture previously suggested. |
| [byrantech/laptop](https://github.com/byrantech/laptop) (anyon\_e) | MIT | 20240417 / 20241004 (8.99) | motherboard 1.37 MB sch, 8.45 MB board; separate audio, haptic, keyboard, protector boards | **Measured, not vendored.** The 8.99 development-build format loads cleanly under `kicad-cli` 10.0.4, resolving the earlier open question. But all four small boards measured poorly: `audio` alone has 120 DRC errors including 58 `via_diameter` and 58 `annular_width`, and `haptic` has 44 `missing_footprint` parity issues. Still vendors a TI symbol carrying its own license file. |
| [Ottercast/OtterCastAudioV2](https://github.com/Ottercast/OtterCastAudioV2) | MIT | 20230121 (7.x) | 5 sheets, 2.3 MB board | **Measured, rejected.** The best-shaped medium-tier candidate on paper — a genuine root-plus-four-sheet split — and by far the worst measured: 17 ERC errors, 219 DRC errors (199 `hole_clearance`), and 238 parity issues including `duplicate_footprints`. Pervasively dirty rather than accountably dirty. |
| [foostan/crkbd](https://github.com/foostan/crkbd) (Corne) | CC-BY-4.0 | 20230121 (7.x) | left and right sheets ~300 KB, 4.7 MB board | **Measured, rejected for now.** Attribution-only, so permitted under section 3's second tier with a documented rationale, and probably the most-manufactured board on this list; the left/right halves remain a natural symmetry-propagation task. But both variants carry 149 to 195 parity issues including structural `duplicate_footprints` and `extra_footprint`. |
| [antmicro/jetson-nano-baseboard](https://github.com/antmicro/jetson-nano-baseboard) | Apache-2.0 | 20250114 (9.x) | 8 sheets | **Measured, rejected.** Clean ERC, but 54 DRC errors, 202 parity issues, and — uniquely among everything vetted — a non-zero unconnected-item count, which section 5.2 treats as disqualifying rather than recordable. |
| [antmicro/signal-integrity-test-board](https://github.com/antmicro/signal-integrity-test-board) | Apache-2.0 | 20211123 (6.x) | 6.4k-line sch, single sheet | **Measured, rejected.** Small and appealing, but 44 DRC errors (41 `solder_mask_bridge`) and 28 parity issues. |
| [CERN KiCad libraries](https://gitlab.com/ohwr/cern-kicad-libs) | CERN-OHL-P-2.0 | 9.x | 17,000 parts | Not a board. A vendored symbol and footprint source, if we decide a warning-free fixture is worth the tree size. Untested; note that library resolution was never the blocker (8.2), so this would reduce warning counts but not error counts. |

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

### 8.2 The measured sweep, 2026-07-29

Nineteen board configurations across eight upstream projects, every one measured with `kicad-cli` 10.0.4 using the same two commands the fixture READMEs document. The method was validated first by re-measuring the already-vendored microphone board and reproducing its recorded baseline exactly (0/44 as 32 + 12, 0/13, parity 0), so the numbers below are comparable to it and to each other.

| Candidate | Sheets | ERC err | DRC err | Unconn | Parity | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| antmicro-microphone-board (control) | 1 | 0 | 0 | 0 | 0 | already vendored |
| antmicro/jetson-orin-baseboard | 10 | 0 | 6 | 0 | 0 | **vendored, hard** |
| OpenLightingProject baseboard\_2slots | 1 | 0 | 1 | 0 | 1 | **vendored, simple** |
| zhiayang/mikoto | 1 | 0 | 1 | 0 | 84 | **vendored, medium** |
| OpenLightingProject baseboard\_4slots | 1 | 1 | 3 | 0 | 0 | not vendored |
| OpenLightingProject ioboard ×4 | 1 | 0 | 8–23 | 0 | 4–8 | not vendored |
| GlasgowEmbedded revD0 | 11 | 26 | 1 | 0 | 0 | not vendored |
| antmicro/jetson-nano-baseboard | 8 | 0 | 54 | **1** | 202 | rejected |
| antmicro/signal-integrity-test-board | 1 | 1 | 44 | 0 | 28 | rejected |
| Ottercast/OtterCastAudioV2 | 5 | 17 | 219 | 0 | 238 | rejected |
| byrantech/laptop audio, haptic, encoder, protector | 1 | 1–6 | 1–120 | 0 | 0–44 | rejected |
| foostan/crkbd cherry, chocolate | 3 | 3 | 14–16 | 0 | 149–195 | rejected |

Three conclusions worth carrying forward.

**Library resolution was never the blocker.** The natural hypothesis for Glasgow revD0's 26 ERC errors was that a bare checkout cannot resolve its symbols, so the experiment was run: revD0 was re-measured with `Glasgow.kicad_sym` and `Glasgow.pretty` vendored beside it and project-local lib tables pointing at them. Every count was identical — 26 errors, 741 warnings, 1 DRC error. Vendoring libraries suppresses `lib_symbol_issues` **warnings** and nothing else. Step 4 of section 7 should not promise otherwise.

**A repository's design culture predicts its baseline better than its prestige does.** The two cleanest results came from a professional vendor's small board and a community project's controller; the worst came from a shipped commercial audio streamer and a high-end laptop. Scale correlates with dirt only weakly: the ten-sheet Orin baseboard measured cleaner than four different single-sheet boards.

**Format age predicts DRC dirt.** Every KiCad 7-era design measured badly on geometry rules; the KiCad 8 and 9 designs measured better; the only KiCad 10-format design (Glasgow) had exactly one DRC error and zero parity issues, failing instead on ERC. When choosing between otherwise comparable candidates, prefer the one authored closest to the reference CLI.

#### Vetting cautions learned from this pass

- **A repository license may not be the design files' license.** Glasgow is dual-licensed and says so explicitly for design files; other projects license software permissively and hardware reciprocally. Check for per-directory license files and for a licensing statement in the documentation, not only the GitHub-reported SPDX identifier.
- **Vendored third-party symbols carry their own terms.** `byrantech/laptop` includes a TI symbol with a separate license file. Anything vendored into `tree/` inherits an obligation.
- **Legacy format is the single largest disqualifier at the paper stage.** Most rejections from repository metadata alone are format, not license. Many of the best-known open-hardware projects predate the s-expression schematic and have never been migrated.
- **Development-build formats need a load check, and can pass it.** A `generator_version` such as `8.99` is a nightly between releases. `byrantech/laptop`'s 8.99 files loaded and checked cleanly under `kicad-cli` 10.0.4; that board was rejected on its measured baseline, not its format.
- **Baseline measurement is the real gate, and it disqualifies far more than format does.** Of the candidates that cleared the license and format gates, most then failed on measurement. Do not treat a shortlist entry as nearly-a-fixture: reaching section 7 step 4 is where candidates actually die.
- **A shortlist's confidence is not evidence.** This document previously named Glasgow revD0 "the strongest candidate found" and recorded the Orin baseboard as 9.x with nine sheets. Measurement showed Glasgow has the worst ERC result of any hierarchical candidate, and the Orin baseboard is 8.x with ten sheets. Entries derived from repository metadata should be read as hypotheses.
- **`kicad-cli` writes into the project directory.** Running ERC or DRC drops a `.kicad_prl` beside the project. Left in place it is copied into every sandbox and baked into the fixture hash. Section 7 step 5 exists because of this.

Vendor diversity, previously the open gap, is now closed in the suite itself rather than only in the shortlist: four fixtures across Antmicro, the Open Lighting Project, and an individual designer. The unfilled tiers are the genuinely multi-sheet medium fixture and the adversarial one.
