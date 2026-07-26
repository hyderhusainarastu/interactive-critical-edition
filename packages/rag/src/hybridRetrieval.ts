import { Bm25Index, cosineSimilarity } from "@ice/claims";
import { OpenAIEmbeddingsClient, type EmbeddingResult } from "@ice/ai-adapters";

import { rankLexically } from "./lexicalRetrieval";

/**
 * Phase 29.3 (ScholarLens reverse-direction lane): hybrid dense+BM25
 * retrieval for Ask Library. The design audit that scoped this lane found
 * `rag_chunk.embedding` is written (and paid for) at index time but never
 * read at retrieval — `retrieveOwnerRagChunks` in `./index.ts` ranks purely
 * with `lexicalScore`/`rankLexically`. This module adds the missing dense
 * pass and a lexical BM25 pass (reusing `@ice/claims/retrieval`, the same
 * pure primitives the claim-comparison pipeline uses), unioned with
 * per-chunk channel provenance, entirely behind `RAG_HYBRID_RETRIEVAL`
 * (default OFF — see `ragHybridRetrievalEnabled`). Every function here is
 * pure except `defaultEmbedQuery`, so the ranking logic itself is fully
 * unit-testable without a database or a live provider key.
 */

const HYBRID_TRUTHY = ["1", "true", "yes", "on"];
const HYBRID_FALSY = ["0", "false", "no", "off"];

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (HYBRID_TRUTHY.includes(normalized)) return true;
  if (HYBRID_FALSY.includes(normalized)) return false;
  return undefined;
}

/** Release flag for hybrid retrieval, `parseBoolean`'d per the house pattern
 *  (packages/config's phase12/18/22/25 flags) and documented in
 *  `.env.example`. Kept local to this package rather than added to
 *  `@ice/config` — it gates a pure ranking strategy inside `@ice/rag`
 *  itself, not a user-facing surface a route needs to check. */
export function ragHybridRetrievalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return parseBoolean(env.RAG_HYBRID_RETRIEVAL) ?? false;
}

export type RetrievalChannel = "dense" | "bm25";

export interface ChannelScore {
  channel: RetrievalChannel;
  /** Normalized to [0,1] within that channel, for this query only — see
   *  `rankHybrid`'s doc comment for the normalization rule. */
  score: number;
}

export interface HybridScoredRow<T> {
  row: T;
  /** The combination score used for ranking (see `rankHybrid`). */
  score: number;
  /** Every channel that independently surfaced this row, each with that
   *  channel's own normalized score — a row found by both channels keeps
   *  both entries, never collapsed into one number. `channels.length` tells
   *  a caller "dense", "bm25", or "both" without a separate tag. */
  channels: ChannelScore[];
}

export interface EmbeddableRow {
  content: string;
  /** The chunk's stored embedding vector, or `null` when none was captured
   *  at index time (e.g. it was indexed before an embedding provider was
   *  configured, or beyond `RAG_MAX_AUTOMATIC_EMBEDDINGS`). */
  embedding: number[] | null;
  /** The model that produced `embedding`, or `null` alongside a `null`
   *  embedding. Compared against the query embedding's own model before any
   *  cosine similarity is computed (see `rankHybrid`). */
  embeddingModel: string | null;
}

export interface QueryEmbedding {
  model: string;
  embedding: number[];
}

/**
 * Hybrid dense+BM25 ranking over rows already scoped to the owner (SQL
 * predicate stays the caller's job — same division of labor as the existing
 * `rankLexically`). Never re-embeds a chunk at query time: only the query
 * itself is embedded by the caller: this function only ever *reads* a
 * chunk's already-stored embedding.
 *
 * Combination rule ("normalized max"): each channel's raw scores are first
 * normalized to [0,1] by dividing by that channel's own top score *for this
 * query* — `Bm25Index.query` already does this for BM25; the dense pass
 * mirrors it here. A row's final score is then the MAX of its normalized
 * per-channel scores. This is deliberately not a weighted sum: a weighted
 * combination needs its own calibration (relative channel weight), which
 * this lane's eval (`scripts/research/rag-retrieval-eval.mts`) does not
 * attempt to fit; "rank as high as your best-supporting channel says you
 * should" is simple, requires no calibration, and is not gameable by one
 * channel independently — while `channels` on the returned row keeps BOTH
 * channels' own scores, so nothing about a multi-channel match is lost, only
 * the ranking key is a max rather than a sum.
 *
 * A row's stored embedding participates in the dense channel only when its
 * `embeddingModel` equals the query embedding's own model — comparing
 * vectors from two different embedding spaces (different dimensionality, or
 * the same dimensionality from an unrelated projection) would produce a
 * meaningless cosine score, so it is never attempted implicitly (the
 * default/override embedding model, `OPENAI_EMBEDDING_MODEL`, can change
 * over a Library's lifetime). Rows with no stored embedding, or a
 * mismatched one, are scored by BM25 alone — they are never dropped outright
 * and never re-embedded here.
 *
 * A row with zero support from every channel (no BM25 term overlap and
 * either no dense score or a non-positive one) is dropped, matching
 * `rankLexically`'s existing "a query needs real evidence" behavior.
 */
