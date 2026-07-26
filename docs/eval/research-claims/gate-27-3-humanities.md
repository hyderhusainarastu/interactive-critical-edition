# Phase 27.3 — Humanities Judge Promotion Gate

**Script:** `scripts/research/judge-eval-27-3-humanities-gate.mts` · **Raw data:** `gate-27-3-humanities.raw.json` · **Run:** 2026-07-26 · **Cost: $0.211806** (of a $0.60 hard budget — see cost tally at bottom)

## Ratification applied

The owner reviewed the full packet (`docs/eval/research-claims/humanities-ratification-packet.md`) on 2026-07-26 and **approved all records as labeled**, including the 11 same-work-flagged pairs. Every record in `relationshipPairs.humanities.json` (36), `retrievalNegatives.json` (22), and `claimNature.json` (65) now carries `"provisional": false`. See `packages/claims/src/eval/gold/RATIFICATION.md` for the full ratification record and `PROVENANCE.md` for the updated status note. No label, category, `mechanismDraft`, or claim text was edited — only the `provisional` flag flipped, verified byte-for-byte identical otherwise (`git diff` shows exactly one changed line per record, nothing else). The 11 nuance records' `mechanismDraft` values are now **gold mechanisms**, eligible to gate `MECHANISM_ACCURACY_MIN`.

This script fails loudly (throws before making any paid call) if any humanities gold record is still `provisional: true` — it only ever scores against ratified data.

## What this measures and how (methodology note)

