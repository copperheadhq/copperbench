# model-benchmark — delta spec

## ADDED Requirements

### Requirement: A benchmark task is declarative data

A benchmark task SHALL be a directory `tasks/<task-id>/` containing `task.json`, `assertions.json`, and `README.md`, and SHALL require no runner code change to add. `task.json` SHALL declare: `id`, `tier` (`simple`, `medium`, or `hard`), `mode` (`do`, `create`, `sync`, or `check`), `fixture` (a path plus SHA-256 content hash of the fixture tree), the request (a prompt string for `do`, a brief path for `create`), `expectedOutcome` (`edit`, `refusal`, or `flag`), config overrides applied to the sandbox (`budgets`, `maxTurns`, `maxRepairCycles`), a wall-clock cap, and `tags` naming the acceptance criteria and capabilities exercised. `assertions.json` SHALL contain only assertions drawn from the closed vocabulary, each with an `id`, `type`, `args`, `weight`, and `required` flag. A manifest referencing an assertion type outside the vocabulary SHALL fail validation rather than be skipped.

#### Scenario: A contributor adds a task without touching the runner

- **WHEN** a new directory with a valid `task.json` and `assertions.json` is added under `tasks/`
- **THEN** the runner discovers and executes it with no code change, and `npm run benchmark -- --validate` reports the suite as valid

#### Scenario: An unknown assertion type is rejected loudly

- **WHEN** a task declares an assertion whose `type` is not in the vocabulary
- **THEN** suite validation exits non-zero naming the task and the offending type, and no run is started

#### Scenario: A fixture whose content hash does not match is refused

- **WHEN** a task's fixture tree hashes differently from the `fixture.sha256` recorded in its manifest
- **THEN** the runner refuses to execute that task and reports the expected and actual hashes

### Requirement: Each run executes in an isolated, pristine sandbox

The runner SHALL materialize one sandbox per (task, model, repeat): copy the pinned fixture into a temporary directory outside the copperhead repository, initialize a git repository, commit a baseline, and record the baseline commit SHA in the result record. The runner SHALL NOT modify the copperhead working tree, SHALL NOT reuse a sandbox across repeats, and SHALL set `llmCache` to false and omit `--allow-dirty` for every benchmark run, recording both facts in the result record.

#### Scenario: Repeats do not inherit each other's work

- **WHEN** repeat 2 of a task begins
- **THEN** it runs in a new sandbox materialized from the pinned fixture, with no artifact of repeat 1 present

#### Scenario: The response cache cannot manufacture determinism

- **WHEN** any benchmark run executes
- **THEN** the run's resolved config reports `llmCache: false` and the result record states that the cache was disabled

#### Scenario: The copperhead repository is untouched

- **WHEN** a full suite completes, including failing and rolled-back runs
- **THEN** `git status` in the copperhead repository reports no change caused by the runner outside `results/`

### Requirement: Fixtures are real, permissively licensed open-hardware boards with recorded provenance

A fixture SHALL be a KiCad project taken from a real open-hardware project at a pinned upstream commit, stored as `fixtures/<id>/` containing a `tree/` subdirectory holding the project itself, plus `fixture.json`, the verbatim upstream `LICENSE`, a `README.md` stating attribution, and `baseline/` verification reports. Only `tree/` SHALL be copied into a sandbox and only `tree/` SHALL be hashed. `fixture.json` SHALL record upstream name, URL, full commit SHA, retrieval date, license, copyright, and a description of what was and was not copied, together with the KiCad format version, the reference `kicad-cli` version, scale (schematic and board line counts, symbol and sheet counts), and baseline verification counts.

Fixtures SHALL use modern s-expression `.kicad_sch` format; legacy `.sch` projects SHALL be rejected. A fixture's baseline SHALL be **accounted for rather than clean** (design decision D23): a non-zero baseline error count is permitted, but every error type SHALL be enumerated in `fixture.json` as `errorTypes` with its count, and that enumeration SHALL function as an allowlist — an unrecorded error type, or a recorded type exceeding its recorded count, is a new violation. Unconnected items and structural schematic-parity issues SHALL be zero. Only permissive licenses SHALL be vendored; reciprocal, share-alike, and non-commercial licensed designs SHALL NOT be redistributed as fixtures. Every vendored fixture SHALL have a corresponding entry in the repository `NOTICE`.

