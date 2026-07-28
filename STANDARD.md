# copperbench: the copperhead model benchmark standard

**Standard version:** 1.0.0
**Status:** normative for `` and for any published copperhead model comparison.

This document defines how copperhead measures model performance on hardware design tasks. It exists so that a number published here can be reproduced by someone who has this repository, no API key, and no relationship with us.

Two rules generate most of what follows.

**Rule one: grading never calls a model.** Running a task costs money and needs a provider. Grading the result must not. Everything a score depends on is recomputable offline from files the run already wrote.

**Rule two: a task is data.** Adding a task means adding a directory of JSON and markdown. If grading a new task requires new code, the task is out of scope for this standard, because two tasks graded by two bespoke checkers are not comparable and cannot be reviewed without reading the checkers.

---

## 1. Scope and non-claims

copperbench measures how well a model behaves **inside the copperhead harness** on real KiCad projects: whether it makes the requested change, whether the change survives electrical verification, whether it stays inside recorded budgets, whether it refuses when refusal is correct, what that costs, and how surgically it edits.

It does not measure, and no result from it may be presented as measuring:

- **Fabrication readiness.** The oracle establishes that a design is legal and self-consistent. ERC clean, DRC clean, and docs agreeing with the schematic is a floor, not a verdict on the board.
- **Design quality.** Whether a part choice is wise, whether a topology is sensible, whether a layout is good. The optional rubric tier (section 12) gestures at this and is labeled as opinion.
- **Model capability in general.** Results are conditioned on copperhead's prompts, tools, and gates. A model that scores poorly here may do better in a different harness, and that is a finding about the harness as much as the model.
- **`kicad-cli` or copperhead performance.** Wall-clock is recorded for cost context only.

---

## 2. The unit of evaluation

A **task** is a directory:

```
tasks/<task-id>/
  task.json        # what to run, against what, under what limits
  assertions.json  # how it is graded
  README.md        # what this task is testing, and the trap it sets
```

A **run** is one execution of one task by one model, in its own sandbox.
A **repeat** is one of the N runs of the same (task, model) pair.
A **suite** is a named subset of tasks (`smoke`, `full`, or a custom selection).

### 2.1 `task.json`

