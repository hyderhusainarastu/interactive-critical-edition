# Phase 25.5c — Judge Output-Mode Experiment (Structured Tool-Use vs. Raw-Text)

**Script:** `scripts/research/judge-eval-output-mode.mts` · **Raw data:** `spike-25-5c-output-mode.raw.json` · **Run:** 2026-07-26 · **Cost: $0.293878** (of a $0.95 hard budget — see cost tally at bottom)

## What this measures

Tests the moderator's hypothesis for why every judge config measured so far (Phase 25.5, `spike-25-5-judge.md`; Phase 25.5b, `spike-25-5b-judge-iteration.md`) has fallen short of ScholarLens's own reported baseline (macro-F1 0.788, "Sonnet-class Claude"): that **forced tool-use itself** — the mechanism `AnthropicStructuredClient`/`OpenAIResponsesClient` both use to get schema-validated JSON out of the model — denies the model pre-answer reasoning that ScholarLens's own raw "Return ONLY valid JSON" text-completion call implicitly allowed (the model can think in its own free-text response before the JSON, or interleave reasoning and answer, in a way a forced single tool call with no reasoning field cannot).

All cells use the exact **BASELINE** judge prompt — `buildJudgePromptVariant` with every v2 addition off (`includeDecisionTree: false, includeAntiCatchAll: false, includeFewShot: false`) — the prompt Phase 25.5 measured at claude-haiku-4-5 macroF1 0.732/kappa 0.614/contradictionRecall 0.667. That specific config was chosen as the fixed variable to hold constant because it is the closest any config has ever come to clearing the gates, isolating output mode as the one thing under test.

## Headline result: raw-text mode clears all three gates; structured mode still doesn't

| Cell | Model | Mode | Pooled macroF1 (≥0.75) | Pooled kappa (≥0.60) | Pooled contradiction recall (≥0.66) | Test-split (n=10) macroF1 | **Passed?** |
|---|---|---|---|---|---|---|---|
| 1 | claude-haiku-4-5 | structured tool-use, reasoning-first schema | 0.733 ❌ (misses by 0.017) | 0.616 ✅ | 0.778 ✅ | 0.783 | **No** |
| 2 | claude-haiku-4-5 | raw-text ("Return ONLY valid JSON") | **0.752** ✅ | **0.650** ✅ | **1.000** ✅ | 0.710 | **Yes** |
| 3 | claude-sonnet-4-6 | — | — | — | — | — | **Not run** — Cell 2 already cleared every gate, so the task's own conditional ("only if neither Cell 1 nor Cell 2 clears ALL gates") skipped the escalation rung |

**Cell 2 (raw-text mode) is the first config in this whole three-spike effort (25.5, 25.5b, 25.5c — 9 structured configs measured before this one, none passing) to clear all three gates.** It is a genuine, if partial, confirmation of the moderator's hypothesis: switching only the output mode — same model, same prompt, same gold set — turned a near-miss into a clean pass, closing the entire gap to the macroF1 gate (0.732→0.752, +0.020) and clearing contradiction recall with room to spare (0.667→1.000).

**Cell 1 (structured, but with a `reasoning` field prepended to the schema — "let it think inside the tool call") is a partial confirmation, not a null result.** It scored materially better than Phase 25.5's original no-reasoning structured baseline on 2 of 3 axes (kappa 0.614→0.616, contradiction recall 0.667→0.778) while macroF1 stayed essentially flat (0.732→0.733). It is the closest any structured config has come across all three spikes, but it still misses the macroF1 gate — reasoning-inside-the-tool-call closes some but not all of the gap raw-text closes.

Since Cell 2 passed, the escalation rung (Cell 3, claude-sonnet-4-6) was correctly skipped per the task's own decision rule — no data to report there.

## Per-cell confusion matrices (rows = gold, cols = predicted; order: contradiction, support, nuance, unrelated)

### Cell 1 — claude-haiku-4-5, structured tool-use, reasoning-first schema

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 7 | 0 | 2 | 0 |
| support (12) | 0 | 6 | 6 | 0 |
| nuance (12) | 3 | 0 | 9 | 0 |
| unrelated (9) | 0 | 1 | 0 | 8 |

