# copperbench whitepaper

arXiv-style preprint reporting the copperhead model benchmark. Living document: each revision is bound to exactly one result snapshot, and every number in it is generated from that snapshot.

## The rule that makes this worth doing

**No hand-typed numbers in results-bearing sections.** Sections 5 through 8 may state a quantity only through a generated macro from `generated/macros.tex` or a generated table from `generated/tables.tex`. A literal numeral in those sections fails the build.

copperhead's whole argument is that a document disagreeing with the thing it describes is a build failure. A paper whose tables can drift from the records that produced them would undercut the argument it is making.

## Building

```bash
npm run paper          # main.pdf, then render/page-NN.png
npm run paper:pdf      # PDF only
```

Every build emits both: `main.pdf` to read or submit, and `render/page-NN.png` so a revision can be eyeballed without a viewer and diffed page by page. Both are derived and gitignored; `generated/` is the only committed emission, and it comes from a result snapshot rather than from the LaTeX run.

The build prefers `latexmk` and falls back to `pdflatex`/`bibtex` directly when it is absent, because a missing convenience wrapper should not be why a paper cannot be built. Page rendering needs `pdftoppm` (poppler-utils) and is skipped with a warning when it is missing.

The checked-in `generated/` files are placeholders using `\providecommand`, so the skeleton compiles before the first live matrix and reads as ungenerated rather than as a plausible-looking zero. A real generation overwrites them.

## Regenerating numbers

```bash
npm run paper:generate -- --snapshot results/<date>   # not yet implemented
npm run paper                                                    # not yet implemented
```

Both land with tasks 8.2 and 8.3 of [add-model-benchmark-suite](../openspec/changes/add-model-benchmark-suite/tasks.md). Until then, `latexmk` directly is the build.

## Layout

| Path | What it is |
| --- | --- |
| `main.tex` | Document skeleton, preamble, section includes |
| `sections/` | One file per section; results sections are wired to generated tables |
| `generated/` | Emitted from a result snapshot. Never edited by hand. |
| `references.bib` | Bibliography. Every entry is marked `VERIFY` pending a check against the canonical record. |

## Status

| Part | State |
| --- | --- |
| Sections 1 to 5, 9 to 11, conclusion | Drafted from the standard |
| Sections 6 to 8 (results, failures, ablations) | Skeleton wired to generated tables, awaiting the first live matrix |
| Appendices | Generated from the task suite and assertion schema, not yet implemented |
| Bibliography | Needs verification before submission |
| Generator and claim checker | Specified, not implemented |

## Before submission

- Verify every bibliography entry against its canonical record and drop the `VERIFY` notes.
- Bind a real snapshot and confirm the abstract states matrix size and absent segments honestly.
- Confirm the claim checker passes, meaning no results-bearing section carries a literal numeral.
- Choose arXiv categories: cs.SE primary, cs.AR and cs.LG cross-list.
