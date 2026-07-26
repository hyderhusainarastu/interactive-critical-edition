# Phase 25.5b — Judge Prompt Iteration (Decision Tree + Few-Shot + Anti-Catch-All)

**Scripts:** `scripts/research/judge-eval-v2.mts` (variant selection + Phase 2/3/4), `scripts/research/judge-eval-v2-rescore.mts` (corrected final-scoring re-run — see "A real bug, fixed mid-task" below) · **Raw data:** `spike-25-5b-judge-iteration.raw.json`, `spike-25-5b-judge-iteration-rescore.raw.json` · **Run:** 2026-07-26 · **Total cost: $0.944986** (full tally at bottom)

## What this measures

Iterates `packages/claims/src/prompts/judge.ts`'s `buildJudgePrompt` toward ScholarLens's own "Task 2c" treatment (macro-F1 0.788 on Sonnet-class Claude, per `/Users/hyderhusainarastu/Project/scholarlens_src/README.md` §5 — the actual 2c prompt text no longer exists in that repo snapshot, only the README's retrospective description, so this iteration is a fresh construction guided by that description, not a literal port). Starting point: Phase 25.5's baseline (`spike-25-5-judge.md`) — no rung passed gates, and the dominant failure mode across all three rungs was systematic over-prediction of "nuance" as a catch-all.

## Prompt v2: three new blocks

Added to `buildJudgePromptVariant` (the parameterized builder `buildJudgePrompt` now wraps):

1. **Decision-tree preamble** — a 3-step "walk through in order" instruction: (1) same construct/proxy vs. orthogonal constructs (orthogonal → never `contradiction`), (2) if same construct, could both be true under stated conditions → `nuance`/`support`, (3) only then `contradiction`.
2. **6 few-shot examples** targeting the nuance/contradiction and nuance/support boundaries specifically, authored from domains absent from every gold set (sleep research, econometrics, materials science) to avoid eval contamination — 2 nuance/contradiction-boundary cases, 1 genuine contradiction, 1 nuance/support-boundary case, 1 genuine support, 1 orthogonal/unrelated case.
3. **Anti-catch-all instruction** — "`nuance` is not a default for 'related but I'm not sure how'... if you cannot name that specific condition, the pair is not `nuance`."

All HARD RULES and the JSON-schema return instructions are byte-identical to v1 (ScholarLens's ported text), per the task's constraint.

**Engagement-block fix (also shipped this session):** the `none_detected` framing ("No citation link was found — do not assume either author read the other") is now dropped entirely rather than injected — the Phase 25.5 robustness sub-check measured it flipping 2/10 predictions, proving it non-neutral. `buildJudgePrompt` now produces byte-identical output whether `engagement` is omitted or `{kind: "none_detected"}` (new unit test asserts this). Code-only change, verified by `judge.test.ts`, not re-measured live (no new cost).

## Tuning discipline: variant selection on TRAIN only (gpt-5.4-nano)

Per the task's protocol: select on TRAIN (`src/eval/split.ts`, `testFrac=0.3`, deterministic SHA-256 bucketing — 32 train / 10 test of the 42 empirical gold pairs), cheapest rung only, before any full-scale or cross-rung measurement.

| Variant | Blocks | Train macro-F1 | Train kappa | Train contradiction recall |
|---|---|---|---|---|
| A — decisionTree-only | decision tree + anti-catch-all, no few-shot | 0.569 | 0.419 | 0.500 |
| **B — fewShot-only** | few-shot + anti-catch-all, no decision tree | **0.582** ✅ WINNER | 0.456 | 1.000 |
| C — full-v2 ("kitchen sink") | all three blocks | 0.540 | 0.377 | 0.625 |

**Variant B won** by train macro-F1 (0.582 vs. 0.540 for the full combination) — the "kitchen sink" of all three new blocks together actually scored *lowest* of the three on this train split. `buildJudgePrompt` ships variant B's exact combination (few-shot examples + the anti-catch-all instruction, decision-tree preamble OFF).

Cost: 3 variants × 32 pairs × gpt-5.4-nano = 96 calls, $0.051359.

## A real bug, fixed mid-task

The first version of `judge-eval-v2.mts` scored Phase 2 (final full-42 scoring) using the *shipped* `buildJudgePrompt()` unconditionally — but at the time that function still defaulted to variant C (every flag on), regardless of which variant Phase 1 declared the winner. This produced a real, paid measurement of variant **C**, not the actual winner (**B**), while `judge.ts`'s `buildJudgePrompt` had not yet been corrected to match. Caught by inspecting the Phase 1 output (`bestVariant: B-fewShot-only`) against the Phase 2 log before writing this doc, rather than assuming the two were consistent.

Fix: `buildJudgePrompt` was edited to explicitly ship variant B's flag combination, and a second script (`judge-eval-v2-rescore.mts`) re-ran Phase 2 (full 42, nano + haiku) against the *corrected* function. Both measurements are reported below — the corrected-B numbers are the ones that matter for the actual shipped prompt; the original C numbers are kept because real money was already spent measuring them and they surface a genuine finding (see Concerns #1).

## Final scoring: SHIPPED prompt (variant B), full 42, pooled + held-out test

| Rung | Pooled macroF1 (≥0.75) | Pooled kappa (≥0.60) | Pooled contradiction recall (≥0.66) | **Passed?** | Test-split (n=10) macroF1 | Test-split kappa |
|---|---|---|---|---|---|---|
| gpt-5.4-nano | 0.563 ❌ | 0.439 ❌ | **1.000** ✅ | **No** | 0.425 | 0.231 |
| claude-haiku-4-5 | 0.694 ❌ | 0.584 ❌ | 0.667 ✅ | **No** | 0.500 | 0.444 |

Test-split numbers are reported, not gate-relevant (n=10, per the task's own instruction).

### Confusion matrices (rows = gold, cols = predicted; order: contradiction, support, nuance, unrelated)

**gpt-5.4-nano (variant B):**

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 9 | 0 | 0 | 0 |
| support (12) | 4 | 3 | 3 | 2 |
| nuance (12) | 7 | 0 | 5 | 0 |
| unrelated (9) | 0 | 0 | 2 | 7 |

**claude-haiku-4-5 (variant B):**

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 6 | 0 | 3 | 0 |
| support (12) | 1 | 5 | 5 | 1 |
| nuance (12) | 2 | 0 | 10 | 0 |
| unrelated (9) | 0 | 1 | 0 | 8 |

### Per-class P/R/F1 (pooled 42)

| Class | nano precision/recall/F1 | haiku precision/recall/F1 |
|---|---|---|
| contradiction | 0.450 / 1.000 / 0.621 | 0.667 / 0.667 / 0.667 |
| support | 1.000 / 0.250 / 0.400 | 0.833 / 0.417 / 0.556 |
| nuance | 0.500 / 0.417 / 0.455 | 0.556 / 0.833 / 0.667 |
| unrelated | 0.778 / 0.778 / 0.778 | 0.889 / 0.889 / 0.889 |

No class falls below `CLASS_F1_FLOOR` (0.4) for either rung (nano's `support` F1 lands exactly at 0.400, which is not `< 0.4`).

### Per-domain macro-F1

| Rung | empirical (30) | information_retrieval (6) | llm_reasoning (6) |
|---|---|---|---|
| gpt-5.4-nano | 0.444 | 0.833 | 0.867 |
| claude-haiku-4-5 | 0.628 | 1.000 | 0.533 |

**Cheapest passing rung: NONE.**

## Side-by-side: variant C's full-42 numbers (measured before the fix, kept for the generalization-gap finding)

| Rung | Pooled macroF1 | Pooled kappa | Pooled contradiction recall | Gate detail |
|---|---|---|---|---|
| gpt-5.4-nano (C) | 0.550 | 0.400 | 0.556 | macroF1❌ kappa❌ contradictionRecall❌ |
| claude-haiku-4-5 (C) | **0.726** | **0.617 ✅** | **0.778 ✅** | macroF1❌ (misses by only **0.024**) kappa✅ contradictionRecall✅ |

**Variant C — the "loser" of the train-based selection — came within 0.024 macro-F1 of clearing the gate on haiku, closer than the shipped variant B (which misses by 0.056 and also fails kappa).** See Concerns #1.

## Robustness sub-check (engagement fix)

Not re-run live this session — the fix (dropping the `none_detected` framing entirely) is a pure text-removal verified by a new unit test asserting byte-identical output for `engagement: undefined` vs. `engagement: {kind: "none_detected"}`. The original Phase 25.5 spike's 2/10-flip measurement (`spike-25-5-judge.md`) is the evidence base for *why* this fix was made; no new paid measurement was needed to verify the fix itself.

## Escalation rung: claude-sonnet-4-6 (full 42)

Since neither cheap rung passed gates, one escalation rung ran per the task's authorization. **Measured against variant C's prompt** (this predates the mid-task fix — see Concerns #2), not the corrected shipped variant B, and not re-run under B due to budget.

| Metric | Value | Gate | Pass? |
|---|---|---|---|
| Pooled macroF1 | 0.695 | ≥0.75 | ❌ |
| Pooled kappa | 0.563 | ≥0.60 | ❌ |
| Pooled contradiction recall | 0.444 | ≥0.66 | ❌ |
| Test-split (n=10) macroF1 | 0.667 | not gate-relevant | — |

**Coverage: 40/42 pairs** (2 skipped, `llm_005`/`llm_006`) — the escalation's own budget guard halted 2 in-flight calls before completion; see Concerns #4. Per-class F1 all comfortably above the class floor (`unrelated` F1 = 1.000, `nuance` F1 = 0.519, `support` F1 = 0.762, `contradiction` F1 = 0.500).

**Sonnet does not clear the gates either** — no rung at any tier passes. Per the task's decision rule, **`TASK_ROUTES` in `packages/ai-adapters/src/routing.ts` is unchanged** — `claim_relationship_judgment` keeps its existing cheap-first default (`preferred: openai/gpt-5.4-nano`, `alternate: anthropic/claude-haiku-4-5`). No route was changed by this session.

## Humanities baseline

**Not run.** The task scopes this to "if a rung passed gates" — none did (nano, haiku-B, haiku-C, or sonnet), so there is no "cheapest passing rung" to run the base 4-way judge over `relationshipPairs.humanities.json` on. `humanitiesProvisional: null`.

## Thresholds committed (Phase 25.5 calibration spike, independent of the judge work above)

`packages/claims/src/thresholds.ts` env-absent defaults updated per `docs/eval/research-claims/spike-25-5-calibration.md` (2026-07-26, calibrated for `text-embedding-3-small`):

- `RETRIEVAL_THRESHOLDS.denseMin` → `0.35` (was NaN). `denseStrong` stays NaN — the spike never measured a "strong enough to skip BM25" cutoff, so it still fails loudly via `assertThresholdsSet` rather than being guessed.
- `NOVELTY_THRESHOLDS.low` → `0.174`, `.high` → `0.725` (both PROVISIONAL — measured from 20 hand-written synthetic statements, not real pipeline output; recalibration due at the Phase 27 canary per the task).

`assertThresholdsCalibratedFor` semantics unchanged (still throws on a model mismatch). Tests updated: `thresholds.test.ts` no longer asserts NaN for `denseMin`/novelty fields; `assertThresholdsSet(NOVELTY_THRESHOLDS)` no longer throws (all its numeric fields are now real numbers), while `assertThresholdsSet(RETRIEVAL_THRESHOLDS)` still throws (via `denseStrong`).

## Cost tally

| Stage | Rung | Calls | Cost (USD) |
|---|---|---|---|
| variant-A-decisionTree-only-train | gpt-5.4-nano | 32 | $0.014530 |
| variant-B-fewShot-only-train | gpt-5.4-nano | 32 | $0.017675 |
| variant-C-full-v2-train | gpt-5.4-nano | 32 | $0.019155 |
| final-scoring-42 (variant C, superseded) | gpt-5.4-nano | 42 | $0.025349 |
| final-scoring-42 (variant C, superseded) | claude-haiku-4-5 | 42 | $0.173054 |
| **Base-phase subtotal** | | **212 calls** | **$0.249762** (still under the $0.45 base cap alone) |
| escalation-sonnet-42 | claude-sonnet-4-6 | 40/42 | $0.510546 |
| corrected-final-scoring-42 (variant B, shipped) | gpt-5.4-nano | 42 | $0.023362 |
| corrected-final-scoring-42 (variant B, shipped) | claude-haiku-4-5 | 42 | $0.161315 |
| **Rescore subtotal** | | **84 calls** | **$0.184678** |
| **GRAND TOTAL** | | **378 calls** | **$0.944986** |

Base-only spend (variant selection + both final-scoring runs, i.e. excluding escalation): $0.249762 + $0.184678 = **$0.434440**, under the $0.45 hard cap by $0.015560 — even counting the wasted duplicate variant-C run from the mid-task bug. Escalation alone: $0.510546, **$0.010546 (2.1%) over its own ~$0.50 authorization** — see Concerns #4. Combined total ($0.944986) stays under the combined ~$0.95 envelope by $0.005.

## Concerns for the moderator

1. **Train-based selection did not generalize to the full-scale, cross-rung measurement — the "loser" (variant C) came closer to passing than the "winner" (variant B).** On TRAIN (n=32, nano only) variant B beat C by 0.042 macro-F1 (0.582 vs. 0.540). On the full 42 pairs, haiku running variant C scored materially *better* than haiku running the shipped variant B — macroF1 0.726 vs. 0.694, kappa 0.617 (passes) vs. 0.584 (fails), contradiction recall 0.778 (passes) vs. 0.667 (barely passes) — and C's macroF1 miss (0.024) is far smaller than B's (0.056). This is a real generalization gap, not a rounding difference: n=32 on the cheapest rung is a noisy signal for what a materially different (and more expensive) rung will do on the fuller set. The task's protocol was followed exactly as specified (select on train, ship the winner, do not re-select using full/held-out data), so variant B is what ships — but the moderator should treat this as an open question, not a closed one: a follow-up comparing B and C on a larger train sample, or selecting by agreement across both cheap rungs rather than nano alone, could plausibly flip the answer.
2. **The sonnet escalation was measured against variant C's prompt, not the corrected shipped variant B**, because of the same mid-task ordering bug described above — the escalation phase ran before the Phase-2 correction was discovered. Given finding #1 above (C outperforms B on the fuller measurement), it's plausible sonnet under B would score similarly or slightly worse than the reported 0.695/0.563/0.444, but this was not verified empirically; a real re-run (~$0.51) would be needed to know for certain. Not re-run here — the combined budget was already essentially exhausted ($0.945 of a ~$0.95 combined envelope).
3. **nano's failure mode shifted, it didn't disappear.** The Phase 25.5 baseline's dominant failure was massive over-prediction of "nuance" as a catch-all. Under the shipped variant B, nano now over-predicts **"contradiction"** instead — it gets all 9 true contradictions right (recall 1.000) but also mislabels 4/12 supports and 7/12 nuances as contradiction. The anti-catch-all instruction and few-shots appear to have overcorrected nano specifically, trading one systematic bias for another rather than eliminating bias. Haiku's confusion matrix is much more balanced (its main residual issue is nuance being somewhat over-predicted, a milder version of the original problem). Worth targeting a v3 few-shot set specifically at nano's new failure mode if this pipeline gets another iteration.
4. **The escalation rung's own budget guard let 2 of 42 calls fall through uncounted, then still overshot by $0.0105.** The real-time budget check (`withinBudget`) is evaluated per-dispatch at concurrency 4 — up to 3 other in-flight calls can pass the check before the running total updates, the same race the original Phase 25.5 harness's budget guard had (documented there as intentional, "conservative per-call cap padded above measurement"). Here it meant the ceiling was both exceeded (by 2.1%) and two pairs were never scored (40/42 = 95.2% coverage) once the guard did catch up. Coverage gap is small and unlikely to change the qualitative "sonnet doesn't pass either" conclusion, but it's a real measurement gap, not a full 42.
5. **The actual ScholarLens "Task 2c" prompt text does not exist in the available source snapshot** — only the README's retrospective description (decision tree distinguishing proxy vs. orthogonal measurements + ~6 few-shots, macro-F1 0.788 on Sonnet-class Claude). This iteration is therefore an independent construction guided by that description, not a literal port, and the ScholarLens 0.788 number is not a like-for-like target — it was measured on "Sonnet-class Claude" (unspecified exact model/date) with ScholarLens's own (unavailable) exact prompt text, gold set size (30, not 42), and possibly different few-shot content.
6. Every rung's schema still always exposes the optional `mechanism` field (OpenAI strict-mode requires it in `required`) even though the empirical branch's prompt text never asks for it — same harmless, previously-documented quirk as Phase 25.5 (`validateJudgeResponse` only keeps it when valid for the returned valence; no scoring impact, since the empirical gold set carries no mechanism labels).