export function rankHybrid<T extends EmbeddableRow>(
  query: string,
  rows: readonly T[],
  queryEmbedding: QueryEmbedding | null,
  limit: number,
): HybridScoredRow<T>[] {
  const bm25Matches = rows.length >= 2 ? new Bm25Index(rows.map((row) => row.content)).query(query, rows.length) : [];
  const bm25ByIndex = new Map(bm25Matches.map((match) => [match.docIndex, match.score]));

  const denseByIndex = new Map<number, number>();
  if (queryEmbedding) {
    const raw = rows.map((row) =>
      row.embedding && row.embeddingModel === queryEmbedding.model
        ? cosineSimilarity(queryEmbedding.embedding, row.embedding)
        : null,
    );
    const positive = raw.filter((value): value is number => value !== null && value > 0);
    const max = positive.length ? Math.max(...positive) : 0;
    if (max > 0) {
      raw.forEach((value, index) => {
        if (value !== null && value > 0) denseByIndex.set(index, value / max);
      });
    }
  }

  const scored = rows.map((row, index) => {
    const channels: ChannelScore[] = [];
    const bm25Score = bm25ByIndex.get(index);
    if (bm25Score !== undefined) channels.push({ channel: "bm25", score: bm25Score });
    const denseScore = denseByIndex.get(index);
    if (denseScore !== undefined) channels.push({ channel: "dense", score: denseScore });
    const score = channels.length ? Math.max(...channels.map((c) => c.score)) : 0;
    return { row, index, score, channels };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ row, score, channels }) => ({ row, score, channels }));
}

export type EmbedQuery = (text: string) => Promise<EmbeddingResult>;

/** Same client/model resolution `apps/worker/src/extraction.ts` uses to
 *  embed chunks at index time (`OPENAI_API_KEY` + `OPENAI_EMBEDDING_MODEL`,
 *  default `text-embedding-3-small`) — so a query embedded through this
 *  default is, by default, comparable to a chunk embedded at index time
 *  under an unchanged environment. Throws when no key is configured; every
 *  caller here treats that as an honest "no provider" signal to catch, not
 *  a special case to check for separately. */
export async function defaultEmbedQuery(text: string): Promise<EmbeddingResult> {
  const client = new OpenAIEmbeddingsClient();
  if (!client.available) throw new Error("No embedding provider is configured for RAG hybrid retrieval");
  return client.embed(text);
}

/**
 * Pure orchestrator between the flag, the embedding attempt, and the two
 * ranking strategies — factored out of `retrieveOwnerRagChunks` (which is
 * DB-bound) so this decision logic is unit-testable with a mock
 * `embedQuery` and no database. Degrades honestly, twice over:
 *   - `hybridEnabled: false` → identical to today: `rankLexically` only.
 *   - `hybridEnabled: true` but `embedQuery` throws (no key/provider, or a
 *     transient failure) → falls back to the SAME `rankLexically` call,
 *     not a partial BM25-only ranking — a caller with the flag on but no
 *     working embedding provider sees exactly today's behavior, not a
 *     different-but-still-lexical one.
 */
export async function rankOwnerChunks<T extends EmbeddableRow>(
  query: string,
  rows: readonly T[],
  limit: number,
  options: { hybridEnabled: boolean; embedQuery?: EmbedQuery },
): Promise<T[]> {
  if (!options.hybridEnabled) return rankLexically(query, rows, limit);
  const embedQuery = options.embedQuery ?? defaultEmbedQuery;
  let queryEmbedding: QueryEmbedding | null = null;
  try {
    const embedded = await embedQuery(query);
    queryEmbedding = { model: embedded.model, embedding: embedded.embedding };
  } catch {
    // Honest degrade: no embedding provider configured, or the call failed.
    // Never fabricate a vector and never silently drop to a *different*
    // lexical formula — fall back to the exact same path the flag-off case
    // uses.
    return rankLexically(query, rows, limit);
  }
  return rankHybrid(query, rows, queryEmbedding, limit).map((entry) => entry.row);
}
