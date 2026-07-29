# Tasks: add-model-benchmark-suite

## 1. The standard and its schemas

- [x] 1.1 Write `STANDARD.md`: unit of evaluation, sandbox and fixture pinning, the three evidence sources, the closed assertion vocabulary with each type's evidence source and arguments, outcome classes, scoring and headline rules, repeats, cost accounting and provider segmentation, comparability stamps, failure taxonomy, ablations and regression gating, memorization variants, the fenced rubric tier, and the reference environment
- [x] 1.2 Write `schema/task.schema.json` and `schema/assertions.schema.json` (JSON Schema draft 2020-12), enumerating the assertion vocabulary so an unknown type is a validation error
- [x] 1.3 Write `schema/result.schema.json` covering every field required by the result-record requirement, with `schemaVersion` and `suiteVersion` mandatory
- [ ] 1.4 Seed `pricing.json` with a table version, effective date, and entries for the direct API models in the matrix; document the `null`-cost rule for self-hosted and saved-login routes
- [x] 1.5 Write two worked task directories against the schemas and the first real fixture, one `do`-mode `edit` task (net rename, exercising a calibrated `diff_ratio_max`) and one `do`-mode `refusal` task (budget violation), each with `task.json`, `assertions.json`, and a `README.md` stating the trap

## 2. Fixtures

- [x] 2.1 Write `fixtures/FIXTURES.md`: why fixtures are real boards, selection criteria, license policy, directory layout, baseline-verification rule, surgicality calibration, preparation procedure, coverage targets, candidate shortlist
- [x] 2.2 Write `schema/fixture.schema.json` (provenance, KiCad format, scale, baseline counts) and `scripts/hash-fixture.mjs` implementing the canonical tree hash standalone, so a third party can verify a hash without installing the project
- [x] 2.3 Vendor the first real fixture: `antmicro-microphone-board` (Apache-2.0, KiCad 8.x, single sheet, 12 symbols), with verbatim LICENSE, `NOTICE` entry, measured baseline ERC/DRC reports, and `fixture.json`
- [x] 2.4 Vet and vendor a medium-tier fixture from a different upstream origin than the simple one: `zhiayang-mikoto` (Apache-2.0, 67 symbols, individual designer). Also vendored `openlighting-dmxsun-baseboard` (Apache-2.0, simple tier, third origin). **Partially open:** both are single-sheet. A genuinely multi-sheet 2-to-5-sheet fixture is still missing; the shortlist's best-shaped candidate, `Ottercast/OtterCastAudioV2`, measured 17 ERC errors, 219 DRC errors, and 238 parity issues and was rejected (FIXTURES.md 8.2)
- [x] 2.5 Vet and vendor a hard-tier fixture: `antmicro-jetson-orin-baseboard` (Apache-2.0, 10 hierarchical sheets, 364k-line schematic set, zero ERC errors, zero unconnected, zero parity). The lead candidate `GlasgowEmbedded/glasgow` revD0 was measured and *not* chosen: 26 ERC errors against the alternate's zero, and vendoring its libraries changed nothing
- [x] 2.6 Close the vendor-diversity gap: the suite itself now spans three origins (Antmicro, Open Lighting Project, an individual designer) rather than only the shortlist
- [x] 2.7 Evaluate vendoring libraries to eliminate library-resolution warnings: **answered by measurement, no CERN vendoring needed to answer it.** Re-measuring Glasgow revD0 with its own symbol and footprint libraries vendored beside it produced byte-identical counts. Library vendoring suppresses `lib_symbol_issues` warnings only and does not touch error counts, so a warning-free fixture buys tidier reports and nothing that affects a verdict. Not worth the tree size
- [x] 2.11 Revise the baseline gate from "zero errors" to "errors enumerated and accounted for" (design D23), updating `schema/fixture.schema.json`, `fixtures/FIXTURES.md` sections 2, 4, 5, 7, 8, and `STANDARD.md` section 6. Driven by a 19-configuration measured sweep in which zero DRC errors proved unachievable on every real board
- [ ] 2.8 Implement `scripts/validate.ts`: schema validation of every task and fixture, closed-vocabulary enforcement, fixture hash verification, `NOTICE`-entry presence, duplicate id detection; wire to `npm run benchmark -- --validate`
- [ ] 2.9 Promote the standalone hasher into the runner without changing the algorithm, and add a `--rehash` maintenance path that reports what changed
- [ ] 2.10 Offline unit tests for validation and hashing, including the unknown-type, hash-mismatch, legacy-format, and baseline-error refusal paths

## 3. Runner

- [ ] 3.1 Implement sandbox materialization: temp directory outside the repo, fixture copy, `git init`, baseline commit, recorded baseline SHA, teardown that preserves the sandbox on failure for later re-scoring
- [ ] 3.2 Implement run execution per (task, model, repeat): config overrides written to `.copperhead/config.json` with `llmCache: false`, no `--allow-dirty`, per-task turn and wall-clock caps enforced with termination and a recorded exit path
- [ ] 3.3 Implement the run plan and cost estimator: `--suite smoke|full`, model matrix selection, repeat count, printed estimate before execution, `--dry-run` that prints plan and estimate and executes nothing
- [ ] 3.4 Implement ablation overrides (`--prompt-variant`, `--max-turns`, `--tool-subset`, `--max-repair-cycles`) applied to the run and stamped into the record
- [ ] 3.5 Implement resumability: a completed (task, model, repeat) with an existing record is skipped unless `--force`, so an interrupted expensive suite continues rather than restarting

