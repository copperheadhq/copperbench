# add-model-benchmark-suite: Proposal

## Why

Every claim copperhead makes about model behavior is currently anecdotal: "AC-3.1/3.4/3.5/3.6 observed on one model" is the state of the evidence, model choice is a coin flip documented nowhere, and a prompt change is accepted or rejected on the strength of one run somebody remembers. The tool's own thesis is that unverified claims are build failures, so the model layer needs the same treatment the KiCad layer already gets: a fixed task suite, a deterministic oracle, and a number that a stranger can reproduce. The suite is also the only honest way to answer the two questions every user asks first, "which model should I run" and "what will it cost me", and the only way to tell whether a prompt or tool change made the agent better or merely different.

## What Changes

- **A benchmark standard** (`STANDARD.md`) defining the unit of evaluation (a task directory of pure data), the fixed assertion vocabulary, the scoring rules, repeat and comparability requirements, cost accounting, and the result-record format. Tasks are data, not code: adding one changes no runner logic.
- **A task suite** (`tasks/`) seeded from behavior the repo already specifies: the AC-3.x edit and refusal tasks, AC-7.x sync tasks, and `create`-mode briefs from `examples/` including the deliberately unsatisfiable `gnss-lora-tracker` brief as the false-compliance detector. Each task pins a content-hashed fixture and declares its expected outcome class (`edit`, `refusal`, or `flag`).
- **A fixture standard** (`fixtures/FIXTURES.md`) requiring fixtures to be real boards from permissively licensed open-hardware projects, frozen at a pinned upstream commit, with recorded provenance, attribution, scale, and baseline verification reports. Synthetic fixtures flatter every model: they are too small for a proportional diff bound to bind and too clean to exercise the propagation failures that matter.
- **Baseline-relative verification assertions** (`erc_no_new_violations`, `drc_no_new_violations`). A real board in a bare checkout carries library-resolution warnings it cannot resolve, so strict cleanliness is unachievable on it; grading compares against the fixture's recorded baseline and fails only on what a run introduced.
- **A runner** (`npm run benchmark`) that materializes one pristine sandbox repo per (task, model, repeat), runs the configured copperhead command against a chosen model, forces the response cache off, enforces per-task turn and wall-clock caps, and writes one append-only result record per run. It never mutates the copperhead repo.
- **An LLM-free, network-free scorer** holding to the same contract as `copperhead check`: assertions are evaluated only against the sandbox end state, the git diff against the run's baseline commit, and the run's `transcript.jsonl` plus `run-end` stats. Reproducing a published number must not require an API key.
- **Two headline numbers, never blended**: strict pass rate (all required assertions pass) and cost per passing task, reported per tier and per model, with partial credit, surgicality, refusal correctness, and process-discipline metrics carried in the detail record.
- **A failure taxonomy and improvement loop**: every failed run is classified deterministically (exit path, first failed assertion, dominant tool error) into named modes, aggregated into a work queue ranked by frequency times cost, with `--compare <baseline>` failing when pass rate regresses or cost per pass rises past a threshold. Prompt, turn-budget, and tool-subset overrides are recorded in the result record so ablations are first-class.
- **A generated leaderboard** (`LEADERBOARD.md`) built from result records and never hand-edited, with comparability enforced by suite version and fixture hashes so incomparable runs cannot silently merge into one table.
- **An arXiv-style whitepaper** (`paper/`) whose every number is generated from `results/` into `paper/generated/`, with a consistency check that fails the build when prose states a figure no generated macro backs. Released as a living preprint: v1 ships the standard with whatever results exist, and updates as the matrix fills.
- **An optional rubric tier**, off by default, for design-quality questions no assertion can express. It is reported in a separate column, is never part of the headline pass rate, and never gates CI.

## Capabilities

### New Capabilities

- `model-benchmark`: the benchmark standard itself. Task manifest format, fixture pinning and sandbox isolation, the assertion vocabulary and its evidence sources, scoring and partial credit, repeats and consistency reporting, cost accounting, result-record schema, comparability rules, failure taxonomy, regression gate and ablation overrides, generated leaderboard, and the optional rubric tier.
- `benchmark-paper`: the whitepaper pipeline. Generated numbers from result records, the no-unbacked-claim consistency check, living-preprint versioning against suite versions, and artifact-release requirements.

### Modified Capabilities

<!-- none: no product CLI behavior changes. The runner drives the existing `do`/`create`/`sync`/`check` surfaces as a user would, and the scorer reads artifacts those commands already write. -->

## Impact

- **New**: `` (STANDARD.md, `fixtures/` with FIXTURES.md, `schema/`, `tasks/`, `results/`, `pricing.json`, generated LEADERBOARD.md), `scripts/run.ts` and its scorer and report modules, `paper/` (LaTeX sources, `generated/`, build script), `npm run benchmark` and `npm run paper` scripts.
- **Third-party content**: vendored open-hardware KiCad designs under `fixtures/`, restricted to permissive licenses, redistributed unmodified with their license texts and a `NOTICE` entry each. `NOTICE` gains a third-party section.
- **Boundary with `prove-live-acceptance`**: that change's section 4 (the single-brief Telegraph benchmark and its `traps.json`) is subsumed here. Telegraph becomes one task in this suite under the general manifest and assertion format, and its section 4 tasks should be struck when this change lands. Sections 1 to 3 and 5 of that change (nightly live CI, evidence promotion, README self-consistency) are unaffected and remain its own scope.
- **Cost**: benchmark runs consume real API credits. The default `smoke` suite is `do`-mode only and bounded by per-task turn caps; `full` adds `create`-mode and prints a cost estimate before executing. Neither runs in default CI.
- **Secrets**: result records and promoted transcripts pass the existing `sk-[A-Za-z0-9_-]+` redaction, and the runner re-greps every artifact before it is written under `results/` (AC-4.1 extended to benchmark output).
- **Unchanged contracts**: no `src/` behavior changes, no new runtime dependencies for the CLI, and the offline test suite stays LLM-free and network-free.