#### Scenario: A fixture is traceable to its upstream

- **WHEN** a reader inspects any fixture directory
- **THEN** `fixture.json` and `README.md` name the upstream project, URL, full commit SHA, retrieval date, license, and copyright holder, and the verbatim upstream license text is present

#### Scenario: A legacy-format project is rejected

- **WHEN** a candidate project ships KiCad legacy `.sch` files rather than s-expression `.kicad_sch`
- **THEN** it is rejected as a fixture rather than converted

#### Scenario: A design with unaccounted baseline errors is rejected

- **WHEN** a candidate's baseline ERC or DRC report contains an error-severity violation whose type is not enumerated in `fixture.json` as an `errorTypes` entry
- **THEN** it is rejected as a fixture, because an unenumerated pre-existing error is indistinguishable from an agent-introduced one

#### Scenario: An accounted-for baseline error does not disqualify a real board

- **WHEN** a candidate carries baseline DRC errors that are each enumerated by type and count in `fixture.json` and explained in its README
- **THEN** it is admissible as a fixture, and `drc_no_new_violations` grades against that enumeration as an allowlist

#### Scenario: A design with unconnected items or structural parity issues is rejected

- **WHEN** a candidate's baseline reports a non-zero unconnected-item count or a structural schematic-parity issue
- **THEN** it is rejected as a fixture, because those are precisely what a bad edit breaks

#### Scenario: A reciprocally licensed design is not vendored

- **WHEN** a candidate board is licensed under a share-alike, reciprocal, or non-commercial license
- **THEN** it is not redistributed as a fixture regardless of its technical suitability

#### Scenario: Fixture metadata is invisible to the agent

- **WHEN** a sandbox is materialized from a fixture
- **THEN** it contains the contents of `tree/` only, and neither the baseline reports nor `fixture.json` are present in the sandbox

### Requirement: Verification assertions on real fixtures are baseline-relative

The vocabulary SHALL provide `erc_no_new_violations` and `drc_no_new_violations`, which compare the post-run report against the fixture's recorded baseline reports and pass when no violation is present that was not already in the baseline, accepting a `severity` argument defaulting to error-and-above. Tasks on fixtures with baseline warnings SHALL use these rather than the strict `erc_clean` and `drc_clean` forms. Baseline reports SHALL be regenerated only when the reference `kicad-cli` version changes, and the regenerated counts SHALL be committed together with the reports.

#### Scenario: Library-resolution warnings do not fail every run

- **WHEN** a task runs on a fixture whose baseline carries library-resolution warnings, and the run introduces no new violation
- **THEN** the baseline-relative assertions pass

#### Scenario: An introduced violation is caught despite a warning-carrying baseline

- **WHEN** a run introduces an ERC violation not present in the fixture's baseline
- **THEN** `erc_no_new_violations` fails and names the introduced violation

### Requirement: Surgicality bounds are calibrated per task

A task declaring `diff_ratio_max` SHALL set its bound against the size of a correct minimal edit for the file it constrains, and SHALL state that reasoning in its `README.md`. A bound SHALL NOT be inherited as a fixed constant across fixtures of different scale.

#### Scenario: A bound that cannot bind is not accepted

- **WHEN** a task on a large schematic declares a ratio that would permit rewriting entire subsystems
- **THEN** the task is not accepted into the suite, and its README must justify the bound it does declare against a correct minimal edit

### Requirement: Scoring is deterministic, LLM-free, and network-free

The scorer SHALL evaluate assertions using only three evidence sources: the sandbox end state, the git diff between the baseline commit and the end state, and the run's `transcript.jsonl` including its `run-start` and `run-end` events. The scorer SHALL NOT call an LLM, SHALL NOT access the network, and SHALL NOT read CLI stdout or stderr. Given a preserved sandbox and transcript, re-scoring SHALL produce identical assertion outcomes without any provider credential.

