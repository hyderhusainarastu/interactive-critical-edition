# Phase 29.3 — RAG Hybrid-Retrieval Eval

**Script:** `scripts/research/rag-retrieval-eval.mts` · **Raw data:** `rag-hybrid-retrieval-eval.raw.json` · **Run:** 2026-07-26T05:53:44.971Z · **Cost: $0.000074**

## What this measures

A design audit found `rag_chunk.embedding` is written (and paid for) at index time but never read at retrieval — `retrieveOwnerRagChunks` (`packages/rag/src/index.ts`) ranks purely with the deterministic `lexicalScore`/`rankLexically` formula. `packages/rag/src/hybridRetrieval.ts` adds a dense (cosine over stored embeddings) + BM25 union, behind `RAG_HYBRID_RETRIEVAL` (default off). This script ranks each of the 25 ported ScholarLens `rerank_eval` gold queries' own candidate passages twice — once with the exact `rankLexically` function (today's production ranking), once with the exact `rankHybrid` function (dense+BM25 union, **no reranker**) — and scores nDCG@5 and MRR (relevance >= 2 counts as "relevant") against the gold 0-3 relevance grades. Both calls go through the real `@ice/rag` code, not a reimplementation.

## Headline result

| Metric | Lexical (today) | Hybrid (dense+BM25) | Delta |
|---|---|---|---|
| nDCG@5 (mean over 25 queries) | 0.8977 | 0.9350 | +0.0373 |
| MRR (mean over 25 queries) | 0.9600 | 0.9800 | +0.0200 |

**Verdict:** Hybrid retrieval shows a measurable improvement (nDCG@5 delta 0.0373, MRR delta 0.0200) — a real, if modest, recall gain over lexical-only ranking on this 25-query gold set.

A delta is only called "meaningful" at or above 0.02 absolute — small enough to catch a real effect, large enough not to over-read a 25-query sample (the ScholarLens eval-honesty pattern this lane is asked to follow: "no meaningful difference" is a legitimate, reportable outcome, not a failure to find one).

## Per-query detail

| id | candidates | nDCG@5 lexical | nDCG@5 hybrid | MRR lexical | MRR hybrid |
|---|---|---|---|---|---|
| s1 | 7 | 0.683 | 0.903 | 0.500 | 1.000 |
| s2 | 7 | 0.878 | 0.903 | 1.000 | 1.000 |
| s3 | 6 | 0.659 | 0.871 | 1.000 | 1.000 |
| s4 | 6 | 1.000 | 0.863 | 1.000 | 1.000 |
| s5 | 6 | 0.704 | 0.921 | 1.000 | 1.000 |
| s6 | 6 | 0.936 | 0.903 | 1.000 | 1.000 |
| s7 | 6 | 1.000 | 0.957 | 1.000 | 1.000 |
| s8 | 6 | 0.524 | 1.000 | 1.000 | 1.000 |
| s9 | 5 | 0.994 | 0.934 | 1.000 | 1.000 |
| s10 | 5 | 0.748 | 0.934 | 0.500 | 1.000 |
| s11 | 6 | 0.990 | 0.990 | 1.000 | 1.000 |
| s12 | 6 | 0.961 | 0.990 | 1.000 | 1.000 |
| s13 | 6 | 0.930 | 0.921 | 1.000 | 1.000 |
| s14 | 5 | 1.000 | 0.936 | 1.000 | 1.000 |
| s15 | 6 | 0.850 | 1.000 | 1.000 | 1.000 |
| s16 | 7 | 0.810 | 0.952 | 1.000 | 1.000 |
| s17 | 7 | 0.940 | 0.962 | 1.000 | 1.000 |
| s18 | 7 | 1.000 | 0.962 | 1.000 | 1.000 |
| s19 | 6 | 0.996 | 1.000 | 1.000 | 1.000 |
| s20 | 6 | 0.903 | 0.903 | 1.000 | 1.000 |
| s21 | 7 | 1.000 | 1.000 | 1.000 | 1.000 |
| s22 | 6 | 0.936 | 0.936 | 1.000 | 1.000 |
| s23 | 6 | 1.000 | 0.878 | 1.000 | 1.000 |
| s24 | 6 | 1.000 | 1.000 | 1.000 | 1.000 |
| s25 | 6 | 1.000 | 0.757 | 1.000 | 0.500 |

## Method notes

- Embedding model: `text-embedding-3-small` (`OPENAI_EMBEDDING_MODEL` default), 3697 input tokens total, real measured cost $0.000074 (hard cap $0.10; this ran at a small fraction of it).
- Every query's own candidate-passage set is the corpus for that query only (matching the gold set's own shape) — this is a per-query relevance-ranking eval, not a full-Library retrieval simulation.
- A ranking that drops a relevant passage entirely (both `rankLexically` and `rankHybrid` filter out zero-score rows) is scored as if that passage were ranked below the cutoff — the honest outcome, not excused from the comparison.
- No reranker of any kind is used on either side, per the task scope.
