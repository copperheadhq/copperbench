# benchmark-paper — delta spec

## ADDED Requirements

### Requirement: Every reported number in the paper is generated from result records

The paper build SHALL generate `paper/generated/macros.tex` and `paper/generated/tables.tex` from a named snapshot of `results/`, and the paper's prose SHALL state quantitative results only through those generated macros. Regenerating from the same snapshot SHALL produce byte-identical generated files.

#### Scenario: A results table cannot drift from its evidence

- **WHEN** result records are added and the paper is rebuilt against the new snapshot
- **THEN** every table and every in-text figure updates from the records with no manual edit to the prose

#### Scenario: Generation is deterministic

- **WHEN** the generator runs twice over the same snapshot
- **THEN** the generated files are byte-identical

### Requirement: An unbacked numeric claim fails the paper build

A checker SHALL scan the results-bearing sections of the paper source and SHALL fail the build when a quantitative claim appears as a literal numeral rather than through a generated macro. The failure message SHALL name the file, the line, and the offending text.

#### Scenario: A hand-typed result number is caught

- **WHEN** a pass rate is written as a literal numeral in the results section
- **THEN** the paper build exits non-zero naming the file, line, and text, and no PDF is produced

### Requirement: The paper records the provenance of what it describes

The paper SHALL state, in its experimental setup section and in generated form, the suite version, the result snapshot identifier and hash, the record count, the model matrix segments covered, the repeat count, and the `kicad-cli` and copperhead versions used. A paper revision SHALL be tied to exactly one result snapshot.

#### Scenario: A reader can locate the exact evidence

- **WHEN** a reader takes the snapshot identifier from the paper
- **THEN** the corresponding records in `results/` are identifiable, and re-scoring them reproduces the reported figures

### Requirement: The living preprint states the limits of its own matrix

Each revision SHALL state the size and composition of its evaluation matrix in the abstract, SHALL label segments that are absent or thin rather than omitting them, and SHALL carry a threats-to-validity section covering at minimum: oracle incompleteness (passing ERC, DRC, and drift checks is not a fabrication-readiness claim), contamination of public briefs and fixtures with the measured variant gap, repeat count and non-determinism, weak model pinning and absent cost figures for saved-login routes, and the subjectivity of any rubric-tier result reported.

#### Scenario: A thin matrix is disclosed, not hidden

- **WHEN** a revision covers only part of the intended model matrix
- **THEN** the abstract states the covered segments and the missing ones, and the results tables label the absent segments explicitly

#### Scenario: The oracle's limits are stated

- **WHEN** the paper reports pass rates
- **THEN** the threats section states that the oracle establishes legality and self-consistency, not manufacturability or design quality

### Requirement: The paper is reproducible from released artifacts

The paper SHALL include a reproducibility section giving the exact commands to run the suite and to regenerate the tables, the pinned tool versions, and the license and location of the released task suite, result records, and runner. Scoring reproduction SHALL be stated as requiring no provider credential, consistent with the deterministic scorer.

#### Scenario: Re-scoring needs no key

- **WHEN** a reader follows the reproducibility section to re-score released records
- **THEN** the documented commands complete without any API key or network access and reproduce the published figures