#### Scenario: A stranger reproduces a published score without a key

- **WHEN** a preserved sandbox and transcript from a published run are re-scored on a machine with no API key and no network
- **THEN** the scorer produces the same per-assertion outcomes and the same task verdict as the published record

#### Scenario: Presentation changes do not move scores

- **WHEN** CLI output formatting changes but transcript events and repository end state are unchanged
- **THEN** every assertion outcome is unchanged

### Requirement: The assertion vocabulary is closed and typed

The standard SHALL define a closed assertion vocabulary, and the scorer SHALL implement exactly it: `erc_clean`, `drc_clean`, `check_clean`, `drift_clean`, `net_present`, `net_absent`, `symbol_present`, `symbol_absent`, `pin_net_equals`, `files_touched_subset`, `file_unchanged`, `diff_ratio_max`, `doc_row_matches`, `doc_contains`, `exit_path_in`, `refusal_cites_budget`, `transcript_event`, `commit_count`, `rollback_byte_identical`, `no_secret`, and `constraint_registered`. Each assertion SHALL name the evidence source it reads. Adding a type to the vocabulary SHALL bump the suite version.

#### Scenario: Surgicality is measurable as an assertion

- **WHEN** a task asserts `diff_ratio_max` with a bound of 0.05 on the schematic
- **THEN** a run whose `.kicad_sch` diff changes more than 5 percent of the file's lines fails that assertion, satisfying the AC-3.7 invariant mechanically

#### Scenario: A refusal is graded on its citation, not its tone

- **WHEN** a task asserts `refusal_cites_budget` naming a budget key
- **THEN** the assertion passes only when the run's exit path is `refused` and the named budget key appears in the run's refusal evidence in the transcript

### Requirement: Expected outcome classes make refusal a gradable behavior

Every task SHALL declare exactly one `expectedOutcome`: `edit` when a change satisfying all recorded constraints exists, `refusal` when no such change exists and the correct behavior is to refuse citing the arithmetic, or `flag` when the correct behavior is to surface an inconsistency without resolving it. The suite SHALL contain tasks of all three classes. The report SHALL state correct-refusal rate and false-refusal rate as separate figures.

#### Scenario: Refusing everything scores near zero

- **WHEN** a model refuses on every task in the suite
- **THEN** every `edit` task fails, the false-refusal rate is reported as high, and strict pass rate reflects only the `refusal` tasks

#### Scenario: Never refusing scores near zero on the safety axis

- **WHEN** a model produces an edit for an over-constrained `refusal` task
- **THEN** the task fails, the correct-refusal rate reflects the miss, and the failure is classified `constraint-violation`

### Requirement: Two headline numbers, reported per tier and never blended

A task SHALL be scored `pass` only when every assertion marked `required` passes, and `fail` otherwise. The scorer SHALL also compute weighted partial credit in the range 0 to 1. The report SHALL present strict pass rate and cost per passing task as the headline figures, broken out per tier and per model, and SHALL NOT present partial credit, rubric scores, or any composite as a headline figure.

#### Scenario: Partial progress does not become a passing score

- **WHEN** a run satisfies most assertions but fails one marked `required`
- **THEN** the task verdict is `fail`, and the partial credit value appears only in the detail record

#### Scenario: Tiers are not averaged into one figure silently

- **WHEN** the leaderboard is generated
- **THEN** pass rate appears per tier alongside any overall figure, and the overall figure states the weighting it used

### Requirement: Repeats are mandatory and consistency is reported

The runner SHALL execute each (task, model) pair a configurable number of times, defaulting to 3, and the report SHALL present pass@1 as the mean across repeats, pass^k as the fraction of tasks passing every repeat, and the spread. A report derived from a single repeat SHALL be labeled as such and SHALL NOT be published as a comparison.

#### Scenario: An unreliable model is distinguishable from a reliable one

- **WHEN** model A passes a task on 2 of 3 repeats and model B passes it on 3 of 3
- **THEN** pass@1 and pass^k differ between them, and both figures appear in the leaderboard

### Requirement: Cost accounting is pinned, dated, and segmented by accounting fidelity

