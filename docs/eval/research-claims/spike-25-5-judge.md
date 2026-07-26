# Phase 25.5 Spike B — Judge-Model Ladder Eval

**Script:** `scripts/research/judge-eval.mts` · **Raw data:** `spike-25-5-judge.raw.json` · **Run:** 2026-07-26 · **Cost: $0.198554** (see cost tally at bottom)

## What this measures

Runs the ported ScholarLens contradiction-judge prompt (`packages/claims/src/prompts/judge.ts`, **empirical branch, engagement ABSENT**) over **all 42 empirical gold pairs** at three rungs, scored against `packages/claims/src/eval/{metrics,gates,split}.ts`. This measures judge quality in isolation (Spike A measured retrieval separation, a different stage).

## Headline result: **no rung clears all three gates**

| Rung | Provider | macro-F1 (≥0.75) | kappa (≥0.60) | contradiction recall (≥0.66) | **Passed?** |
|---|---|---|---|---|---|
| gpt-5.4-nano | OpenAI | 0.582 ❌ | 0.450 ❌ | 0.333 ❌ | **No** |
| gpt-5.4-mini | OpenAI | 0.584 ❌ | 0.411 ❌ | 0.333 ❌ | **No** |
| claude-haiku-4-5 | Anthropic | **0.732** ❌ | **0.614** ✅ | **0.667** ✅ | **No — misses macro-F1 by 0.018** |

**`claude-haiku-4-5` is by far the closest** — it clears both the kappa and contradiction-recall gates and misses the macro-F1 floor (0.75) by only 0.018 (0.732 measured). `gpt-5.4-nano` and `gpt-5.4-mini` are not close on any axis that matters (both stuck at 0.333 contradiction recall — they catch only 3 of 9 gold contradictions each). This is well below ScholarLens's own reported baseline (macro-F1 0.788, kappa 0.683 on "Sonnet-class Claude") — `claude-haiku-4-5` is a materially cheaper/smaller model than what that baseline was measured on, and it comes close but not all the way; the OpenAI nano/mini rungs are further off still.

Because no rung passed, **the humanities baseline step (`base 4-way judge over relationshipPairs.humanities.json`) did not run** — it was scoped to "the cheapest rung that passed gates," and none did. Running it on a non-passing rung would answer a different question than the one asked, so it was left undone rather than silently substituted; see Concerns below.

## Per-rung confusion matrices (rows = gold, cols = predicted; order: contradiction, support, nuance, unrelated)

### gpt-5.4-nano

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 3 | 0 | 6 | 0 |
| support (12) | 0 | 3 | 8 | 1 |
| nuance (12) | 1 | 0 | 11 | 0 |
| unrelated (9) | 0 | 0 | 1 | 8 |

Dominant failure mode: **massive over-prediction of "nuance"** — 6/9 contradictions and 8/12 supports are called "nuance" instead. `support` precision is a misleading 1.0 (3/3 correct) but recall is only 0.25 — it almost never predicts `support` at all (labels 4 pairs `support` total, out of 12 gold + false positives).

### gpt-5.4-mini

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 3 | 0 | 6 | 0 |
| support (12) | 0 | 7 | 5 | 0 |
| nuance (12) | 0 | 3 | 9 | 0 |
| unrelated (9) | 0 | 1 | 3 | 5 |