## 4. Scorer

- [ ] 4.1 Implement the three evidence adapters: sandbox end state (reusing the read-only sexp parser and doc readers), git diff against the baseline commit, and transcript event reader including `run-start` and `run-end`
- [ ] 4.2 Implement the assertion vocabulary, each type declaring its evidence source; assert no LLM and no network are reachable from the scorer path
- [ ] 4.3 Implement verdict computation: strict pass on all `required` assertions, weighted partial credit, per-assertion outcome records
- [ ] 4.4 Implement the deterministic failure classifier over exit path, first failed required assertion, and dominant tool-error category, covering all eleven categories
- [ ] 4.5 Implement `--rescore <results-dir>`: re-evaluate preserved sandboxes and transcripts with no provider credential and no network
- [ ] 4.6 Offline scorer tests driven by recorded transcript and sandbox fixtures, one per assertion type and one per failure category, needing no provider

## 5. Records, report, and gating

- [ ] 5.1 Implement result-record writing with the full comparability stamp, the secret re-scan that hard-fails on a match against the STANDARD.md 6.1 credential pattern set (shared with the `no_secret` assertion, so both read one list), and append-only semantics
- [ ] 5.2 Implement the aggregate report: strict pass rate and cost per passing task per tier and model, pass@1 and pass^k with spread, correct-refusal and false-refusal rates, surgicality and process-discipline detail, variant gap
- [ ] 5.3 Implement the failure work queue: categories ranked by frequency times mean cost, with affected tasks and models
- [ ] 5.4 Implement `LEADERBOARD.md` generation with generated-file markers, comparability segregation of mismatched records, and a consistency check that fails on a hand edit
- [ ] 5.5 Implement `--compare <baseline.json>` with per-tier thresholds for pass-rate drop and cost-per-pass rise, exiting non-zero past threshold
- [ ] 5.6 Wire `npm run benchmark`, and document that it is not part of default CI

## 6. Suite build-out

- [ ] 6.1 Port the AC-3.x behaviors into tasks: rename propagation, constraint-aware pin choice, add part, budget refusal, repair loop, rollback integrity, dry run
- [ ] 6.2 Port the AC-7.x sync behaviors into tasks, including one `flag` task where the correct outcome is surfacing a requirement violation without resolving it
- [ ] 6.3 Add `create`-mode tasks from `examples/`, one per tier, including `gnss-lora-tracker` as the unsatisfiable brief
- [ ] 6.4 Land the Open Telegraph brief as `tasks/create-telegraph/` in the general format, and strike section 4 from `prove-live-acceptance/tasks.md` with a pointer to this change
- [ ] 6.5 Implement the deterministic mutation transform and add mutated variants for the declared subset; verify a variant is solvable by construction

## 7. First live matrix

- [ ] 7.1 Run `smoke` at 3 repeats against the direct API segment (Anthropic and OpenAI, frontier and cheap tiers); publish records
- [ ] 7.2 Run `smoke` against the saved-login CLI segment; confirm `pinning: weak` and `null` cost render in their own table
- [ ] 7.3 Run `smoke` against at least one open-weight endpoint; record the serving configuration in the run notes
- [ ] 7.4 Generate the leaderboard from the published records and record the first baseline per model
- [ ] 7.5 Review the failure work queue and open issues for the top categories

## 8. Paper

- [x] 8.1 Scaffold `paper/` with the arXiv preprint LaTeX style, section skeleton, bibliography, and `npm run paper` via `latexmk`
- [ ] 8.2 Implement `scripts/paper/generate.ts`: emit `paper/generated/macros.tex` and `paper/generated/tables.tex` from a named result snapshot, deterministically, including the provenance block
- [ ] 8.3 Implement `scripts/paper/check-claims.ts`: fail the build on a literal numeral in results-bearing sections, naming file, line, and text
- [x] 8.4 Write sections 1 to 5 and the threats, limitations, and reproducibility sections from the standard, with results sections wired to generated tables
- [ ] 8.5 Assemble v1 against the step 7.4 snapshot, with the abstract stating matrix size and absent segments
- [ ] 8.6 Prepare the arXiv submission bundle and the artifact release pointing at the task suite, records, and runner

## 9. Verification

- [ ] 9.1 Confirm a stranger path: from a clean clone, re-score published records with no API key and no network, and reproduce the leaderboard byte-for-byte
- [ ] 9.2 Confirm a hand edit inside the generated leaderboard region fails the consistency check
- [ ] 9.3 Confirm a planted credential in a candidate record hard-fails record writing, with one case per kind in the STANDARD.md 6.1 pattern set. The `AIza` (Google/Gemini) case is the one that matters most: copperhead's write-time redaction does not cover it, so this scan is the only thing standing between a Gemini key and published output
- [ ] 9.4 Confirm a task manifest edit bumps the suite version and segregates prior records in the leaderboard
- [ ] 9.5 Confirm the full suite leaves the copperhead working tree unchanged outside `results/`
