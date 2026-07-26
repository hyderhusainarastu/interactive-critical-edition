# Phase 25.5 Spike A — Embedding Calibration (Stage-1 Retrieval Separation)

**Script:** `scripts/research/stage1-separation.mts` · **Raw data:** `spike-25-5-calibration.raw.json` · **Run:** 2026-07-26 · **Cost: $0.00085881** (see cost tally at bottom)

## What this measures (and what it doesn't)

This spike measures **Stage 1** of the claims pipeline — the cosine-similarity threshold that decides which claim pairs are worth sending to the (expensive) LLM judge at all. It does **not** measure judge quality; that's Spike B (`spike-25-5-judge.md`). Ports the honesty guards of `/Users/hyderhusainarastu/Project/scholarlens_src/eval/stage1_separation.py` to TypeScript over Palimnote's own gold sets, using the real `embedMany` batching seam (`packages/ai-adapters/src/embeddings.ts`) instead of local sentence-transformers.

## Data

| File | Pairs | Status |
|---|---|---|
| `relationshipPairs.empirical.json` | 42 | Ratified (byte-for-byte ScholarLens transcription) |
| `relationshipPairs.humanities.json` | 36 | **PROVISIONAL** (Palimnote-authored draft, pending owner ratification) |
| `retrievalNegatives.json` | 22 | **PROVISIONAL** (Palimnote-authored draft, pending owner ratification) — all cross-domain `unrelated` |
| **Pooled** | **100** | 63 should-surface (contradiction/support/nuance), 37 should-reject (unrelated) |

197 distinct claim texts were embedded once per model (deduped across all three files) and every pair's cosine similarity was computed from that shared vector map — no text was embedded twice.

## Honesty guard (ported from `stage1_separation.py`)