Cost SHALL be computed from `pricing.json`, which maps model id to input and output token price with an effective date and a table version. Each result record SHALL store the computed USD figure alongside the price-table version, so a later price change never rewrites a historical record. Direct API models SHALL report exact cost. Self-hosted open-weight runs SHALL report `null` cost with token counts retained. Saved-login CLI routes (`codex`, `claude-code`, `cursor`) SHALL report `null` cost and carry a `pinning: weak` flag, and the report SHALL present them in a separate table stating that model identity and token accounting are not fully controlled.

#### Scenario: A price change does not alter past results

- **WHEN** `pricing.json` is updated with new rates
- **THEN** previously written result records retain their original USD figures and their original price-table version

#### Scenario: Weakly pinned providers are not mixed into the cost column

- **WHEN** the leaderboard includes a saved-login CLI route
- **THEN** it appears in a separate table with `pinning: weak` stated and no USD figure in the shared cost column

### Requirement: Result records are append-only and self-describing

The runner SHALL write one JSON record per run at `results/<date>/<model>/<task-id>/run-<n>.json` containing: `schemaVersion`, `suiteVersion`, task id and manifest hash, fixture hash, model id, provider, model selection source, copperhead version and git commit, `kicad-cli` version, Node version and platform, sandbox baseline commit, repeat index, every assertion outcome with its id and evidence source, the task verdict and partial credit, the full `run-end` stats (exit path, turns used against budget, repair cycles, tokens in and out, duration), computed cost with price-table version, any ablation overrides in force, and the relative path to the preserved transcript. Records SHALL NOT be edited after write.

#### Scenario: A record explains itself without the runner

- **WHEN** a single result record is read in isolation
- **THEN** it names the exact suite version, fixture, model, tool versions, and assertion outcomes needed to interpret and re-score the run

### Requirement: Comparability is enforced mechanically

The report generator SHALL merge results into a shared table only when `schemaVersion`, `suiteVersion`, fixture hash, task manifest hash, and `kicad-cli` major version agree. Records disagreeing on any stamp SHALL render in a separate section labeled as not comparable, and SHALL NOT be averaged into a shared row. Editing any task manifest or the assertion vocabulary SHALL bump `suiteVersion`.

#### Scenario: A task edit does not silently corrupt a history

- **WHEN** a task's assertions are edited and the suite version bumps, and older records for that task exist
- **THEN** the leaderboard shows the new-version results in the main table and the older records in a separate, labeled section

### Requirement: Failures are classified deterministically into a ranked work queue

The scorer SHALL classify every failed run into exactly one category derived from the run-end exit path, the first failed required assertion, and the dominant tool-error category in the transcript, drawn from: `tool-protocol`, `file-revert`, `turn-budget`, `repair-exhausted`, `obligation-open`, `drift-left`, `constraint-violation`, `false-refusal`, `stalled`, `commit-failed`, and `wrong-target`. The classification SHALL use no LLM. The aggregate report SHALL rank categories by frequency multiplied by mean run cost, and SHALL list, per category, the tasks and models where it occurs.

#### Scenario: The report names what to fix next

- **WHEN** a suite run completes with failures
- **THEN** the report prints failure categories ranked by frequency times mean cost, each with the tasks and models affected

#### Scenario: A verified-but-wrong run is not scored as a verification failure

- **WHEN** a run passes ERC and DRC and commits, but the required end-state assertion for the requested change fails
- **THEN** the failure is classified `wrong-target`, not `repair-exhausted` or `turn-budget`

### Requirement: Regression gating and ablation overrides

The runner SHALL accept `--compare <baseline.json>` and exit non-zero when strict pass rate for any tier falls below the baseline, or cost per passing task rises above it, by more than a configured threshold. The runner SHALL accept ablation overrides (prompt variant id, turn budget, tool subset, repair-cycle cap) that are applied to the run and recorded verbatim in the result record, without requiring a duplicated task.

#### Scenario: A prompt change is judged on evidence

- **WHEN** a suite runs with `--prompt-variant <id>` against a stored baseline
- **THEN** the result records carry the variant id, and the comparison reports per-tier pass-rate and cost deltas

