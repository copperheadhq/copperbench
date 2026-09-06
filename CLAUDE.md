# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

copperbench: a benchmark measuring language models on verified KiCad hardware edits, run inside [copperhead](https://github.com/chouhanindustries/copperhead) (a separate repo). This repo holds the standard, fixtures, tasks, scorer, results, and paper — not the agent.

[STANDARD.md](STANDARD.md) is normative. It defines the task format, the assertion vocabulary, scoring, and comparability. Read it before changing anything under [tasks/](tasks/), [schema/](schema/), or [fixtures/](fixtures/); most design questions are already answered there or in [openspec/changes/add-model-benchmark-suite/design.md](openspec/changes/add-model-benchmark-suite/design.md) as numbered decisions (D1–D22), which is the place to look for *why* rather than *what*.

## Current state

A working end-to-end loop, minus the agent. Validation, sandbox materialization, the three evidence adapters, 15 of the 23 assertion types, verdict computation, result-record writing, and `--rescore` are implemented and tested offline. `results/` holds real records from the provider-free run modes.

**Not implemented:** `--mode agent` (needs a provider credential), the eight assertion types backed by `kicad-cli`, the aggregate report, `LEADERBOARD.md`, and the paper generator.

**The run modes.** `--mode noop` does nothing and every discriminating assertion must fail; `--mode gold` applies a reference solution from `test/gold/<task-id>.json` and every evaluable assertion must pass. Together they are the two-sided invariant: an assertion set that passes on a no-op grades nothing, and one that fails on a correct solution is not gradable. Both run at zero provider cost, so a task can be proven to discriminate before a credential is spent.

**`unevaluable` is a third assertion outcome, and `unscoreable` a third verdict.** When an assertion's evidence is unavailable — ERC without `kicad-cli`, say — it is never recorded as a pass, and a run with an unevaluable *required* assertion is `unscoreable` rather than `pass` or `fail`. Silently passing an unrunnable required check is the one failure mode that would make every published number meaningless. [openspec/changes/add-model-benchmark-suite/tasks.md](openspec/changes/add-model-benchmark-suite/tasks.md) is the authoritative checklist of what is done and what is next; keep its checkboxes current when landing work.

`package.json` deliberately omits `paper:generate` and `paper:check-claims` — absent rather than present and broken. Add each only when its implementation lands. `benchmark -- --validate` delegates to `validateSuite()` rather than reimplementing it, and `benchmark -- --rescore` replaces the separately planned `rescore` script.

## Commands

```bash
npm install                                              # nothing is installed by default
npm run hash -- fixtures/<id>/tree                        # compute a fixture tree hash
npm run hash -- --check fixtures/<id>                     # verify tree against fixture.json
npm run validate                                          # validate every task and fixture (add --json for machine output)
npm run benchmark -- --mode gold                          # run reference solutions; every evaluable assertion must pass
npm run benchmark -- --mode noop                          # run nothing; every discriminating assertion must fail
npm run benchmark -- --rescore results                    # reproduce recorded verdicts offline
npm run benchmark -- --dry-run                            # plan and cost estimate, executes nothing
npm test                                                  # vitest, offline: no provider, no network
npm run typecheck                                         # tsc --noEmit
npm run lint:md                                           # markdownlint-cli2 over all docs
npm run paper                                             # paper/main.pdf + paper/render/page-NN.png
npm run paper:pdf                                         # PDF only, no page render
```

Every paper build renders page images alongside the PDF ([scripts/build-paper.mjs](scripts/build-paper.mjs)), so a revision can be inspected without a viewer. Both outputs are derived and gitignored. The build prefers `latexmk` and falls back to `pdflatex`/`bibtex`; page rendering needs `pdftoppm`.

Verification needs no provider credential, no network, and no build step. `ajv` is the single non-dev-tooling dependency, used only to compile the JSON Schemas at validation time; `scripts/hash-fixture.mjs` stays dependency-free so a third party can verify a published hash without installing anything, and `test/hash.test.ts` asserts it never diverges from the TypeScript promotion.

## The two rules everything derives from

**Grading never calls a model.** Running a task costs money and needs a provider; grading it must not. Anything a score depends on must be recomputable offline from files the run already wrote. Any code on the scorer path that could reach an LLM or the network is a design violation, not an optimization question.

**A task is data.** A task is `tasks/<id>/{task.json,assertions.json,README.md}` and nothing else. The runner must have no per-task branches. If grading a new task would need a check outside the closed assertion vocabulary in STANDARD.md section 6, propose a vocabulary addition — never a bespoke checker. An unknown assertion type is a validation error, not a skipped check.

## Architecture invariants

**Three evidence sources, exactly.** Assertions may read only: (1) the sandbox end state via copperhead's read-only s-expression parser and doc readers, (2) `git diff <baseline-sha>..HEAD` plus untracked files, (3) `.copperhead/runs/<ts>/transcript.jsonl` including `run-start`/`run-end`. CLI stdout and stderr are **not** evidence — output formatting is presentation and may change freely; the transcript is the contract surface.

**Sandbox per (task, model, repeat).** Fixture `tree/` copied to a temp dir outside any repo, `git init`, setup commands (only LLM-free copperhead subcommands, today just `init`), baseline commit, then the run. Cache off (`llmCache: false`), never `--allow-dirty`, repeats never share a sandbox.

**Fixture hashing is a frozen algorithm.** [scripts/hash-fixture.mjs](scripts/hash-fixture.mjs) is standalone and dependency-free on purpose so a third party can verify a published hash without installing this project. When the runner promotes it to TypeScript, the algorithm must not change. Only `tree/` is copied into a sandbox and only `tree/` is hashed; provenance, license, and baseline reports live outside it so the agent under test cannot read our bookkeeping.

**Fixtures are real boards, vendored under a hard license gate.** Permissive licenses only (see [fixtures/FIXTURES.md](fixtures/FIXTURES.md) section 3), frozen at a pinned upstream commit, never symlinks or submodules, with verbatim `LICENSE`, a `NOTICE` entry, and zero baseline ERC/DRC *errors*. Real boards carry library-resolution warnings, so tasks assert `erc_no_new_violations` / `drc_no_new_violations` against the recorded baseline rather than `erc_clean`.

**Surgicality bounds are calibrated per task.** `diff_ratio_max` is sized against a correct minimal edit for the specific file it constrains — roughly an order of magnitude above it — with the reasoning stated in the task README. Do not inherit AC-3.7's nominal 5 percent: on the 8,489-line real schematic that permits 424 lines, enough to rewrite subsystems and still pass.

**Two headline numbers only:** strict pass rate and cost per passing task, per tier and per model. Partial credit, rubric scores, and composite indices are never headlines. The rubric tier is off by default and must not move a single headline number.

**Comparability is stamped, not assumed.** Every result record carries `schemaVersion`, `suiteVersion`, task manifest hash, fixture hash, copperhead version/commit, `kicad-cli` version, Node version, platform. Mismatched records segregate into a labeled section instead of averaging into a shared row. **Editing any task manifest, fixture, or the assertion vocabulary bumps `suiteVersion`.**

**Generated files are never hand-edited.** `LEADERBOARD.md` is regenerated from `results/`; `paper/generated/*.tex` is emitted from a result snapshot; `site/dist/` is built by Astro from [site/](site/), reading the repository through [scripts/lib/site-facts.ts](scripts/lib/site-facts.ts), and published by CI. All three read `results/` through one aggregation, [scripts/lib/leaderboard.ts](scripts/lib/leaderboard.ts), so a number cannot differ between surfaces. A committed file differing from a regeneration is a build failure — the same anti-drift stance copperhead takes toward docs, applied to this repo's own claims. `results/` records are append-only and never edited after write.

**No hand-typed numbers in the paper's results-bearing sections** (5–8). Quantities appear only through generated macros or tables; a literal numeral there fails the claim check. The checked-in `paper/generated/` placeholders use `\providecommand` so the skeleton reads as ungenerated rather than as a plausible zero.

## Conventions

- Node ≥ 20, ESM (`"type": "module"`), no runtime dependencies.
- Prose is dense and argued: task and fixture READMEs state the trap being set and the arithmetic behind it, and assertion `note` fields explain what failure the check catches. Match that register rather than writing summary boilerplate.
- Planning artifacts live in [openspec/changes/](openspec/changes/) (proposal, design, delta specs, tasks). Substantive scope or design changes belong there first.
- copperhead's `src/` internals used by the scorer (sexp parser, report normalizer, drift check) are **not** a stable public API. Pin an exact version, stamp it in every record, and treat an internals change as a suite-version event.