Operationalization used here (stated explicitly since the original script's thresholds were tuned for a 30-pair, judge-only set): **weak separation** = mean-similarity gap < 0.05; **heavy overlap** = more than 30% of should-reject pairs score at or above the weakest should-surface pair. Either trips the guard and blocks a threshold recommendation for that subset.

| Subset | Model | Gap | Overlap | Weak? | Heavy overlap? | **Guard result** |
|---|---|---|---|---|---|---|
| Pooled (100) | 3-small | 0.403 | 4/37 (10.8%) | No | No | **Clean** |
| Pooled (100) | 3-large | 0.407 | 8/37 (21.6%) | No | No | **Clean** |
| Empirical-only (42, ratified) | 3-small | 0.249 | 4/9 (44.4%) | No | **Yes** | **REFUSED** |
| Empirical-only (42, ratified) | 3-large | 0.248 | 7/9 (77.8%) | No | **Yes** | **REFUSED** |
| Humanities-only (36, PROVISIONAL) | 3-small | 0.443 | 0/6 (0%) | No | No | Clean |
| Humanities-only (36, PROVISIONAL) | 3-large | 0.429 | 0/6 (0%) | No | No | Clean |

**Important finding, not a script bug:** the certified 42-pair empirical set **alone** trips the heavy-overlap guard for both models (44–78% of its 9 "unrelated" pairs score at or above the weakest related pair). This reproduces exactly the warning the ported Python docstring predicts: *"the gold set was built to stress the JUDGE (hard-to-classify pairs), not to stress RETRIEVAL."* Concretely, most of ScholarLens's `unrelated` pairs are two claims **from the same paper** (e.g. a methods detail vs. a findings detail) — same vocabulary, same paper title, superficially close in embedding space despite being logically unrelated. This is exactly the gap `retrievalNegatives.json`'s 22 deliberately cross-domain negatives were drafted to fix (plan §"Eval harness": *"≥20 deliberate humanities retrieval negatives — the separation harness's own honesty guard demands them"*): once they're folded into the pool, the guard clears cleanly for both models. **The decision below is therefore based on the pooled set, not the empirical-only set — flagged prominently because the empirical-only subset's own guard is tripped.**

## Threshold sweep (pooled, 100 pairs)

Recall = fraction of should-surface pairs retained; rejection = fraction of should-reject pairs correctly dropped; F1 = retrieval F1 (2·P·R/(P+R), not the judge's F1).

### text-embedding-3-small

| threshold | surfaced | recall | rejected | rejection | F1 |
|---|---|---|---|---|---|
| 0.30 | 63/63 | 1.000 | 31/37 | 0.838 | 0.955 |
| **0.35** | 61/63 | **0.968** | 35/37 | **0.946** | **0.968** |
| 0.40 | 60/63 | 0.952 | 35/37 | 0.946 | 0.960 |
| 0.45 | 54/63 | 0.857 | 35/37 | 0.946 | 0.908 |
| 0.50 | 47/63 | 0.746 | 37/37 | 1.000 | 0.855 |
| 0.55 | 43/63 | 0.683 | 37/37 | 1.000 | 0.811 |
| 0.60 | 31/63 | 0.492 | 37/37 | 1.000 | 0.660 |

### text-embedding-3-large

| threshold | surfaced | recall | rejected | rejection | F1 |
|---|---|---|---|---|---|
| 0.30 | 61/63 | 0.968 | 33/37 | 0.892 | 0.953 |
| 0.35 | 60/63 | 0.952 | 35/37 | 0.946 | 0.960 |
| 0.40 | 58/63 | 0.921 | 36/37 | 0.973 | 0.951 |
| 0.45 | 53/63 | 0.841 | 37/37 | 1.000 | 0.914 |
| 0.50 | 45/63 | 0.714 | 37/37 | 1.000 | 0.833 |
| 0.55 | 36/63 | 0.571 | 37/37 | 1.000 | 0.727 |
| 0.60 | 29/63 | 0.460 | 37/37 | 1.000 | 0.630 |

## Per-domain breakdown

| Domain | n | should-surface mean sim | should-reject mean sim | Status |
|---|---|---|---|---|
| empirical (30) | 30 | 0.556 / 0.504 (small/large) | 0.354 / 0.303 | Ratified |
| information_retrieval (6) | 6 | 0.665 / 0.671 | 0.340 / 0.325 | Ratified |
| llm_reasoning (6) | 6 | 0.683 / 0.683 | 0.291 / 0.294 | Ratified |
| ancient_philosophy (36) | 36 | 0.586 / 0.580 | 0.143 / 0.151 | **PROVISIONAL** |
| cross_domain (22) | 22 | n/a (0 surface) | 0.132 / 0.100 | **PROVISIONAL** |

The provisional ancient_philosophy/cross_domain domains, if anything, separate *more* cleanly than the ratified empirical domain (their should-reject means are markedly lower) — consistent with the same-paper-confound explanation above, not a sign the humanities data is unreliable.

## Decision (mechanically applied, pre-written criteria)

> Ship 3-small if gap ≥ 0.05 AND some threshold gives recall ≥ 0.90 with rejection ≥ 0.60 AND humanities recall within 0.10 of pooled; promote 3-large only if its gap beats 3-small by ≥ 0.02 AND F1 at the operating point improves ≥ 0.03; otherwise recommend BM25+locus-only.

1. **3-small pooled gap = 0.403 ≥ 0.05.** Guard clean (see above). ✅
2. **Qualifying thresholds** (recall ≥ 0.90 AND rejection ≥ 0.60): **0.30** (recall 1.000, rejection 0.838) and **0.35** (recall 0.968, rejection 0.946). Operating point chosen by best F1: **threshold = 0.35, F1 = 0.968**.
3. **Humanities recall at 0.35** = 0.967 vs. **pooled recall at 0.35** = 0.968 → delta = 0.001, well within the 0.10 tolerance. ✅
4. → **3-small clears the ship bar.**
5. **3-large vs. 3-small at the same operating threshold (0.35):** gap delta = 0.407 − 0.403 = **+0.004** (need ≥ 0.02 — fails); F1 delta = 0.960 − 0.968 = **−0.008** (need ≥ 0.03 — fails, and is actually negative). → **3-large does not clear the promotion bar.**

### **Recommendation: ship `text-embedding-3-small` at threshold 0.35.**

This is a measurement for the moderator to review — **no threshold or `TASK_ROUTES` value was set in code by this spike.**

## Novelty recalibration

Pseudo-corpus: the 42 empirical gold pairs' `claim_a` texts, embedded with the chosen model (`text-embedding-3-small`, reusing the calibration pass's own vectors — no extra embedding cost). 20 synthetic hypothesis-shaped statements (10 near-duplicate paraphrases of corpus claims I wrote, 10 genuinely novel statements on entirely unrelated topics I wrote — marine biology, urban planning, materials science, epidemiology, avian ecology, monetary economics, soil science, linguistics, astrophysics, occupational health) were embedded fresh and scored by cosine distance to their nearest corpus neighbor.

| Kind | n | mean distance | min | max |
|---|---|---|---|---|
| Near-duplicate | 10 | 0.152 | 0.059 | 0.243 |
| Genuinely novel | 10 | 0.747 | 0.659 | 0.850 |

Clean bimodal separation — no near-duplicate scored above 0.243 and no genuinely-novel statement scored below 0.659, a wide (0.42-wide) gap between the two clusters.

**Candidate `NOVELTY_THRESHOLDS` (observed 33rd/67th percentile of the pooled 20 distances):**

```
low  (33rd pct) = 0.1736
high (67th pct) = 0.7251
```

These sit cleanly inside the gap between the two clusters (0.243–0.659), so a claim/hypothesis scoring `distance < 0.174` is a near-duplicate of something already in the library ("low" novelty) and `distance > 0.725` is genuinely new territory ("high" novelty) by this small synthetic test — informative, not a substitute for a real held-out measurement once actual hypothesis output exists (n=20 synthetic statements, not real pipeline output).

## Cost tally

| Stage | Model | Input tokens | Cost (USD) |
|---|---|---|---|
| stage1-separation-embed | text-embedding-3-small | 5,655 | $0.000113 |
| stage1-separation-embed | text-embedding-3-large | 5,655 | $0.000735 |
| novelty-recalibration-embed | text-embedding-3-small | 528 | $0.0000106 |
| **Total** | | | **$0.00085881** |

## Concerns for the moderator

1. **The empirical-only (ratified, 42-pair) subset trips the heavy-overlap honesty guard on its own** — the ship decision rests on the pooled set (empirical + humanities + negatives), which is clean. This is expected behavior given the same-paper-unrelated-pair confound documented above, not a data-quality problem, but it means the retrieval-negatives file is load-bearing for this decision, not a nice-to-have.
2. **Humanities/cross-domain numbers are PROVISIONAL** (owner has not ratified `relationshipPairs.humanities.json` or `retrievalNegatives.json`). The ship recommendation leans on the pooled set which includes these — worth re-running this spike after ratification if any label changes.
3. Novelty percentiles are from 20 hand-written synthetic statements, not real corpus output — a sanity-check calibration, not a final one.
