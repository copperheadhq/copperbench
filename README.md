# copperbench

A benchmark for language-model agents on **verified hardware design edits**: real KiCad boards, electrical verification as the oracle, and cost reported alongside pass rate.

It measures models running inside [copperhead](https://github.com/chouhanindustries/copperhead), an agent that edits KiCad projects and verifies its own work with `kicad-cli`. copperhead is a separate repository; this one holds the standard, the fixtures, the tasks, the scorer, the published results, and the paper.

Start with [STANDARD.md](STANDARD.md). It is normative: it defines the task format, the grading vocabulary, the scoring rules, and what makes two numbers comparable.

## The two rules

**Grading never calls a model.** Running a task needs a provider and costs money; grading it must not. Every score is recomputable offline from files the run already wrote, which is what makes a published number auditable by someone who does not trust us.

**A task is data.** Adding one means adding JSON and markdown. If grading a task would need new code, the check belongs in the shared vocabulary or nowhere, because two tasks graded by two bespoke checkers are not comparable.

## Layout

| Path | What it is |
| --- | --- |
| [STANDARD.md](STANDARD.md) | The standard. Read this first. |
| [fixtures/FIXTURES.md](fixtures/FIXTURES.md) | The fixture standard: selection, license policy, preparation, candidate shortlist |
| `fixtures/` | Real open-hardware KiCad boards, frozen at a pinned upstream commit and content-hashed |
| `schema/` | JSON Schemas for the task manifest, assertion list, fixture manifest, and result record |
| `tasks/` | One directory per task: `task.json`, `assertions.json`, `README.md` |
| `pricing.json` | Dated, versioned price table for cost accounting |
| `results/` | Append-only result records, one JSON per run |
| `LEADERBOARD.md` | Generated from `results/`, never hand-edited |
| [paper/](paper/) | The arXiv-style whitepaper, whose every number is generated from `results/` |
| [openspec/](openspec/changes/add-model-benchmark-suite/) | Planning artifacts: proposal, design decisions, delta specs, task list |

## Relationship to copperhead

The benchmark asserts invariants that copperhead's spec defines: exit-path names, transcript event names, and the surgicality bound in its AC-3.7. Those live in [copperhead's SPEC.md](https://github.com/chouhanindustries/copperhead/blob/main/openspec/specs/SPEC.md).

Because the two repositories version independently, every result record stamps the copperhead version and commit it ran against, and a mismatch segregates results rather than merging them into a shared table. The scorer's dependency on copperhead internals (the read-only s-expression parser, the report normalizer, the drift check) is deliberately narrow and confined to the three evidence adapters described in STANDARD.md section 4. A change in those internals is a suite-version event.

## Status

The standard, schemas, fixture policy, the first real fixture, and two worked tasks are in place. The runner, scorer, and report generator are specified but not yet implemented; see the [task list](openspec/changes/add-model-benchmark-suite/tasks.md).

Worked examples to read before writing a task:

- [tasks/do-rename-net/](tasks/do-rename-net/) shows an `edit` task, and how surgicality is bounded rather than described.
- [tasks/do-budget-refusal-pullup/](tasks/do-budget-refusal-pullup/) shows a `refusal` task, and how a refusal is graded on its citation rather than its tone.

## Verifying a fixture today

```bash
npm run hash -- --check fixtures/antmicro-microphone-board
```

No provider credential, no network, no build step.

## License

Apache-2.0. Vendored third-party hardware designs under `fixtures/` keep their own licenses and are listed in [NOTICE](NOTICE).