#### Scenario: Noise does not fire the gate

- **WHEN** a single repeat flips on one task and the resulting pass-rate delta is within the configured threshold
- **THEN** the comparison exits zero and reports the delta as within threshold

### Requirement: The leaderboard is generated and never hand-edited

`LEADERBOARD.md` SHALL be regenerated from result records, SHALL carry generated-file markers, and SHALL state the suite version, result snapshot date, and record count it summarizes. A check SHALL fail when the committed file differs from a regeneration of it from the committed records.

#### Scenario: A hand edit is caught

- **WHEN** the generated region of `LEADERBOARD.md` is edited by hand and committed
- **THEN** the consistency check fails, naming the file and the divergence

### Requirement: Memorization is measured with mutated variants

For a declared subset of tasks the suite SHALL provide a mutated variant produced by a deterministic transform that renames nets and reference designators, permutes pin assignments, and scales budget numbers while preserving the required reasoning. The report SHALL state the variant gap, the difference in pass rate between original and mutated variants, per model.

#### Scenario: Recall is distinguishable from reasoning

- **WHEN** a model scores markedly lower on mutated variants than on their originals
- **THEN** the report states the variant gap for that model rather than reporting only the original scores

### Requirement: The rubric tier is optional, fenced, and separately reported

A model-judged rubric tier SHALL be disabled by default and enabled only by explicit flag. When enabled, the judge model id and rubric prompt hash SHALL be recorded in the result record, and rubric scores SHALL appear only in a column labeled as model-judged. Rubric scores SHALL NOT contribute to strict pass rate, partial credit, cost per passing task, or the regression gate, and SHALL NOT gate CI.

#### Scenario: The headline stays reproducible when rubric scoring is on

- **WHEN** a suite runs with the rubric tier enabled
- **THEN** strict pass rate and cost per passing task are identical to a run with it disabled, and rubric scores appear only in their own labeled column

### Requirement: Benchmark output is re-checked for secrets before it is written

Before any artifact is written under `results/`, the runner SHALL scan it against the credential pattern set defined in STANDARD.md section 6.1, and SHALL hard-fail the run on a match rather than scrubbing it silently. The set SHALL cover at minimum `sk-` prefixed keys (OpenAI, Anthropic), `AIza` prefixed keys (Google, including Gemini via the `compat` route), HTTP bearer tokens, and npm and GitHub tokens. The `no_secret` assertion and this re-scan SHALL use the same set, and changing it SHALL bump the suite version.

#### Scenario: A planted key fails the run instead of being published

- **WHEN** a candidate result artifact contains a string matching any pattern in the credential pattern set
- **THEN** the runner exits non-zero naming the artifact and the pattern kind matched, and no file is written under `results/`

#### Scenario: A credential copperhead does not redact is still caught

- **GIVEN** a provider whose key format copperhead's write-time redaction does not cover
- **WHEN** that key reaches a candidate result artifact through a preserved transcript or a provider error string
- **THEN** the re-scan hard-fails the run, because the benchmark's set is a superset of copperhead's rather than a copy of it

### Requirement: Cost is bounded by default

The runner SHALL default to the `smoke` suite, which contains only `do`-mode and `check`-mode tasks, and SHALL require an explicit flag for `full`, which adds `create`-mode tasks. Before executing, the runner SHALL print an estimated cost and run count derived from the price table and the tasks selected, and `--dry-run` SHALL print that estimate and the resolved run plan without executing any run. Every task SHALL be bounded by its declared turn cap and wall-clock cap, and a run exceeding either SHALL be terminated and recorded with its exit path rather than left running.

#### Scenario: The expensive suite is opt-in and previewed

- **WHEN** `npm run benchmark -- --suite full --dry-run` is executed
- **THEN** the estimated cost, model matrix, task list, and total run count are printed and no run executes

#### Scenario: A hung run is bounded

- **WHEN** a run exceeds its declared wall-clock cap
- **THEN** it is terminated, a result record is written with the terminal exit path, and the suite continues with the next run