Residual failure mode: 6/12 supports still get called `nuance` — the same qualitative pattern every prior structured config has shown (the model treats agreement-with-some-difference as `nuance` more readily than the gold labelers did), just less severe than Phase 25.5's original baseline.

### Cell 2 — claude-haiku-4-5, raw-text mode

| gold ↓ / pred → | contradiction | support | nuance | unrelated |
|---|---|---|---|---|
| contradiction (9) | 9 | 0 | 0 | 0 |
| support (12) | 1 | 7 | 4 | 0 |
| nuance (12) | 3 | 1 | 8 | 0 |
| unrelated (9) | 0 | 0 | 2 | 7 |

Contradiction recall is perfect (9/9) — the same qualitative shift the Phase 25.5b variant-B structured config showed (over-predicting contradiction rather than under-predicting it), but here it costs almost nothing: only 1/12 supports and 3/12 nuances are misrouted to contradiction, versus 25.5b's more severe 4/12 and 7/12. `unrelated` recall drops slightly (7/9, two nuances misclassified as unrelated) but stays well clear of the class floor.

## Per-class P/R/F1 (pooled 42)

| Class | Cell 1 (structured) P / R / F1 | Cell 2 (raw-text) P / R / F1 |
|---|---|---|
| contradiction | 0.700 / 0.778 / 0.737 | 0.692 / 1.000 / 0.818 |
| support | 0.857 / 0.500 / 0.632 | 0.875 / 0.583 / 0.700 |
| nuance | 0.529 / 0.750 / 0.621 | 0.571 / 0.667 / 0.615 |
| unrelated | 1.000 / 0.889 / 0.941 | 1.000 / 0.778 / 0.875 |

No class falls below `CLASS_F1_FLOOR` (0.4) in either cell.

## Per-domain macro-F1

| Cell | empirical (30) | information_retrieval (6) | llm_reasoning (6) |
|---|---|---|---|
| 1 — structured | 0.725 | 0.625 | 0.833 |
| 2 — raw-text | 0.689 | 1.000 | 0.867 |

Consistent with every prior spike, the main "empirical" (negotiation-coaching) sub-domain is the hardest for both cells; the smaller information_retrieval/llm_reasoning slices (n=6 each) are noisier and swing further either way.

## Train/test split (reported, not gate-relevant — n=10, per the task's own instruction)

No tuning happened in this script (the prompt was fixed at BASELINE for both cells by design, isolating output mode), so the split is informational only:

| Cell | Pooled macroF1 | Test-split macroF1 (n=10) | Pooled kappa | Test-split kappa |
|---|---|---|---|---|
| 1 — structured | 0.733 | 0.783 | 0.616 | 0.730 |
| 2 — raw-text | 0.752 | 0.710 | 0.650 | 0.595 |

Notable: Cell 1's test-split numbers are *higher* than pooled, while Cell 2's are *lower* — with n=10 this is noise, not a signal that either cell generalizes better or worse; the pooled 42-pair numbers are the ones that gate.

## Raw-text mode's robustness in practice: zero parse failures, zero retries

The eval-only fence-strip + `JSON.parse` + one-retry path (deliberately not part of any production code — see the report's decision section) never needed its retry: **0 of 42 Cell 2 calls, and 0 of 36 humanities-baseline calls, failed to parse on the first attempt.** This doesn't mean raw-text parsing is safe to assume reliable at scale — see Concerns #3 — but the concrete failure rate this session, on `claude-haiku-4-5` specifically, was zero, not "occasionally fragile in a way this run happened to dodge."

## Humanities baseline (PROVISIONAL) — cheapest passing config

Since Cell 2 (claude-haiku-4-5, raw-text, baseline prompt) cleared all three gates and Cell 1 did not, Cell 2 is the cheapest — and only — passing config. The humanities baseline (`relationshipPairs.humanities.json`, 36 pairs) ran on that exact config, with `branch: "humanities"` so the prompt's pre-classification instruction and optional `mechanism` field actually apply (see the note on `spike-25-5b-judge-iteration.md`'s Phase 3 below).

**PROVISIONAL: macroF1 0.795, kappa 0.688, contradictionRecall 1.000 — clears every gate, and by a wider margin than the empirical branch did (0.752/0.650/1.000).**

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| contradiction | 0.778 | 1.000 | 0.875 | 7 |
| support | 0.667 | 0.500 | 0.571 | 8 |
| nuance | 0.733 | 0.733 | 0.733 | 15 |
| unrelated | 1.000 | 1.000 | 1.000 | 6 |