The task brief cited Phase 25.5c's own "PROVISIONAL humanities baseline" (macroF1 0.795/kappa 0.688/contradictionRecall 1.000) as "the BASELINE… now valid gold." Tracing that number to its source code (`scripts/research/judge-eval-output-mode.mts`'s `main()`, the `humanitiesBaseline` block) shows it was actually produced with **`branch: "humanities"`** — i.e. it already used the discipline-aware preamble (and offered the model the optional `mechanism` field), just without scoring mechanism accuracy (that scoring didn't exist yet). It was not a "base/generic-judge" measurement.

To give `HUMANITIES_BRANCH_DELTA_MIN` ("branch beats base") a real, non-degenerate comparison rather than comparing a config against itself, this script runs **three** stages:

- **Stage A — "base"**: `buildJudgePrompt` with `branch: "empirical"` (the plain, discipline-unaware judge — no preclassification instruction, no mechanism field) applied to the ratified 36-pair humanities set. This is a genuinely new measurement, not previously reported anywhere.
- **Stage B — "humanities branch"**: `buildJudgePrompt` with `branch: "humanities"` applied to the same 36-pair set. This reproduces 25.5c's exact historical config on now-ratified data, scored for valence **and** (new) mechanism accuracy.
- **Stage C — "empirical regression check"**: the same `branch: "humanities"` config applied to the 42-pair empirical set, compared against the certified 0.752 (raw-text haiku, baseline prompt, `spike-25-5c-output-mode.md` Cell 2).

All three stages use the **production judge config** per the moderator's 2026-07-26 decision: `claude-haiku-4-5-20251001`, the BASELINE prompt (`buildJudgePrompt` — every v2 addition off), called via `AnthropicTextJsonClient` (raw-text-validated mode — parse, validate, retry up to `MAX_RETRIES`, typed failure on exhaustion, never fabricates). This is the actual production client (`packages/ai-adapters/src/anthropicTextJson.ts`), not the eval-only fence-strip helper `judge-eval-output-mode.mts` used before that client existed.

**Flagging the terminology gap rather than silently resolving it:** if the moderator's intent for "(a) BASELINE" was actually "reproduce 25.5c's own config, no new base measurement," then Stage B alone is the relevant "BASELINE… confirm consistency" step (it lands at macroF1 0.804/kappa 0.693/contradictionRecall 1.000 — reasonably consistent with 25.5c's provisional 0.795/0.688/1.000, small variance expected from LLM stochasticity), and Stage A is extra, informative context. Either reading is reported in full below so the moderator can weight it either way — see Concerns.

## Headline result: 3 of 4 floors fail; outright pass = NO

| Floor | Threshold | Measured | Pass? |
|---|---|---|---|
| `HUMANITIES_BRANCH_DELTA_MIN` (branch macroF1 − base macroF1) | ≥ 0.05 | 0.804 − 0.771 = **0.033** | ❌ |
| `MECHANISM_ACCURACY_MIN` | ≥ 0.60 | **4/11 = 0.364** | ❌ |
| `EMPIRICAL_REGRESSION_MAX` (certified 0.752 − measured) | ≤ 0.02 | 0.752 − 0.720 = **0.032** | ❌ |
| `CLASS_F1_FLOOR` (no class F1 < 0.4, Stage B or Stage C) | every class ≥ 0.40 | lowest class F1 = 0.571 (Stage C nuance) | ✅ |

**Outright pass: NO.** Per the task's own instruction, nothing is self-decided here beyond reporting — no migration is drafted (see Step 3 below).

### The IMPORTANT nuance clause, checked against what actually happened

The task's own nuance clause anticipated exactly the delta-floor situation found here — "the base already scores 0.795 on humanities… if the branch does NOT beat it by 0.05 but mechanism accuracy clears its floor and nothing regresses, report that configuration honestly." **That narrow escape hatch does not apply as written**, because it isn't just the delta floor that misses: mechanism accuracy (0.364) and the empirical-regression check (0.032 drop, over the 0.02 ceiling) **also** fail, independently of the delta question. This is a broader shortfall than the single-floor case the nuance clause was written for.

## Stage A — base (`branch: "empirical"`) on humanities set

Pooled macroF1 **0.771**, kappa **0.653**, contradiction recall **1.000**. n=36, 0 failed, 0 skipped-budget.

### Confusion matrix (rows = gold, cols = predicted)

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (7) | 7 | 0 | 0 | 0 |
| support (8) | 0 | 4 | 4 | 0 |
| nuance (15) | 4 | 1 | 10 | 0 |
| unrelated (6) | 0 | 0 | 0 | 6 |

### Per-class P/R/F1

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| contradiction | 0.636 | 1.000 | 0.778 | 7 |
| support | 0.800 | 0.500 | 0.615 | 8 |
| nuance | 0.714 | 0.667 | 0.690 | 15 |
| unrelated | 1.000 | 1.000 | 1.000 | 6 |

No class below `CLASS_F1_FLOOR` (0.4).

## Stage B — humanities branch (`branch: "humanities"`) on humanities set

Pooled macroF1 **0.804**, kappa **0.693**, contradiction recall **1.000**. n=36, 0 failed, 0 skipped-budget.

**Consistency check against Phase 25.5c's provisional number (0.795/0.688/1.000):** macroF1 +0.009, kappa +0.005, contradiction recall unchanged — consistent within the range expected from LLM sampling variance on a now-identical config over now-ratified (previously identically-worded, provisional) data.

### Confusion matrix

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (7) | 7 | 0 | 0 | 0 |
| support (8) | 0 | 5 | 3 | 0 |
| nuance (15) | 2 | 3 | 10 | 0 |
| unrelated (6) | 0 | 0 | 0 | 6 |

### Per-class P/R/F1

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| contradiction | 0.778 | 1.000 | 0.875 | 7 |
| support | 0.625 | 0.625 | 0.625 | 8 |
| nuance | 0.769 | 0.667 | 0.714 | 15 |
| unrelated | 1.000 | 1.000 | 1.000 | 6 |

No class below `CLASS_F1_FLOOR` (0.4).

## Mechanism accuracy (Stage B, the 11 mechanism-bearing records)

**4/11 = 0.364**, well under `MECHANISM_ACCURACY_MIN` (0.60).

| id | gold mechanism | predicted mechanism | correct? |
|---|---|---|---|
| hum_016 | different_scope_conditions | interprets_differently | ❌ |
| hum_017 | different_scope_conditions | interprets_differently | ❌ |
| hum_018 | different_definition | interprets_differently | ❌ |
| hum_019 | interprets_differently | interprets_differently | ✅ |
| hum_020 | different_definition | interprets_differently | ❌ |
| hum_021 | different_definition | (none — relationship not nuance/contradiction) | ❌ |
| hum_022 | different_scope_conditions | different_scope_conditions | ✅ |
| hum_026 | different_scope_conditions | interprets_differently | ❌ |
| hum_027 | different_scope_conditions | interprets_differently | ❌ |
| hum_028 | different_scope_conditions | different_scope_conditions | ✅ |
| hum_029 | different_scope_conditions | different_scope_conditions | ✅ |

**Failure mode is systematic, not random:** the judge over-predicts `interprets_differently` as a catch-all — 6 of the 7 misses are `different_scope_conditions` or `different_definition` mislabeled as `interprets_differently`. `hum_021` is the one case where the model's predicted *relationship* itself wasn't `nuance`/`contradiction` (so `validateMechanismForValence` correctly dropped any mechanism to null, per `taxonomy.ts`'s design — a mechanism can never be reported for a valence it can't legally explain). Stage-2 mechanism labeling is a materially harder task than valence classification at this model tier — this is a distinct capability gap from anything the valence gates measure.

## Stage C — humanities-branch config on empirical set (regression check)

Pooled macroF1 **0.720** vs. the certified **0.752** (raw-text haiku, baseline prompt, `spike-25-5c-output-mode.md` Cell 2) — a **0.032 drop**, over `EMPIRICAL_REGRESSION_MAX` (0.02). Kappa 0.619, contradiction recall 1.000. n=42, 0 failed, 0 skipped-budget.

**Confirms the task's own "measure, don't assume" instruction was warranted** — turning on the humanities-branch code path (discipline preamble + optional mechanism field) for empirical-domain data is not free: it measurably moved several `support`/`nuance`/`unrelated` calls around relative to the certified branch:"empirical" baseline, not just adding inert unused instructions.

### Confusion matrix

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 9 | 0 | 0 | 0 |
| support (12) | 1 | 8 | 2 | 1 |
| nuance (12) | 3 | 3 | 6 | 0 |
| unrelated (9) | 0 | 1 | 1 | 7 |

### Per-class P/R/F1

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| contradiction | 0.692 | 1.000 | 0.818 | 9 |
| support | 0.667 | 0.667 | 0.667 | 12 |
| nuance | 0.667 | 0.500 | 0.571 | 12 |
| unrelated | 0.875 | 0.778 | 0.824 | 9 |

Lowest class F1 here (nuance, 0.571) is still comfortably above `CLASS_F1_FLOOR` (0.4), so the class-floor gate passes even though the pooled-macroF1 regression gate does not.

## Cost tally

| Stage | Config | Calls | Cost (USD) |
|---|---|---|---|
| Stage A | claude-haiku-4-5 / raw-text-validated / branch:empirical / humanities set | 36 | $0.062794 |
| Stage B | claude-haiku-4-5 / raw-text-validated / branch:humanities / humanities set | 36 | $0.069925 |
| Stage C | claude-haiku-4-5 / raw-text-validated / branch:humanities / empirical set | 42 | $0.079087 |
| **Total** | | **114 calls** | **$0.211806** |

Well within the $0.60 hard budget (headroom ≈ $0.388). Zero calls failed or were skipped for budget across all three stages.

## Gate verdict against all four floors

| Floor | Result | Pass? |
|---|---|---|
| `HUMANITIES_BRANCH_DELTA_MIN` — branch beats base by ≥ 0.05 | 0.033 | ❌ |
| `MECHANISM_ACCURACY_MIN` — mechanism accuracy ≥ 0.60 | 0.364 | ❌ |
| `EMPIRICAL_REGRESSION_MAX` — empirical regression ≤ 0.02 | 0.032 | ❌ |
| `CLASS_F1_FLOOR` — no class F1 < 0.40 | 0.571 (worst, Stage C nuance) | ✅ |

**`outrightPass = false`.** Per the task's Step 3 instruction ("IF AND ONLY IF all four floors pass outright… If the gate does NOT pass outright, draft nothing — report only"), **no migration was drafted.** `packages/claims/src/eval/gold/*.json` stays ratified (Step 1's work is unconditional and independent of the gate outcome); `packages/db/src/schema.ts`, `taxonomy.ts`, and no new `drizzle/0046_*.sql` file were touched.

