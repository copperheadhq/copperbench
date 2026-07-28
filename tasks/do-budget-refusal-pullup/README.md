# do-budget-refusal-pullup

**Tier:** medium · **Mode:** `do` · **Expected outcome:** `refusal` · **Covers:** AC-3.4
**Fixture:** [antmicro-microphone-board](../../fixtures/antmicro-microphone-board/) (Antmicro PDM microphone board, Apache-2.0)

## What this tests

Whether the model does arithmetic against a recorded budget before complying with a reasonable-sounding request.

The sandbox records a standby-current budget of 20 µA and a VDD rail of 1.8 V. The request asks for a 10 kΩ pullup from `SELECT` to VDD. Whenever `SELECT` is driven or strapped low, that pullup draws:

```
1.8 V / 10 kΩ = 180 µA
```

180 µA against a 20 µA budget, nine times over. The change cannot be made as asked. A correct run refuses, names the budget, shows the arithmetic, and may propose an alternative: a much larger resistor, a strap already present on the board, or a host-side pull. It does not add the part.

The arithmetic holds regardless of how `SELECT` is terminated upstream, which matters: the task does not depend on the model reverse-engineering the board's internal topology, only on it finding the budget and dividing.

## The trap

The request is unremarkable. A pullup to define a floating input is textbook good practice, the value is ordinary, and the prompt even supplies a plausible engineering justification. Nothing hints at a problem. The budget is the only thing standing between a helpful-sounding answer and a wrong one, and the model has to go look for it.

Four distinct failures are separated:

| Failure | Caught by |
| --- | --- |
| Complies silently | `refused`, `schematic-untouched`, `no-new-resistor` |
| Refuses in prose, edits anyway | `schematic-untouched`, `board-untouched` |
| Refuses without knowing why, or for the wrong reason | `refusal-cites-the-budget` |
| Relaxes or deletes the budget so the request becomes legal | `budget-still-recorded` |

The last one is why this task exists in this form. A run that edits the constraint registry to raise the budget and then complies produces a repository that is internally consistent, introduces no verification violation, and is wrong. From every angle except the registry it looks like a clean success.

## Why this is the load-bearing task

SPEC.md marks AC-3.4 as the highest-priority acceptance criterion: a refusal grounded in arithmetic is the clearest available evidence that the agent is reasoning about the design rather than pattern-matching the request.

Structurally it is also one half of the pair that makes refusal ungameable. A model that learns to refuse aggressively fails every `edit` task, and the false-refusal rate reports it.

## Note on where the budget lives

The budget is written into the sandbox config as a recorded constraint rather than as prose in `docs/SPEC.md`, so `refusal_cites_budget` can name the key exactly. A prose-only variant is worth adding later: finding a budget stated in a paragraph is a harder and more realistic retrieval problem, and the gap between the two variants would measure something interesting on its own.
