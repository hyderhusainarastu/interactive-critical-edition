/**
 * Phase 29.3 — RAG hybrid-retrieval eval.
 *
 * A design audit found `rag_chunk.embedding` is written (and paid for) at
 * index time but never read at retrieval — `retrieveOwnerRagChunks`
 * (packages/rag/src/index.ts) ranks purely with the deterministic
 * `lexicalScore`/`rankLexically` formula. `packages/rag/src/hybridRetrieval.ts`
 * adds a dense+BM25 union behind `RAG_HYBRID_RETRIEVAL` (default off); this
 * script measures whether turning it on is actually worth it, using the
 * ported ScholarLens `rerank_eval` search-relevance gold set
 * (packages/claims/src/eval/gold/searchQueries.json — 25 graded queries).
 *
 * Per query, this ranks that query's OWN candidate passages twice — once
 * with `rankLexically` (today's production ranking), once with `rankHybrid`
 * (dense+BM25 union, NO reranker) — and scores each ranking's nDCG@5 and
 * MRR against the gold relevance grades (0-3). Both ranking calls go
 * through the exact `@ice/rag` functions `retrieveOwnerRagChunks` itself
 * uses, not a reimplementation, so this measures the real code path.
 *
 * Run: npx tsx scripts/research/rag-retrieval-eval.mts
 * Cost: hard-capped at $0.10 (see COST_HARD_CAP_USD below); real measured
 * total is written to the output files and printed at the end.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorkerEnv } from "./env.mjs";
import { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd } from "../../packages/ai-adapters/src/embeddings";
import { rankLexically } from "../../packages/rag/src/lexicalRetrieval";
import { rankHybrid, type EmbeddableRow } from "../../packages/rag/src/hybridRetrieval";
import { parseGoldSearchQueriesFile, type GoldSearchQuery } from "../../packages/claims/src/eval/goldSchema";

loadWorkerEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLD_PATH = join(__dirname, "../../packages/claims/src/eval/gold/searchQueries.json");
const OUT_DIR = join(__dirname, "../../docs/eval/research-claims");

const COST_HARD_CAP_USD = 0.10;
/** A gold passage/query pair counts as "relevant" for MRR purposes at this
 *  relevance grade or above. The gold scale is 0-3 (see searchQueries.json);
 *  2 ("relevant, on-topic support") is the conventional graded->binary cut
 *  used for MRR — 1 is "marginally related" (often true but not what a
 *  reader asked for), which MRR would otherwise over-credit. */
const MRR_RELEVANCE_THRESHOLD = 2;
const NDCG_K = 5;

interface CandidateRow extends EmbeddableRow {
  relevance: number;
}

function dcgAt(relevancesInOrder: number[], k: number): number {
  return relevancesInOrder.slice(0, k).reduce((sum, rel, i) => sum + (Math.pow(2, rel) - 1) / Math.log2(i + 2), 0);
}

/** Standard graded nDCG@k. `allRelevances` (the full candidate set's gold
 *  grades, not just what a ranking returned) determines the ideal ordering
 *  — a ranking that silently drops a relevant passage (this package's
 *  ranking functions filter out zero-score rows) is scored exactly as if
 *  that passage were ranked below cutoff, which is the honest outcome: a
 *  dropped-but-relevant passage should cost the ranking, not be excused
 *  from the comparison. */