Same core failure as nano on contradictions (6/9 called "nuance"), better on support (7/12 correct). Notably worse than nano on `unrelated` (rejection recall drops to 5/9 vs. nano's 8/9) — mini hallucinates relationships between genuinely unrelated pairs more often than the cheaper nano does, an inversion worth flagging on its own (bigger/pricier is not strictly better here).

### claude-haiku-4-5

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 6 | 0 | 3 | 0 |
| support (12) | 0 | 8 | 4 | 0 |
| nuance (12) | 2 | 1 | 9 | 0 |
| unrelated (9) | 0 | 1 | 1 | 7 |

Same qualitative failure mode (nuance is the "catch-all" the judge falls back to under uncertainty) but much less severe — only 3/9 contradictions and 4/12 supports slip into nuance, vs. 6-8/9 and 5-8/12 for the OpenAI rungs.

## Per-class P/R/F1 (pooled 42)

| Class | nano F1 | mini F1 | haiku F1 |
|---|---|---|---|
| contradiction | 0.462 | 0.500 | 0.706 |
| support | 0.400 | 0.609 | 0.727 |
| nuance | 0.579 | 0.514 | 0.621 |
| unrelated | 0.889 | 0.714 | 0.875 |

No class falls below the `CLASS_F1_FLOOR` (0.4) gate for any rung, so every rung's failure is on the macro-F1/kappa/contradiction-recall axes specifically, not one class collapsing to near-zero.

## Train/test split (`src/eval/split.ts`, `testFrac=0.3`, deterministic SHA-256 bucketing by id)

32 train / 10 test. Test-split numbers are **reported, not gate-relevant** (sample too small — n=10 — to gate on alone, per the task's own instruction):

| Rung | Pooled macro-F1 | Test-split macro-F1 (n=10) | Pooled kappa | Test-split kappa |
|---|---|---|---|---|
| gpt-5.4-nano | 0.582 | 0.685 | 0.450 | 0.595 |
| gpt-5.4-mini | 0.584 | **0.403** | 0.411 | 0.286 |
| claude-haiku-4-5 | 0.732 | 0.783 | 0.614 | 0.730 |

The test-split numbers move around a lot (n=10 is noisy — e.g. mini's test-split macro-F1 of 0.403 is much worse than its pooled number, nano and haiku's are both somewhat *better* than pooled). Directionally consistent with the pooled ranking (haiku > mini ≈ nano) but not independently conclusive at this sample size.

## Per-domain breakdown (mandatory — domain-transfer failure is risk #2 per the integration plan)

| Rung | empirical (30) | information_retrieval (6) | llm_reasoning (6) |
|---|---|---|---|
| gpt-5.4-nano | 0.481 | 0.833 | 0.583 |
| gpt-5.4-mini | 0.508 | 1.000 | 0.333 |
| claude-haiku-4-5 | 0.697 | 0.833 | 0.833 |

The main negotiation-coaching "empirical" sub-domain (30/42 pairs, the bulk of the set) is the hardest for every rung — the information_retrieval and llm_reasoning sub-domains (6 pairs each, smaller samples) score noticeably higher across the board, most sharply for mini (1.000 vs 0.333, but n=6 each — a couple of items either way swings this a lot).

## Robustness sub-check: engagement=`none_detected` vs. omitted (cheapest rung, 10 pairs)

Since no rung passed gates, this ran on `gpt-5.4-nano` (the cheapest rung overall, per the script's documented fallback). **2/10 flipped** (expected ~none):

| id | baseline (no engagement block) | with `none_detected` block | flipped |
|---|---|---|---|
| eval_008 | nuance | unrelated | **yes** |
| eval_009 | nuance | unrelated | **yes** |
| all other 8 | — | — | no |

Both flips move toward `unrelated` once the prompt explicitly states "No citation link was found — do not assume either author read the other." This is a real, if modest, sensitivity to that added instruction — not the "~none" the task anticipated, though small in absolute terms (2/10). **The real direct-citation ablation (with engagement=`direct_citation` against actual resolved-citation corpus data) is deferred to the Phase 26 canary, as the task specifies** — this sub-check only tests the `none_detected` framing text's effect relative to omitting the block entirely, using synthetic gold pairs with no real citation graph behind them.

## Humanities baseline: **not run**

No rung cleared the gates, so there was no "cheapest rung that passed gates" to run the base 4-way judge over `relationshipPairs.humanities.json` on. Running it anyway on a non-passing rung (most likely candidate: `claude-haiku-4-5`, the closest) would have cost roughly 36 × $0.0029 ≈ $0.105 more and was left undone both to preserve budget and because it would answer "how does a judge that already fails the empirical gate do on humanities data" — a different, less useful question than the one the eval plan asks for. **This is a genuine gap in this spike's coverage**, not an oversight — see Concerns below for the budget math showing it could have been afforded.

## Cost tally

| Stage | Rung | Calls | Cost (USD) |
|---|---|---|---|
| main-eval-42 | gpt-5.4-nano | 42 | $0.016213 |
| main-eval-42 | gpt-5.4-mini | 42 | $0.055650 |
| main-eval-42 | claude-haiku-4-5 | 42 | $0.122603 |
| robustness-none-detected | gpt-5.4-nano | 10 | $0.004088 |
| **Spike B total** | | 136 calls | **$0.198554** |

Note the real haiku cost per call (~$0.00292) is roughly 7x nano's (~$0.00039) — Anthropic's tokenizer counts materially more prompt tokens for the same prompt text than OpenAI's (observed ~1,449 vs. ~683 input tokens for an identical prompt in a pre-run smoke test), not just a per-token price difference. The plan document's own cost estimate ("~$0.16 for all three [rungs]") undershot the measured $0.194 for the 3-rung main eval alone, mostly because of this haiku prompt-tokenization gap.

**Combined Spike A + Spike B total: $0.00085881 + $0.198554 = $0.19941281**, well within the $0.35 hard budget (remaining headroom ≈ $0.15).

## Concerns for the moderator

1. **No rung passes all three gates as currently prompted.** `claude-haiku-4-5` is close (misses macro-F1 by 0.018, a single additional correctly-classified pair out of 42 would likely close most of that gap) — this reads as "the ported prompt needs a small adjustment or haiku needs a slightly larger context/few-shot set," not "the approach is fundamentally broken," but it is a real gate failure, not a rounding error to wave through. Per the integration plan's own risk #1, this is the documented re-plan point ("judge doesn't survive the cheap-model downgrade... contingency = ship candidate pairs for human judgment with no LLM label").
2. **The dominant failure mode across all three rungs is the same: over-prediction of "nuance"** as a catch-all under uncertainty, most severe for the two OpenAI rungs and costing every rung its contradiction-recall gate except haiku. This suggests the decision boundary between `nuance` and `contradiction`/`support` — exactly the boundary ScholarLens's own prompt docstring calls out as the hard case the 6 few-shots were meant to target — may need reinforcement for smaller/cheaper models specifically, since the identical few-shots were used at every rung.
3. **Humanities baseline did not run** (see above) — budget allowed for it (~$0.15 headroom vs. ~$0.105 estimated cost on haiku), but the literal trigger condition ("cheapest rung that passed gates") was never met. The moderator should decide whether to authorize a follow-up run of the humanities baseline on `claude-haiku-4-5` specifically (as the closest rung) as a separate, explicitly-labeled measurement, or defer it until a rung actually clears the empirical gate.
4. **The robustness sub-check found 2/10 flips, not ~0** — small in absolute count but a real, reproducible sensitivity to the `none_detected` engagement framing text on this cheap rung. Worth re-checking once a passing rung exists.
5. Every rung's schema always exposed the optional `mechanism` field (nullable, not omittable, per OpenAI strict-mode JSON schema rules) even though the empirical branch's own prompt text never asks for it — models sometimes filled it in anyway (harmless: `validateJudgeResponse` only keeps it when valid for the returned valence, and the empirical gold set has no mechanism labels to compare against, so this never affected scoring), but noted here for full methodological transparency.
