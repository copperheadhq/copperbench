# Research: the hardware-benchmark field, and what a full suite requires

**Compiled:** 2026-09-06
**Status:** research input, not normative. Nothing here binds until D24–D30 are accepted into [design.md](design.md).

References surveyed: [SWE-bench](https://www.swebench.com/), [EEBench](https://eebench.org/), [PCB-Bench](https://github.com/digailab/PCB-Bench), plus the surrounding EDA and RTL benchmark literature. Sources are listed in section 10.

---

## 1. Where this repository actually stands

The repository holds a 364-line normative standard, four JSON Schemas, four vendored real boards across three upstream origins, a 23-type closed assertion vocabulary, an 11-category failure taxonomy, 23 numbered design decisions, and a full paper skeleton. It holds **two tasks** and **zero lines of implementation**.

That asymmetry determines everything this document recommends. Most benchmarks in this space are the opposite shape: a large dataset with thin methodology, shipped quickly and graded loosely. copperbench is deep methodology with no dataset and nothing that runs. The design work already done is genuinely ahead of the field — the three-evidence-source rule, offline re-scoring, stamped comparability, and the refusal outcome class are each things the three references either lack or got wrong. None of it is worth anything until something executes.

The competitive situation also moved. EEBench, from the atopile team, published a frontier-model leaderboard on physics-graded electrical engineering tasks and reached Hackaday on 2026-09-05. That is a direct neighbour with a running harness, a published number, and press. copperbench is not competing on being first. It competes on being the suite whose numbers a stranger can recompute, and on covering the half of hardware work EEBench explicitly excludes.

---

## 2. The field, measured

| Axis | SWE-bench | EEBench | PCB-Bench | copperbench |
| --- | --- | --- | --- | --- |
| Domain | Python issue resolution | Analog design from requirements | PCB knowledge and comprehension | Edits to existing real KiCad boards |
| Oracle | Unit tests, `FAIL_TO_PASS` + `PASS_TO_PASS` | SPICE at tolerance corners | BERTScore / Sentence-BERT similarity | ERC, DRC, diff, transcript |
| Grading calls a model | No | No | No, but similarity is not an oracle | No, by rule |
| Third-party reproducible | Yes, Docker harness | **No** — tasks held out | Partly | Yes, offline, no key |
| Instances | 2,294 / 500 verified | Undisclosed | ~4,374 | 2 |
| Headline | Percent resolved | 0.65·technical + 0.35·cost | Accuracy / F1 | Pass rate + cost per pass |
| Refusal measured | No | No | No | **Yes** |
| Layout in scope | — | **Explicitly excluded** | Comprehension only | **Yes, DRC-graded** |
| Contamination stance | Failed; GPL deterrent in Pro | Held out, unpublished | Public, unaddressed | Mutation variants (unbuilt) |

The instance-count column is the one to sit with. Two, against 500 to 4,374.

### 2.1 EEBench

The closest neighbour and the one to study hardest. Agents submit atopile design bundles; the harness builds circuit graphs, interfaces, BOMs, and simulation decks from the submitted source, then runs SPICE at worst-case component-tolerance corners with some tolerances hidden. Tasks are original, authored in 2026, and never published. The leaderboard reports score, cost per task, time per task, output tokens, run count, and standard error. Published scores put Claude Opus 5 at 61.6% and GPT-5.5 at 42.3%; Hackaday reports GPT-6 Astra at 69.3% ±10%.

Three consequences.

1. They have validated the market. Physics-graded hardware evaluation is something people write about.
2. Their held-out design makes their numbers **unauditable by construction**. You contact them to be evaluated, and nobody outside can check a row.
3. **Layout is deliberately out of scope in their V1**, as are edits to existing designs. That is the copperbench thesis sitting vacant.

### 2.2 PCB-Bench

ICLR 2026, from digailab. Roughly 1,800 free-form QA items plus 1,900 single-choice versions, ~500 multimodal image-text problems, and 174 real projects from OSHWHub scored for design comprehension. Zero-shot, no LLM judge, graded with top-1 accuracy, BERTScore, and Sentence-BERT similarity.

It is a knowledge benchmark wearing a design benchmark's name, and it is the clearest cautionary example available. Semantic similarity to a reference answer is not an oracle: a model scores well by producing text that reads like a correct explanation of a placement it never made. The surrounding literature is converging on the same warning — recent multimodal circuit work finds LLM-based evaluators showing near-zero agreement with human raters on hardware schematic evaluation. copperbench's execution grading is strictly stronger and should be presented that way rather than as a peer method. PCB-Bench's transferable asset is its 174-project OSHWHub corpus, as precedent for fixture sourcing at scale.

### 2.3 SWE-bench, and its decay

The template everyone copies. An instance is a real GitHub issue plus its repository at the parent commit; a patch resolves it when designated `FAIL_TO_PASS` tests flip to passing while `PASS_TO_PASS` tests stay green. A three-layer Docker architecture — base, environment, instance — makes it reproducible.

The decay story matters more than the design, because it is the base rate for what happens to a fully public suite.

- SWE-bench Verified exists because the original's tests were weak.
- Later analysis found roughly a third of successful patches involved direct solution leakage, and roughly a third passed on inadequate tests.
- Models identify buggy file paths from issue text alone at 76% on SWE-bench repositories against 53% on unseen ones — a memorization signature.
- Scaffolding differences move scores 10 to 15 points, so the benchmark drifted toward measuring harness engineering rather than model capability.
- OpenAI has publicly stopped evaluating on it.

SWE-bench Pro's answer was structural: 1,865 problems split across public (11 repos), held-out (12 repos), and commercial (18 repos) sets, with **GPL licensing chosen as a legal deterrent against training inclusion**. Frontier scores fall to 23.3%.

Elapsed time from gold standard to abandoned: about two years.

---

## 3. What each reference teaches

| Lesson | Source | Verdict | Why |
| --- | --- | --- | --- |
| Two-sided invariant | SWE-bench | **Adopt** | `F2P` + `P2P` proves the check discriminates. copperbench asserts the end state but never proves the assertion set *failed* at baseline. A real hole; see section 5. |
| Containerized, layered environments | SWE-bench | **Adapt** | The `kicad-cli` version is already in the comparability stamp. Pinning it in an image turns a stamp into an enforcement and removes the largest source of cross-machine ERC/DRC drift. |
| Public / held-out / commercial split | SWE-bench Pro | **Adopt** | The only demonstrated structural answer to contamination. See section 6. |
| Copyleft as training deterrent | SWE-bench Pro | **Reject** | Foreclosed by D20's permissive-only gate. The collision is worth naming: the license policy buys clean redistribution and costs the cheapest contamination defence available. |
| Cost, time, tokens on the leaderboard | EEBench | **Adopt** | Already in the standard as cost per passing task. EEBench confirms buyers care; surface tokens and wall-clock as context columns. |
| Run count and standard error per row | EEBench | **Adopt** | Strictly better presentation than a bare mean. pass@1, pass^k, and spread are already computed; render them as error bars. |
| Blended composite score | EEBench | **Reject** | 0.65·technical + 0.35·cost is exactly the composite index STANDARD.md section 7 forbids. The weights are unfalsifiable, and a model can trade correctness against BOM cost. |
| Held-out tasks, contact-us evaluation | EEBench | **Adapt** | Correct for contamination, fatal for auditability. Take the held-out set; publish the scorer, fixtures, and every record. |
| Scaffold-per-vendor policy | EEBench | **Adapt** | They run each model in its strongest harness. copperbench runs everything inside copperhead, which is cleaner but narrower. Either way scaffold must be a stamped, reported axis. |
| Real-project corpus at scale | PCB-Bench | **Adopt** | 174 OSHWHub projects shows supply exists. CircuitSnips (4,000+ scraped open-licence KiCad circuits) and CERN's 17,000-part CERN-OHL-P library are further sources. |
| Similarity-metric grading | PCB-Bench | **Reject** | BERTScore against a reference answer measures prose resemblance, not design correctness. The exact failure mode this architecture exists to avoid. |
| Benchmarks die; plan for it | SWE-bench | **Adopt** | Verified went from gold standard to abandoned in about two years. A suite with no retirement policy gets defended past its usefulness. |

---

## 4. What "full" has to mean

A scope boundary, or the goal is unfinishable.

| Axis | Oracle available | Status | Recommendation |
| --- | --- | --- | --- |
| Schematic edit and propagation | ERC, netlist queries | Covered, 2 tasks | Core. Scale it. |
| Layout, routing, DRC | DRC, parity | Vocabulary exists, no tasks | **Priority.** EEBench's declared gap. |
| Doc / schematic consistency | Drift check | Covered | Keep. Nobody else measures it. |
| Refusal and over-constraint | Transcript + budget citation | Covered, 1 task; no fixture | Keep. Strongest differentiator. |
| Surgicality | Diff ratio | Covered | Keep. Genuinely novel. |
| Analog behaviour | SPICE | Not covered | Defer to v2. EEBench owns it; competing needs a simulator this repo does not have. |
| BOM, sourcing, cost | Part DB + price | Not covered | Defer. Needs a live parts feed, which breaks offline re-scoring. |
| Greenfield synthesis | Weak | `create` mode specified | Keep narrow. Hardest to grade objectively. |
| DFM, thermal, signal integrity | Specialist tools | Not covered | Out of scope. Say so in the standard. |

**The positioning, in one sentence.** EEBench asks whether a model can design a circuit that works. copperbench should ask whether a model can be trusted to *change a board that already exists* — propagate a rename, respect a budget, refuse when the budget forbids it, and not quietly rewrite three subsystems on the way. That is brownfield engineering, it is where most hardware work happens, and no benchmark currently occupies it.

---

## 5. Bottleneck one: task supply

Two tasks against 500 to 4,374 is not a gap hand-authoring closes. Each existing task carries a hand-calibrated `diff_ratio_max`, a written trap analysis, and per-assertion notes: roughly a day of expert work. Five hundred tasks is two person-years. The suite will never reach useful size on that path, and this — not the missing runner — is the real reason it has sat at two.

SWE-bench's actual insight was never the Docker harness. It was that **real repositories already contain their own task specifications**: an issue states the goal, a merge commit supplies the reference solution, and the test suite supplies the oracle, so instances are mined rather than written. The hardware analogue exists and nobody has taken it.

### 5.1 Mining KiCad history

A permissively licensed KiCad repository with real history is a task generator. For a candidate commit `C` with parent `P`:

1. Take `P`'s tree as the fixture, hashed by the existing frozen algorithm.
2. Derive a candidate assertion set `A` mechanically from the diff `P..C`. Nets added or removed become `net_present` / `net_absent`; symbol changes become `symbol_present`; connectivity changes become `pin_net_equals`. Every one of these is already in the closed vocabulary, so D1 holds and no bespoke checker appears.
3. Apply the **two-sided invariant**: admit the instance only if `A` fails at `P` and passes at `C`. This is `FAIL_TO_PASS` transposed, and it is what makes an assertion set discriminating rather than merely true.
4. Add the regression side: measure ERC and DRC at `P`, and require `C` to introduce nothing new. This is `PASS_TO_PASS`, and `erc_no_new_violations` / `drc_no_new_violations` already implement it.
5. Set `diff_ratio_max` from the reference diff's own size, roughly an order of magnitude above it per D22, which makes per-task calibration mechanical instead of a judgment call.
6. Derive the prompt from the commit message or linked issue, with the *how* stripped. This step needs human review: a KiCad commit message often names the exact net, which leaks the answer.

Filters do most of the work. Reject merge commits, commits touching more than a handful of files, commits with no schematic or board delta, and anything whose parent fails to load under the reference CLI. What survives is a stream of small, real, verified brownfield edits.

### 5.2 Honest limits of mining

This generates `edit` tasks only. `refusal` and `flag` tasks cannot be mined — projects do not commit their over-constraints — and stay hand-authored. That is acceptable and arguably desirable: the outcome classes that keep refusal from being a degenerate strategy are exactly the ones worth expert time. FIXTURES.md section 8 already records that the adversarial tier must be constructed rather than vendored. Budget perhaps 20 to 40 hand-written tasks across `refusal` and `flag`, and let mining carry the `edit` volume.

### 5.3 Fixture supply is not the constraint people assume

CircuitSnips has scraped 4,000+ open-licence KiCad circuits. PCB-Bench used 174 OSHWHub projects. CERN released a 17,000-part library under the permissive CERN-OHL-P. The existing FIXTURES.md vetting procedure — license gate, format gate, baseline measurement, enumerate-and-account per D23 — is the right filter to run over a far larger candidate pool than the eight projects swept on 2026-07-29.

---

## 6. Bottleneck two: contamination

Everything in this repository is public and will be trained on. STANDARD.md section 11.1 anticipates this with mutated variants and a reported variant gap, which is a good mechanism and more than any of the three references ship. It is not sufficient alone, for a reason SWE-bench's history makes concrete: a deterministic transform that renames nets and scales budgets is itself public, so a model trained on both the original and the transform learns the transform. The variant gap detects naive recall, not adapted recall.

There is also a collision inside the existing design worth stating plainly. SWE-bench Pro's cheapest and most effective defence was licensing: GPL repositories as a legal deterrent against training inclusion. D20 makes permissive licensing a **hard gate**, for sound reasons about redistributing agent-modified derivatives. That defence is therefore unavailable here by construction. The permissive gate is correct and should stand — but it means contamination resistance must be bought entirely with set structure.

### 6.1 The three-set split

| Set | Published | Purpose | Reported as |
| --- | --- | --- | --- |
| Public | Tasks, fixtures, assertions, records | Development, contribution, audit of the grading path | Headline, labelled contaminable |
| Held-out | Fixtures and scorer only; tasks withheld | The number that survives contamination | Headline, primary |
| Mutated | Transform published, instances generated | Variant gap per D17 | Diagnostic, never headline |

The critical difference from EEBench: withhold the *tasks*, publish the **scorer, the vocabulary, the fixtures, and every result record**. A third party who cannot see a held-out task can still read the assertion types it used, verify the scorer never touches a network, and recompute the verdict from the preserved sandbox. That preserves the reproduction claim in STANDARD.md section 14, which is the one thing EEBench structurally cannot offer and the strongest reason for this project to exist.

Rotation matters too. Treat the public set as expendable — contaminated on a two-year horizon, on the SWE-bench Verified precedent — promoting a fraction of the held-out set to public each release and mining fresh instances to replace it. That is only affordable because section 5 makes instances cheap to produce.

---

## 7. Proposed decisions D24–D30

Written in design.md's register so they can be pasted there and argued or rejected on the same terms.

**D24: The suite splits into public, held-out, and mutated sets.** Public tasks are fully published and treated as contaminable. Held-out tasks withhold only the task manifests; fixtures, scorer, vocabulary, and result records stay public. Mutated variants are generated from public tasks per D17. The held-out pass rate is the primary headline; the public pass rate is reported beside it and labelled. Alternative: stay fully public and rely on variants alone. Rejected because the variant transform is itself public and learnable, and because SWE-bench Verified's two-year decay is the base rate for a fully public suite.

**D25: Tasks are mined from upstream history under a two-sided invariant, not hand-authored.** An instance is admitted only when its mechanically derived assertion set fails at the parent commit and passes at the child, and the child introduces no new ERC or DRC violation relative to the parent. Hand-authoring is reserved for `refusal` and `flag` tasks, which cannot be mined. Alternative: hand-author everything. Rejected on arithmetic — at roughly a day per task, a useful suite is two person-years, which is why the suite has sat at two tasks.

**D26: Layout is in scope and is the differentiator.** DRC-graded board edits are a first-class task family, not a side effect of schematic tasks. EEBench V1 excludes layout explicitly; PCB-Bench treats it as comprehension. `drc_no_new_violations` and four vendored boards with enumerated baselines make this buildable today.

**D27: No composite score, ever, including a cost-weighted one.** Restates section 7 against a specific live temptation: EEBench's 0.65·technical + 0.35·cost-efficiency is legible and will be asked for. Rejected because the weights are unfalsifiable, because it lets a model trade correctness against BOM cost, and because a blended number cannot be checked by recomputation the way a pass rate can. Two numbers, side by side, per tier.

**D28: The suite ships with a stated retirement policy.** Each published set carries an expiry review date and a documented condition under which it is retired — saturation above a stated pass rate, or a measured variant gap beyond a stated threshold. Benchmarks decay; the ones that do damage are those defended past usefulness. Writing the retirement condition before the first result removes the incentive to argue about it afterwards.

**D29: Scaffold is a stamped, reported axis.** Running everything inside copperhead is the right call and already disclosed as a non-goal boundary. D29 makes the consequence explicit: copperhead version, prompt variant, and tool subset are reported as an axis of the result, and any cross-harness comparison is labelled as such. The SWE-bench experience — 10 to 15 points from scaffolding alone — is what happens when this is left implicit.

**D30: Third-party submissions run the published scorer and submit records, not scores.** A submitter runs the suite and submits append-only result records plus preserved sandboxes. Acceptance is re-scoring those records offline and reproducing the claimed verdicts. No number enters the leaderboard that the maintainers have not recomputed. This is only possible because grading never calls a model, and it is the concrete payoff of that rule.

---

## 8. Build order

[tasks.md](tasks.md) is sound but sequenced for a suite that grows by hand. Reordered for the two bottlenecks above, and for reaching a publishable number soonest.

| Phase | Work | Exit condition |
| --- | --- | --- |
| A — Make it run | Validator (2.8), runner (3.1–3.3), scorer (4.1–4.3), record writing with the credential re-scan (5.1), against the existing two tasks only | Two tasks execute end to end and re-score offline with no key |
| B — Prove the loop | Failure classifier (4.4), `--rescore` (4.5), offline scorer tests (4.6), leaderboard generation (5.4) | A stranger reproduces a leaderboard byte-for-byte from a clean clone (9.1) |
| C — Solve supply | The miner of section 5: candidate filter, mechanical assertion derivation, two-sided invariant check, prompt sanitization with human review | 50+ admitted `edit` instances across the four fixtures |
| D — First number | Smoke suite at 3 repeats across direct-API frontier and cheap tiers (7.1); publish records and leaderboard | A published, reproducible pass rate and cost per pass |
| E — Harden | Three-set split (D24), mutation transform (6.5), retirement policy (D28), submission protocol (D30), `kicad-cli` pinned in an image | Held-out headline alongside public, with a measured variant gap |
| F — Publish | Paper generator (8.2–8.3), claim checker, arXiv bundle (8.5–8.6) | A preprint whose every results-section number is generated |

Phase C differs most from the current plan, and is deliberately placed after the runner: the two-sided invariant needs a working scorer to evaluate, so mining is not buildable until Phase A lands. Everything in Phases A and B is already specified in tasks.md — that work is implementation, not design.

---

## 9. What kills this

- **Continuing to specify instead of implement.** The most likely failure by a wide margin. The standard is finished enough; a twenty-fourth design decision is worth less right now than a working validator. D24–D30 should land in one pass and then be left alone until Phase D produces evidence.
- **Task supply never scales.** If Phase C does not work — if mined instances prove too noisy to admit — the suite stays small and becomes a demonstration rather than a benchmark. Test this early, by hand, before building the miner.
- **ERC and DRC prove a weak oracle.** A model can satisfy every assertion and produce a bad board. STANDARD.md section 1 disclaims fabrication readiness honestly, but under press attention others will drop that disclaimer. Expect it and keep restating it.
- **EEBench expands into layout.** Their V1 excludes it; V2 may not. The defensible position is not the domain but the reproducibility model — published scorer, published records, offline re-scoring, recomputed submissions. That is a commitment they would have to restructure to match.
- **copperhead coupling.** Every number is conditioned on one harness, and the scorer depends on copperhead internals that are explicitly not a stable API. A breaking upstream change is a suite-version event that strands results. The pinning discipline is specified; it has to be enforced in code.

### 9.1 Recommendation

Land D24–D30 into design.md, then stop designing and build Phases A and B against the two tasks that already exist. Before writing the miner, walk the commit history of `antmicro-microphone-board` or `zhiayang-mikoto` by hand and ask of each commit: could a discriminating assertion set have been derived from this diff mechanically? If the answer is yes more than a fifth of the time, Phase C works and the suite can reach useful size. If it is no, the benchmark needs a different supply model, and that is much better learned before the runner is finished than after.

---

## 10. Sources

1. [EEBench](https://eebench.org/), [methodology](https://eebench.org/methodology.html), and [results write-up](https://eebench.org/blog/can-ai-design-circuit-boards-yet/), atopile
2. [SWE-bench](https://www.swebench.com/) and the [evaluation harness reference](https://www.swebench.com/SWE-bench/reference/harness/)
3. [Introducing SWE-bench Verified](https://openai.com/index/introducing-swe-bench-verified/) and [Why we no longer evaluate SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/), OpenAI
4. [SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks?](https://arxiv.org/pdf/2509.16941), Scale AI
5. [SWE-Bench+: Enhanced Coding Benchmark for LLMs](https://arxiv.org/pdf/2410.06992) — solution leakage and weak-test analysis
6. [The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason](https://dl.acm.org/doi/10.1145/3786583.3786882), ICSE-SEIP 2026
7. [PCB-Bench](https://github.com/digailab/PCB-Bench), Li et al., ICLR 2026
8. [MultModLM](https://arxiv.org/html/2606.27666) — near-zero LLM-evaluator agreement with human raters on schematic evaluation
9. [Can AI Now Design PCBs That Just Work?](https://hackaday.com/2026/09/05/can-ai-now-design-pcbs-that-just-work/), Hackaday, 2026-09-05
10. [CircuitSnips](https://hackaday.com/2025/11/28/an-online-repository-for-kicad-schematics/) and [CERN's KiCad component library](https://home.cern/cerns-kicad-component-library-now-open-source) — fixture supply at scale