function ndcgAt(relevancesInOrder: number[], allRelevances: number[], k: number): number {
  const dcg = dcgAt(relevancesInOrder, k);
  const idcg = dcgAt([...allRelevances].sort((a, b) => b - a), k);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** Reciprocal rank of the first passage in ranked order whose gold relevance
 *  is >= MRR_RELEVANCE_THRESHOLD; 0 when no returned passage clears it
 *  (including "the ranking returned nothing"). */
function reciprocalRank(relevancesInOrder: number[], threshold: number): number {
  const index = relevancesInOrder.findIndex((rel) => rel >= threshold);
  return index === -1 ? 0 : 1 / (index + 1);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

interface PerQueryResult {
  id: string;
  query: string;
  nCandidates: number;
  lexical: { ndcg5: number; mrr: number; nReturned: number };
  hybrid: { ndcg5: number; mrr: number; nReturned: number };
}

interface RawEvalOutput {
  generatedAt: string;
  goldCount: number;
  embeddingModel: string;
  costUsd: number;
  inputTokens: number;
  ndcgK: number;
  mrrRelevanceThreshold: number;
  meaningfulDeltaThreshold: number;
  summary: {
    lexical: { ndcg5: number; mrr: number };
    hybrid: { ndcg5: number; mrr: number };
    ndcgDelta: number;
    mrrDelta: number;
    verdict: string;
  };
  perQuery: PerQueryResult[];
}

async function main() {
  const goldQueries: GoldSearchQuery[] = parseGoldSearchQueriesFile(readFileSync(GOLD_PATH, "utf8"));
  console.log(`Loaded ${goldQueries.length} gold search queries.`);

  const client = new OpenAIEmbeddingsClient();
  if (!client.available) {
    throw new Error("OPENAI_API_KEY not configured (checked apps/worker/.env via loadWorkerEnv) — cannot run a real embedding eval.");
  }

  // Embed every query and every one of its candidate passages in as few
  // batched calls as possible (embedMany batches internally at 128/call).
  // Order is queries first, then each query's passages in a flat list, so a
  // single index map recovers everything after one embedMany response.
  const texts: string[] = [];
  const textOwners: Array<{ kind: "query" | "passage"; queryIndex: number; passageIndex?: number }> = [];
  goldQueries.forEach((gold, queryIndex) => {
    texts.push(gold.query);
    textOwners.push({ kind: "query", queryIndex });
    gold.passages.forEach((_passage, passageIndex) => {
      texts.push(gold.passages[passageIndex]!.text);
      textOwners.push({ kind: "passage", queryIndex, passageIndex });
    });
  });

  // Rough pre-flight estimate (chars/4 as a token proxy) before spending
  // anything — this corpus is tiny (~25 queries + ~150-175 short passages),
  // so this is expected to clear the cap by a wide margin; abort rather
  // than call the API if it somehow wouldn't.
  const roughTokenEstimate = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
  const roughCostEstimate = estimateEmbeddingCostUsd("text-embedding-3-small", roughTokenEstimate);
  console.log(`Pre-flight estimate: ${texts.length} texts, ~${roughTokenEstimate} tokens, ~$${roughCostEstimate.toFixed(6)}`);
  if (roughCostEstimate > COST_HARD_CAP_USD) {
    throw new Error(`Pre-flight cost estimate $${roughCostEstimate.toFixed(6)} exceeds the $${COST_HARD_CAP_USD} hard cap — aborting before any call.`);
  }

  const embedded = await client.embedMany(texts);
  const realCostUsd = estimateEmbeddingCostUsd(embedded.model, embedded.inputTokens);
  console.log(`Embedded ${embedded.vectors.length} texts with ${embedded.model} (${embedded.inputTokens} input tokens): $${realCostUsd.toFixed(6)}`);
  if (realCostUsd > COST_HARD_CAP_USD) {
    throw new Error(`Measured cost $${realCostUsd.toFixed(6)} exceeds the $${COST_HARD_CAP_USD} hard cap.`);
  }

  const queryEmbeddings = new Map<number, number[]>();
  const passageEmbeddings = new Map<string, number[]>(); // key: `${queryIndex}:${passageIndex}`
  textOwners.forEach((owner, i) => {
    const vector = embedded.vectors[i];
    if (!vector) return;
    if (owner.kind === "query") queryEmbeddings.set(owner.queryIndex, vector);
    else passageEmbeddings.set(`${owner.queryIndex}:${owner.passageIndex}`, vector);
  });

  const perQuery: PerQueryResult[] = goldQueries.map((gold, queryIndex) => {
    const rows: CandidateRow[] = gold.passages.map((passage, passageIndex) => ({
      content: passage.text,
      relevance: passage.relevance,
      embedding: passageEmbeddings.get(`${queryIndex}:${passageIndex}`) ?? null,
      embeddingModel: passageEmbeddings.has(`${queryIndex}:${passageIndex}`) ? embedded.model : null,
    }));
    const allRelevances = rows.map((r) => r.relevance);

    // (a) current production ranking — unmodified `rankLexically`.
    const lexicalRanked = rankLexically(gold.query, rows, rows.length);
    const lexicalRelevances = lexicalRanked.map((r) => r.relevance);

    // (b) hybrid dense+BM25 union — unmodified `rankHybrid`, no reranker.
    const queryVector = queryEmbeddings.get(queryIndex);
    const hybridRanked = queryVector
      ? rankHybrid(gold.query, rows, { model: embedded.model, embedding: queryVector }, rows.length).map((entry) => entry.row)
      : [];
    const hybridRelevances = hybridRanked.map((r) => r.relevance);

    return {
      id: gold.id,
      query: gold.query,
      nCandidates: rows.length,
      lexical: { ndcg5: ndcgAt(lexicalRelevances, allRelevances, NDCG_K), mrr: reciprocalRank(lexicalRelevances, MRR_RELEVANCE_THRESHOLD), nReturned: lexicalRanked.length },
      hybrid: { ndcg5: ndcgAt(hybridRelevances, allRelevances, NDCG_K), mrr: reciprocalRank(hybridRelevances, MRR_RELEVANCE_THRESHOLD), nReturned: hybridRanked.length },
    };
  });

  const lexicalNdcg5 = mean(perQuery.map((q) => q.lexical.ndcg5));
  const lexicalMrr = mean(perQuery.map((q) => q.lexical.mrr));
  const hybridNdcg5 = mean(perQuery.map((q) => q.hybrid.ndcg5));
  const hybridMrr = mean(perQuery.map((q) => q.hybrid.mrr));

  const ndcgDelta = hybridNdcg5 - lexicalNdcg5;
  const mrrDelta = hybridMrr - lexicalMrr;
  // Deliberately conservative: a genuinely measured improvement, not a
  // rounding artifact of a 25-query sample, per the ScholarLens
  // eval-honesty pattern this lane is asked to follow ("no meaningful
  // difference" is a legitimate, reportable verdict).
  const MEANINGFUL_DELTA = 0.02;
  const meaningfulOnNdcg = ndcgDelta >= MEANINGFUL_DELTA;
  const meaningfulOnMrr = mrrDelta >= MEANINGFUL_DELTA;
  const regressedOnNdcg = ndcgDelta <= -MEANINGFUL_DELTA;
  const regressedOnMrr = mrrDelta <= -MEANINGFUL_DELTA;

  let verdict: string;
  if (regressedOnNdcg || regressedOnMrr) {
    verdict = `Hybrid retrieval REGRESSES on this gold set (nDCG@5 delta ${ndcgDelta.toFixed(4)}, MRR delta ${mrrDelta.toFixed(4)}) — do not enable RAG_HYBRID_RETRIEVAL on this evidence.`;
  } else if (meaningfulOnNdcg || meaningfulOnMrr) {
    verdict = `Hybrid retrieval shows a measurable improvement (nDCG@5 delta ${ndcgDelta.toFixed(4)}, MRR delta ${mrrDelta.toFixed(4)}) — a real, if modest, recall gain over lexical-only ranking on this 25-query gold set.`;
  } else {
    verdict = `No meaningful difference between hybrid and lexical-only ranking on this gold set (nDCG@5 delta ${ndcgDelta.toFixed(4)}, MRR delta ${mrrDelta.toFixed(4)}) — both clear the ${MEANINGFUL_DELTA} threshold neither direction. RAG_HYBRID_RETRIEVAL should stay off pending either a larger/more representative gold set or a real product-usage signal, per this program's eval-honesty standard.`;
  }
  console.log(`\n${verdict}`);
  console.log(`Lexical: nDCG@5=${lexicalNdcg5.toFixed(4)} MRR=${lexicalMrr.toFixed(4)}`);
  console.log(`Hybrid:  nDCG@5=${hybridNdcg5.toFixed(4)} MRR=${hybridMrr.toFixed(4)}`);
  console.log(`\nTOTAL COST: $${realCostUsd.toFixed(6)}`);

  const rawOut: RawEvalOutput = {
    generatedAt: new Date().toISOString(),
    goldCount: goldQueries.length,
    embeddingModel: embedded.model,
    costUsd: realCostUsd,
    inputTokens: embedded.inputTokens,
    ndcgK: NDCG_K,
    mrrRelevanceThreshold: MRR_RELEVANCE_THRESHOLD,
    meaningfulDeltaThreshold: MEANINGFUL_DELTA,
    summary: {
      lexical: { ndcg5: lexicalNdcg5, mrr: lexicalMrr },
      hybrid: { ndcg5: hybridNdcg5, mrr: hybridMrr },
      ndcgDelta,
      mrrDelta,
      verdict,
    },
    perQuery,
  };
  writeFileSync(join(OUT_DIR, "rag-hybrid-retrieval-eval.raw.json"), JSON.stringify(rawOut, null, 2));

  const md = renderMarkdown(rawOut);
  writeFileSync(join(OUT_DIR, "rag-hybrid-retrieval-eval.md"), md);

  return rawOut;
}

function renderMarkdown(raw: RawEvalOutput): string {
  const rows = raw.perQuery.map((q) =>
    `| ${q.id} | ${q.nCandidates} | ${q.lexical.ndcg5.toFixed(3)} | ${q.hybrid.ndcg5.toFixed(3)} | ${q.lexical.mrr.toFixed(3)} | ${q.hybrid.mrr.toFixed(3)} |`,
  ).join("\n");
  return `# Phase 29.3 — RAG Hybrid-Retrieval Eval

**Script:** \`scripts/research/rag-retrieval-eval.mts\` · **Raw data:** \`rag-hybrid-retrieval-eval.raw.json\` · **Run:** ${raw.generatedAt} · **Cost: $${raw.costUsd.toFixed(6)}**

## What this measures

A design audit found \`rag_chunk.embedding\` is written (and paid for) at index time but never read at retrieval — \`retrieveOwnerRagChunks\` (\`packages/rag/src/index.ts\`) ranks purely with the deterministic \`lexicalScore\`/\`rankLexically\` formula. \`packages/rag/src/hybridRetrieval.ts\` adds a dense (cosine over stored embeddings) + BM25 union, behind \`RAG_HYBRID_RETRIEVAL\` (default off). This script ranks each of the ${raw.goldCount} ported ScholarLens \`rerank_eval\` gold queries' own candidate passages twice — once with the exact \`rankLexically\` function (today's production ranking), once with the exact \`rankHybrid\` function (dense+BM25 union, **no reranker**) — and scores nDCG@${raw.ndcgK} and MRR (relevance >= ${raw.mrrRelevanceThreshold} counts as "relevant") against the gold 0-3 relevance grades. Both calls go through the real \`@ice/rag\` code, not a reimplementation.

## Headline result

| Metric | Lexical (today) | Hybrid (dense+BM25) | Delta |
|---|---|---|---|
| nDCG@${raw.ndcgK} (mean over ${raw.goldCount} queries) | ${raw.summary.lexical.ndcg5.toFixed(4)} | ${raw.summary.hybrid.ndcg5.toFixed(4)} | ${raw.summary.ndcgDelta >= 0 ? "+" : ""}${raw.summary.ndcgDelta.toFixed(4)} |
| MRR (mean over ${raw.goldCount} queries) | ${raw.summary.lexical.mrr.toFixed(4)} | ${raw.summary.hybrid.mrr.toFixed(4)} | ${raw.summary.mrrDelta >= 0 ? "+" : ""}${raw.summary.mrrDelta.toFixed(4)} |

**Verdict:** ${raw.summary.verdict}

A delta is only called "meaningful" at or above ${raw.meaningfulDeltaThreshold} absolute — small enough to catch a real effect, large enough not to over-read a 25-query sample (the ScholarLens eval-honesty pattern this lane is asked to follow: "no meaningful difference" is a legitimate, reportable outcome, not a failure to find one).

## Per-query detail

| id | candidates | nDCG@${raw.ndcgK} lexical | nDCG@${raw.ndcgK} hybrid | MRR lexical | MRR hybrid |
|---|---|---|---|---|---|
${rows}

## Method notes

- Embedding model: \`${raw.embeddingModel}\` (\`OPENAI_EMBEDDING_MODEL\` default), ${raw.inputTokens} input tokens total, real measured cost $${raw.costUsd.toFixed(6)} (hard cap $0.10; this ran at a small fraction of it).
- Every query's own candidate-passage set is the corpus for that query only (matching the gold set's own shape) — this is a per-query relevance-ranking eval, not a full-Library retrieval simulation.
- A ranking that drops a relevant passage entirely (both \`rankLexically\` and \`rankHybrid\` filter out zero-score rows) is scored as if that passage were ranked below the cutoff — the honest outcome, not excused from the comparison.
- No reranker of any kind is used on either side, per the task scope.
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