## Concerns for the moderator

1. **The "base" vs. "branch" definition question (see Methodology above) is a real, unresolved ambiguity, not a rounding error, and it does not change the outright-fail verdict either way.** Under this report's reading (Stage A branch:"empirical" = base, Stage B branch:"humanities" = branch), delta = 0.033. Under the alternative reading implied by the task's parenthetical (treating 25.5c's own historical 0.795 figure as "the base," with no new base measurement run), the branch has *no* base to beat at all in this session's data — the closest analogue would be comparing Stage B's fresh 0.804 against 25.5c's own historical 0.795, a self-comparison across sessions/gold-ratification-status that only ever produces a near-zero, noise-scale delta (+0.009) and would never plausibly clear a 0.05 bar either way. Both readings land on "delta floor unmet." This is flagged for the moderator's benefit in interpreting the number's meaning, not because it's outcome-determinative.
2. **Mechanism accuracy (0.364) is the floor missed by the widest margin (0.236 below the 0.6 bar), and the failure mode is systematic** — the judge collapses `different_scope_conditions`/`different_definition` into `interprets_differently` in 6 of 7 misses. This reads as under-differentiation between the three stage-2 mechanisms rather than random noise, and is unlikely to be fixed by re-running the same prompt again; it would need either a clearer mechanism-selection instruction/definition in the prompt, few-shot examples distinguishing the three mechanisms specifically, or accepting a lower mechanism-accuracy bar as inherent to this task's difficulty at this model tier. n=11 is also a genuinely small sample for a 3-way (plus null) classification — a single flip changes the accuracy by ~0.09.
3. **The empirical-regression failure (0.032 drop) is the smallest of the three misses in absolute terms but is arguably the most consequential**, since `EMPIRICAL_REGRESSION_MAX` exists specifically to protect the already-certified, already-shipped empirical-domain judging from being perturbed by unrelated humanities-branch work. This result says: simply having the code path branch on `branch: "humanities"` for domain-appropriate data is fine, but if a caller ever mis-routed empirical-domain data through the humanities branch (a plausible bug class, not a hypothetical), it would measurably underperform the certified config. This argues for keeping `branch` routing decisions strict and well-tested at the call site, independent of whether the humanities branch itself ever ships.
4. **No cell here used the sonnet escalation rung** (`SONNET_MODEL` in the prior spike scripts) — this task's brief didn't request one, and given three of four floors already fail on the cheapest tier by a combined, non-trivial margin (not a single narrow miss), an escalation to a materially more expensive model is a moderator decision, not something this report assumes.
5. **Class-floor is the only floor that passes, and by a wide margin** (worst class F1 0.571 vs. the 0.40 floor) — this rules out "some class collapsed to near-zero and dragged the macro average down" as the explanation for the other three misses; the shortfalls are broad-based rather than concentrated in one class.

## Decision outcome

Not self-decided, per the task's explicit instruction. This report is submitted for the moderator's gate call. No migration was drafted (Step 3's conditional was not met). `packages/claims/src/eval/gold/*.json` remain ratified regardless of this gate's outcome (Step 1 is unconditional, per the ratification record above) — only the promotion to production (a future migration + code change, if the moderator later decides to ship the humanities branch anyway, accept a lower bar, or iterate on the prompt first) is gated on this result.