| Field | Meaning |
| --- | --- |
| `id` | Task identifier, matching the directory name |
| `tier` | `simple`, `medium`, or `hard`, per the reasoning load in [examples/README.md](https://github.com/chouhanindustries/copperhead/blob/main/examples/README.md) |
| `mode` | `do`, `create`, `sync`, or `check`: which copperhead surface the runner drives |
| `fixture.path` | Path under `fixtures/` to the starting project |
| `fixture.sha256` | Content hash of that fixture tree (section 3.2) |
| `request` | The prompt string for `do` and `sync`, or the brief path for `create` |
| `expectedOutcome` | `edit`, `refusal`, or `flag` (section 5) |
| `config` | Overrides written into the sandbox's `.copperhead/config.json`: `budgets`, `maxTurns`, `maxRepairCycles` |
| `caps.turns` | Hard turn cap for the run |
| `caps.wallClockSec` | Hard wall-clock cap; exceeding it terminates the run and records the exit path |
| `tags` | Acceptance criteria and capabilities exercised, for coverage reporting |
| `variantOf` | Present only on mutated variants (section 11), naming the original task id |

### 2.2 `assertions.json`

An array of assertions, each:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier, unique within the task, cited by results and by the paper |
| `type` | One of the closed vocabulary in section 6 |
| `args` | Type-specific arguments |
| `weight` | Positive number, used for partial credit only |
| `required` | When true, failing it fails the task |

An assertion type outside the vocabulary is a **validation error**, not a skipped check. A task whose fixture hash does not match its manifest is refused before any run starts.

---

## 3. Execution

### 3.1 Sandbox isolation

Each (task, model, repeat) gets its own sandbox:

1. Copy the pinned fixture into a temporary directory **outside** the copperhead repository.
2. `git init`, and run the task's `setup.commands` if it declares any.
3. Write `.copperhead/config.json` from the task's `config` block, with `llmCache: false`.
4. Commit everything as the **baseline commit**, record its SHA.
5. Run the task's command against the model under test.
6. Preserve the sandbox and its `.copperhead/runs/<ts>/` on failure, so the run can be re-scored later.

**Setup commands** may only be copperhead subcommands that are contractually LLM-free and network-free, which today means `init`. They run before the baseline commit, so their output is part of the starting state and the diff assertions measure only the graded run. This keeps fixtures minimal: freezing scaffolded docs into a fixture would pin them to whatever the scaffold looked like on the day the fixture was cut, and the scaffold is not what the task is testing. The copperhead version is part of the comparability stamp, so a scaffold change is visible as a version difference rather than a silent shift.

The runner never modifies the copperhead working tree. Repeats never share a sandbox: a repeat that inherited a previous attempt's partial work would measure something other than the task.

### 3.2 Fixture pinning

Fixtures are **real KiCad boards from permissively licensed open-hardware projects**, frozen at a pinned upstream commit. [fixtures/FIXTURES.md](fixtures/FIXTURES.md) is normative for how one is selected, licensed, prepared, and recorded; the essentials here are that a fixture directory holds a `tree/` subdirectory plus metadata, and only `tree/` is copied into a sandbox and only `tree/` is hashed.

A fixture hash is the SHA-256 of a canonical serialization of that tree. Files are sorted by their tree-relative path with a plain byte comparison, and each contributes, in order: the path as UTF-8, a `0x00` byte, its byte length as a decimal string, a `0x00` byte, and its bytes. Directories contribute nothing; empty directories are therefore not preserved by a hash and must not be load-bearing. Compute or verify one with:

```bash
node scripts/hash-fixture.mjs fixtures/<id>/tree
node scripts/hash-fixture.mjs --check fixtures/<id>
```

Fixtures are frozen copies, never symlinks or submodules into another repository, so nothing outside this repo can silently move a benchmark's starting point. Provenance, license, and baseline reports live outside `tree/` so that an agent under test cannot read our bookkeeping or mistake it for the design's own documents.

### 3.3 Mandatory run conditions

Every benchmark run:

- has the response cache **off** (`llmCache: false`), recorded in the result. A cached turn would manufacture determinism the model does not have.
- starts from a **clean committed tree** and never passes `--allow-dirty`. Rollback assertions only mean something when there was a known-good state to return to.
- is bounded by `caps.turns` and `caps.wallClockSec`. A run exceeding either is terminated, recorded with its exit path, and the suite continues.

---

## 4. Evidence: exactly three sources

An assertion may read only:

1. **Sandbox end state.** Files as they stand when the run terminates, read through the read-only s-expression parser and plain document readers.
2. **The diff.** `git diff <baseline-sha>..HEAD` plus the untracked-file set, giving what the run changed and how much.
3. **The transcript.** `.copperhead/runs/<ts>/transcript.jsonl`, including the `run-start` metadata block and the `run-end` stats block.

CLI stdout and stderr are **not** evidence. Output formatting is presentation, free to change without a spec change, so grading against it would score cosmetic edits as behavior regressions. The transcript is the contract surface.

This restriction is what makes rule one hold: all three sources are files on disk, so re-scoring needs no provider and no network.

---

## 5. Outcome classes

Every task declares exactly one expected outcome.

| Class | Meaning | Correct behavior |
| --- | --- | --- |
| `edit` | A change satisfying every recorded constraint exists | Make it, verify it, commit it |
| `refusal` | No change satisfies the recorded budgets | Refuse, citing the budget and the arithmetic, change nothing |
| `flag` | The repository is internally inconsistent in a way that reflects a requirement violation | Surface both sides and the governing budget, resolve nothing |

The suite must contain tasks of all three classes, and this is load-bearing. A model that refuses everything fails every `edit` task. A model that never refuses fails every `refusal` task. Neither degenerate strategy can win, which is what makes the safety axis measurable rather than assertable.

Reports state **correct-refusal rate** (refusal tasks answered with a refusal) and **false-refusal rate** (edit tasks answered with a refusal) separately. They are different failures with different fixes.

---

## 6. The assertion vocabulary

Closed. Adding a type bumps the suite version (section 9).

### End-state assertions

| Type | Args | Passes when |
| --- | --- | --- |
| `erc_no_new_violations` | optional `severity` | No ERC violation appears that is not in the fixture's recorded baseline |
| `drc_no_new_violations` | optional `severity` | No DRC violation appears that is not in the fixture's recorded baseline |
| `erc_clean` | | ERC over the end-state schematic reports no violations |
| `drc_clean` | | DRC over the end-state board reports no violations |
| `check_clean` | | A full `copperhead check` over the sandbox exits 0 |
| `drift_clean` | | The doc-drift check finds no mismatch between docs and the schematic |
| `net_present` | `net` | A net of that name exists in the schematic |
| `net_absent` | `net` | No net of that name exists |
| `symbol_present` | `refdes`, optional `value`, optional `footprint` | A symbol with that refdes exists, matching any given value and footprint |
| `symbol_absent` | `refdes` | No symbol with that refdes exists |
| `pin_net_equals` | `refdes`, `pin`, `net` | That pin connects to that net |
| `doc_row_matches` | `doc`, `key`, `column`, `pattern` | The named table row's column matches the pattern |
| `doc_contains` | `doc`, `pattern` | The document matches the pattern |
| `constraint_registered` | `key`, optional `source`, optional `affects` | `.copperhead/constraints.json` carries that entry |

### Diff assertions

| Type | Args | Passes when |
| --- | --- | --- |
| `files_touched_subset` | `allowed[]` | Every changed path is in the allowed set |
| `file_unchanged` | `path` | That file is byte-identical to baseline |
| `diff_ratio_max` | `path`, `ratio` | Changed lines in that file are at most `ratio` of its baseline line count |
| `commit_count` | `equals` or `max` | The run produced that many commits |
| `rollback_byte_identical` | | The tree is byte-identical to the baseline commit, tracked and untracked alike |
| `no_secret` | | No file matches `sk-[A-Za-z0-9_-]{20,}` |

### Transcript assertions

| Type | Args | Passes when |
| --- | --- | --- |
| `exit_path_in` | `paths[]` | The `run-end` exit path is one of them |
| `refusal_cites_budget` | `budgetKey` | Exit path is `refused` and the refusal evidence names that budget key |
| `transcript_event` | `event`, optional `minCount`, optional `matches` | That event type appears, at least that many times, matching the predicate |

`diff_ratio_max` is how the AC-3.7 surgicality invariant becomes a number rather than a review comment, and its bound is **calibrated per task against the file it constrains** rather than inherited as a constant: 5 percent of a 300-line synthetic schematic is fifteen lines, but 5 percent of an 8,489-line real one is 424, which is enough to rewrite subsystems and still pass. `rollback_byte_identical` is how AC-3.6 becomes measurable. `refusal_cites_budget` grades a refusal on its citation, not its tone, because tone is exactly what a model can produce without doing the arithmetic.

**Prefer the baseline-relative verification assertions on real fixtures.** A real board in a bare checkout carries library-resolution warnings it cannot resolve, so `erc_clean` is unachievable there and would fail every task for reasons unrelated to the model. `erc_no_new_violations` and `drc_no_new_violations` compare the post-run report against the fixture's recorded baseline and pass when nothing new appears; both take a `severity` argument defaulting to `error` and above. The strict forms remain correct for synthetic fixtures and for fixtures whose libraries are fully vendored. See [fixtures/FIXTURES.md](fixtures/FIXTURES.md) section 5.

---

## 7. Scoring

**Task verdict.** `pass` when every `required` assertion passes. `fail` otherwise. There is no third state: a run that errored, timed out, or rolled back is a `fail` with a failure category.

**Partial credit.** The weighted fraction of all assertions passed, in `[0, 1]`. Recorded in the detail record, reported in diagnostics, and **never** a headline number. A headline that rewards partial progress rewards touching files.

**Headline numbers.** Exactly two, always broken out per tier and per model:

1. **Strict pass rate**: passing runs over total runs.
2. **Cost per passing task**: total USD across all runs of that model divided by the number of tasks it passed. Cost per run flatters a model that fails cheaply; cost per pass does not.

Any overall figure across tiers must state its weighting inline. Nothing else is a headline: not partial credit, not rubric scores, not a composite index.

---

## 8. Repeats and consistency

Default **3 repeats** per (task, model). Reported:

- **pass@1**: mean pass rate across repeats, the expected experience of a single user run.
- **pass^k**: fraction of tasks that passed **every** repeat, the reliability figure.
- **spread**: the distribution across repeats.

The gap between pass@1 and pass^k is itself a result. A model that passes two thirds of the time is a different product from one that passes reliably, and a benchmark that reports only the mean hides that difference.

**A single run is not a result.** Any report derived from one repeat must be labeled as such and must not be published as a comparison.

`create`-mode tasks may declare a lower repeat default, since a single run is minutes long and many turns. The repeat count actually used is recorded per result.

---

## 9. Comparability

Every result record carries a comparability stamp:

`schemaVersion`, `suiteVersion`, task manifest hash, fixture hash, copperhead version and git commit, `kicad-cli` version, Node version, platform.

Records merge into a shared table only when `schemaVersion`, `suiteVersion`, task manifest hash, fixture hash, and `kicad-cli` major version all agree. Records that disagree render in a separate, labeled section and are never averaged into a shared row.

**Editing any task manifest, fixture, or the assertion vocabulary bumps `suiteVersion`.** Re-running the whole matrix on every suite edit is unaffordable, which is exactly why segregation has to be mechanical rather than remembered. Because grading is deterministic and offline, preserved sandboxes can be re-scored under a new suite version at no API cost.

### 9.1 Reference environment

Published comparisons state the reference environment: `kicad-cli` version, Node version, OS, and the copperhead commit. A result produced elsewhere is still valid evidence about that environment; it is simply not comparable to a table built on another one.

---

## 10. Cost accounting

Cost comes from `pricing.json`, which carries a `tableVersion` and an `effectiveDate` and maps model id to input and output token price. Every record stores **both** the computed USD figure and the `tableVersion` used, so a later price change never rewrites a historical record.

Providers are segmented by accounting fidelity, and the segments do not share a cost column:

| Segment | Cost | Model pinning |
| --- | --- | --- |
| Direct API (Anthropic, OpenAI), frontier and cheap tiers | Exact, from the price table | Strong: exact model id |
| Open-weight, hosted endpoint | From the endpoint's price entry | Strong if the endpoint pins a revision |
| Open-weight, self-hosted | `null`, tokens retained | Strong, but the honest cost unit is GPU-hours |
| Saved-login CLI (`codex`, `claude-code`, `cursor`) | `null`, `pinning: weak` | Weak: the underlying model may change under the login |

Mixing weakly pinned, uncosted routes into a shared USD column would be the most misleading table this benchmark could produce. They get their own table with the caveat stated inline.

---

## 11. Failure taxonomy and the improvement loop

Every failed run is classified into exactly one category, derived deterministically from the `run-end` exit path, the first failed required assertion, and the dominant tool-error category in the transcript. No LLM participates.

| Category | Meaning |
| --- | --- |
| `tool-protocol` | Malformed or repeatedly rejected tool calls dominated the run |
| `file-revert` | An edit made a KiCad file unloadable and was reverted |
| `turn-budget` | Ran out of turns without finishing |
| `repair-exhausted` | Verification violations persisted past `maxRepairCycles` |
| `obligation-open` | Ended with sync obligations unmet, blocking commit |
| `drift-left` | Committed a state whose docs disagree with the schematic |
| `constraint-violation` | Produced an edit that breaks a recorded budget |
| `false-refusal` | Refused a solvable task |
| `stalled` | Consecutive tool-less turns ended the run |
| `commit-failed` | The final commit failed |
| `wrong-target` | Verification passed and the run committed, but the requested change was not made |

`wrong-target` is the category that matters most and is easiest to lose. A run that passes ERC, passes DRC, and commits cleanly while having done the wrong thing looks like a success from every angle except the end-state assertion. Keeping it distinct from `repair-exhausted` and `turn-budget` is what keeps the report honest about capability rather than plumbing.

**The work queue.** The aggregate report ranks categories by frequency multiplied by mean run cost and lists, per category, the tasks and models where it occurs. That ranking is the prompt and tooling backlog: it says what to fix next and roughly what fixing it is worth.

**Regression gating.** `--compare <baseline.json>` exits non-zero when strict pass rate for any tier falls, or cost per passing task rises, beyond a configured threshold. Per tier rather than in aggregate, so a change that lifts simple tasks while sinking hard ones is visible instead of netted out. The threshold has a floor because repeats are few and the noise is real: a gate that fires on one flipped repeat teaches people to ignore it.

**Ablations.** Prompt variant, turn budget, tool subset, and repair-cycle cap are runner flags recorded in the result, not forked task copies. Varying a knob by duplicating a task would multiply the suite and destroy the same-task-across-conditions comparison that makes an ablation an ablation.

### 11.1 Memorization variants

The briefs, the fixtures, and this standard are public, and they will be trained on. For a declared subset of tasks the suite ships a **mutated variant**: a deterministic transform that renames nets and reference designators, permutes pin assignments, and scales budget numbers, preserving the reasoning while breaking recall. Variants declare `variantOf` and must be solvable by construction.

The **variant gap**, the difference in pass rate between originals and their variants, is reported per model. A model whose score collapses on variants is recalling, and that is a number rather than a suspicion.

---

## 12. The rubric tier (optional, off by default)

Some questions no assertion can express: is this part choice reasonable, is this rationale sound, is this refusal's counter-proposal useful. A model-judged rubric tier exists for them, under strict fencing:

- **Off by default**, enabled only by explicit flag.
- The judge model id and rubric prompt hash are recorded in every affected result.
- Rubric scores appear in their own column, labeled model-judged.
- They contribute nothing to strict pass rate, partial credit, cost per passing task, or the regression gate, and never gate CI.

Enabling the rubric tier must not change a single headline number. That is the test of whether the fence holds.

---

## 13. Result records and the leaderboard

One JSON record per run, at:

```
results/<date>/<model>/<task-id>/run-<n>.json
```

Records are **append-only**: never edited after write. Each is self-describing enough to interpret and re-score in isolation (schema: `schema/result.schema.json`).

Before any artifact is written under `results/`, it is scanned for `sk-[A-Za-z0-9_-]{20,}`. A match **hard-fails the run**; it is not scrubbed silently. AC-4.1 already covers transcripts, and benchmark output is the surface most likely to be published.

`LEADERBOARD.md` is **generated** from those records, carries generated-file markers, and states the suite version, snapshot date, and record count it summarizes. A check fails when the committed file differs from a regeneration from the committed records. The product treats a doc disagreeing with its source as a build failure; the repository's own claims get the same treatment.

---

## 14. Reproducing a published number

Without any API key or network access:

```bash
git clone https://github.com/chouhanindustries/copperhead-benchmarks
cd copperhead-benchmarks && npm install
npm run benchmark -- --rescore results/<date>
```

Re-scoring reads preserved sandboxes and transcripts and recomputes every assertion outcome. Identical outcomes and an identical regenerated leaderboard is the reproduction claim this standard makes. Re-**running** the suite, which does need keys and does cost money, is a separate and weaker claim, because the models are non-deterministic and may have changed under their names.

---

## 15. Adding a task

1. Freeze a fixture under `fixtures/` and hash it.
2. Write `task.json` and `assertions.json` against the schemas in `schema/`.
3. Write `README.md` stating what the task tests and what trap it sets. If the correct outcome is a refusal or a flag, state the arithmetic that makes it so.
4. Run `npm run benchmark -- --validate`.
5. Bump `suiteVersion`.

If grading the task would need a check outside section 6, propose the vocabulary addition rather than writing a bespoke checker. That conversation is the point: it is where an ad-hoc opinion about one task either becomes a general, reviewable rule or gets dropped.