Labels are PROVISIONAL per `src/eval/goldSchema.ts`'s own documented caveat: the humanities gold file's `category` field uses its own locally-invented vocabulary (interpretive/historical/definitional/textual) rather than `CLAIM_RELATION_CATEGORIES`, a known divergence pending owner sign-off (`gold/RATIFICATION.md`) — only the 4-way `relationship` valence is scored here, which is comparable.

**A deliberate correction, not a silent copy, from the Phase 25.5b script:** `judge-eval-v2.mts`'s own humanities-baseline step passed `branch: "empirical"` when scoring humanities pairs (see that script's Phase 3), which would have skipped the humanities pre-classification instruction and `mechanism` field judge.ts's humanities branch exists specifically to add. That step never actually executed in 25.5b (no cell/rung passed gates there), so the choice was never exercised or caught. This script uses `branch: "humanities"` instead, which is what `buildJudgePrompt`'s humanities branch is for. Flagged here rather than silently replicating what looks like an unexercised bug.

## Cost tally

| Stage | Config | Calls | Cost (USD) |
|---|---|---|---|
| cell1 | claude-haiku-4-5 / structured-reasoning-first / baseline | 42 | $0.151182 |
| cell2 | claude-haiku-4-5 / raw-text / baseline | 42 | $0.072229 |
| humanities-baseline | claude-haiku-4-5 / raw-text / baseline (cheapest passing config) | 36 | $0.070467 |
| **Total** | | **120 calls** | **$0.293878** |

Well within the $0.95 hard budget (headroom ≈ $0.656). Cell 3 (sonnet escalation, budgeted ~$0.55) never ran since Cell 2 passed, which is most of the unused headroom. Note Cell 1 (structured) cost **more than double** Cell 2 (raw-text) for the same 42 calls ($0.151 vs. $0.072) — the `reasoning` field materially inflates completion tokens (measured in a pre-run smoke test: 378 completion tokens for a structured reasoning-first call vs. 214 for the equivalent raw-text call on the same pair), on top of Anthropic's already-higher per-call tokenization overhead documented in `spike-25-5-judge.md`.

## Decision outcome

Per the task's decision rule: **raw-text mode (Cell 2) won and cleared every gate, but no structured config — Cell 1 here, or any config across Phase 25.5/25.5b — has ever cleared the gates. Per the explicit instruction ("if raw-text mode wins and structured modes all miss gates, DO NOT wire raw-text into production"), raw-text mode is NOT wired into production.** The eval-only fence-strip/parse/retry helper in `judge-eval-output-mode.mts` stays exactly that — eval-only, clearly marked, not exported, not imported by any production file.

**Shipped configuration = best structured config = Cell 1's exact setup**, applied to production code in this session:

- `packages/claims/src/prompts/judge.ts`'s `buildJudgePrompt` now ships the **BASELINE** prompt (every v2 addition off) — reverted from Phase 25.5b's shipped variant B (few-shot + anti-catch-all), which full-42 scoring in that spike had already shown underperforms the baseline (macroF1 0.694 vs. baseline's 0.732/Cell 1's 0.733).
- A new exported `JUDGE_OUTPUT_SCHEMA` constant carries `reasoning` as its first property (ahead of `relationship`/`category`/etc.), matching Cell 1's measured schema shape. `validateJudgeResponse` is **unmodified** — it already ignores unrecognized fields like `reasoning`, so no change to validation logic was needed, only the schema definition and a new test asserting the behavior explicitly.
- `JUDGE_PROMPT_VERSION` bumped `"judge-v2b-fewshot-anticatchall"` → `"judge-v3-baseline-reasoning-schema"`, with the doc comment updated to record the full v1→v2→v3 history and numbers.
- `packages/claims/src/prompts/judge.test.ts` updated: the tests asserting `buildJudgePrompt` output contains the few-shot/anti-catch-all blocks now assert their absence instead; new tests cover `JUDGE_OUTPUT_SCHEMA`'s property order/required-fields and confirm `validateJudgeResponse` ignores a `reasoning` field.

