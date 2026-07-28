# do-rename-net

**Tier:** simple · **Mode:** `do` · **Expected outcome:** `edit` · **Covers:** AC-3.1, AC-3.7
**Fixture:** [antmicro-microphone-board](../../fixtures/antmicro-microphone-board/) (Antmicro PDM microphone board, Apache-2.0)

## What this tests

A propagating rename on a real board. `DATA` is one of three signal nets on the microphone breakout, alongside `CLK` and `SELECT`. It appears on two labels in the 8,489-line schematic, and on the scaffolded `docs/PINOUT.md`. The correct run renames it everywhere, updates the docs, introduces no new verification violation, and commits once.

## The trap

Three, pulling in different directions.

**Partial propagation.** A model that edits the first occurrence and stops leaves a schematic that still loads and may raise no new error, because an orphaned label is not necessarily one. `old-net-gone` catches it, which is why the assertion is stated as absence of the old name rather than presence of the new one.

**Regeneration.** The cheapest way to guarantee a consistent rename is to rewrite the file. That satisfies every connectivity and document assertion here, and it is exactly what copperhead exists to prevent: a regenerated `.kicad_sch` loses hand placement, UUIDs, and any hope of a reviewable diff. `surgical-schematic-edit` is the only assertion that fails it.

**Over-reach.** `DATA` is a common substring, and the board has neighbouring signal nets. A model doing textual replacement without understanding scope can catch more than it was asked to. `sibling-nets-untouched` is the sentinel.

## Why the diff bound is 1 percent, not 5

AC-3.7 states surgicality as 5 percent of a file's lines. That number was calibrated against a small synthetic schematic where 5 percent is about fifteen lines and therefore binding.

This schematic is 8,489 lines. Five percent is 424 lines: enough to rewrite whole subsystems while passing. A correct rename here touches roughly six lines, so the bound is set at 1 percent, allowing 84. That is generous for a careful run that also tidies a comment, and unreachable for one that regenerates.

The general rule is in [FIXTURES.md](../../fixtures/FIXTURES.md) section 6: a surgicality bound is calibrated per task against the file it constrains, not inherited as a constant.

## Why verification is asserted baseline-relative

This fixture carries 44 ERC warnings and 13 DRC warnings at baseline, all of them library resolution: the design references Antmicro's own symbol and footprint libraries, which are not vendored here. Zero errors, zero unconnected items, zero parity issues.

A strict `erc_clean` assertion would fail every run on this fixture regardless of what the model did. `erc_no_new_violations` compares against the recorded baseline and fails only on something the run introduced, which is the question the task is actually asking.

## Reproducing by hand

```bash
FIX=$(mktemp -d) && cp -r fixtures/antmicro-microphone-board/tree/* "$FIX/"
git -C "$FIX" init -q && npm run dev -- --repo "$FIX" init
git -C "$FIX" add -A && git -C "$FIX" commit -qm baseline
npm run dev -- --repo "$FIX" do "rename net DATA to PDM_DATA"
```

The runner does the same in a temporary sandbox, three times per model, with the response cache off.