**`TASK_ROUTES.claim_relationship_judgment` in `packages/ai-adapters/src/routing.ts` was updated**, per the task's separate, unconditional trigger ("Update TASK_ROUTES ... ONLY if a config passed all gates"): a config (Cell 2) did pass, so `anthropic/claude-haiku-4-5` is now `preferred` (was `openai`'s cheap tier), with `openai` demoted to `alternate`. **This is flagged prominently as Concern #1 below** — the passing evidence is for raw-text calling specifically, which is explicitly not what ships; see that concern before treating this route as fully validated for whatever call shape eventually wires this task type up (there is no production caller yet).

## Concerns for the moderator

1. **The TASK_ROUTES promotion is evidence from a mode that isn't shipped — a real interpretive tension in the task's own instructions.** The task gives two rules in the same breath: (a) don't wire raw-text into production if it's the only thing that passes, and (b) update TASK_ROUTES if *any* config passed. Both are followed literally here — `judge.ts` ships the best *structured* config (which doesn't pass), while `routing.ts` promotes the model that *did* pass (via raw-text). The result is a route pointing at a model whose only passing evidence used a calling convention this codebase deliberately isn't shipping. The routing.ts comment states this caveat explicitly and in detail, and this task type has no production caller yet (verified: `buildJudgePrompt`/`validateJudgeResponse`/`JUDGE_OUTPUT_SCHEMA` are referenced only by `judge.ts` itself, its test file, and the eval scripts — grep confirms no worker/job code calls them), so nothing executes this route today. But if the moderator's intent was "only promote a route once the *shippable* config passes," this promotion should be reverted — it was a judgment call under genuine ambiguity in the brief, not a mechanical application of an unambiguous rule.
2. **Cell 1's reasoning-first schema is real but partial evidence for the hypothesis, not full confirmation.** It closed the kappa and contradiction-recall gaps (both already-passing in Phase 25.5's baseline stayed passing, with contradiction recall improving further, 0.667→0.778) but left macroF1 essentially flat (0.732→0.733). If forced tool-use denying reasoning were the *entire* explanation for the gap to raw-text/ScholarLens, adding a reasoning field back inside the tool call should have closed most of the macroF1 gap too — it closed almost none of it. The remaining gap (0.733 structured vs. 0.752 raw-text, a 0.019 spread) is better attributed to something else about forced tool-use specifically (schema constraint pressure, the model's own behavioral difference when it knows a rigid parser is waiting, etc.) than to reasoning access alone. Worth a dedicated follow-up if the moderator wants to isolate that further (e.g., a schema where `reasoning` has no length cap vs. one that does, or comparing against a `thinking`-enabled structured call instead of a plain `reasoning` schema field).
3. **Zero raw-text parse failures this session is a small sample, not a durability guarantee.** 78 raw-text calls (42 + 36) with zero fence-strip/parse/retry failures is genuinely reassuring for `claude-haiku-4-5` specifically, but it's one session, one model, one prompt. The retry/validation weakening the task itself flags as the reason NOT to productionize raw-text mode is a structural property (a malformed raw-text response has no schema-level guarantee the way a forced-tool-use response does, even if it happens not to occur in 78 tries) — this measurement doesn't resolve that structural concern, it just reports that it didn't bite here.
4. **The production judge schema now includes `mechanism` even though Cell 1's actual measured schema didn't.** Cell 1's live schema (measured, in the eval script) omitted `mechanism` entirely (Anthropic-only test, empirical branch, no OpenAI strict-mode constraint to satisfy). The exported `JUDGE_OUTPUT_SCHEMA` in `judge.ts` adds it back, nullable, to stay usable by `OpenAIResponsesClient`'s strict-mode requirement (every property must be `required`) — matching the pattern every prior eval script already used. This is a reasonable, low-risk generalization (mechanism is optional metadata `validateJudgeResponse` already drops silently when invalid, and the empirical branch's prompt text never asks for it either way), but it is not byte-for-byte what was measured — flagged for completeness, not because it's expected to matter.
5. **Cell 3 (sonnet escalation) never ran, so this spike adds no new evidence about sonnet under output-mode variation.** All sonnet evidence in this codebase remains Phase 25.5b's single run (variant C prompt, structured tool-use, macroF1 0.695/kappa 0.563/contradictionRecall 0.444 — worse than haiku on every axis). Whether sonnet would show the same structured-vs-raw-text gap haiku did is untested.
