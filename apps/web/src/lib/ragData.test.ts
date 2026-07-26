import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { estimateEmbeddingCostUsd } from "@ice/ai-adapters";
import { aiUsageLogs, db, ragChunks } from "@ice/db";
import { answerRagConversation, createRagConversation } from "@/lib/ragData";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "../../e2e/helpers";

/**
 * Phase 29.3 follow-up (the hybrid-RAG lane's own flagged prerequisite,
 * applied at merge time): `retrieveOwnerRagChunks`'s hybrid path
 * (`packages/rag/src/hybridRetrieval.ts`) runs a real query-embedding call
 * whenever `RAG_HYBRID_RETRIEVAL` is on, but nothing logged that call's cost
 * to `ai_usage_log` — every other paid call this file makes (the Socratic
 * completion, and `apps/worker/src/extraction.ts`'s chunk-indexing
 * embeddings) is logged, so a query embedding was the one paid call in this
 * flow invisible to the cost ledger. This proves `answerRagConversation`
 * now writes exactly one `socratic_rag_query_embedding` usage row per
 * hybrid-enabled call, with real token counts/model/cost, and writes NONE
 * when the flag is off — same framework-free `tsx` + mocked-fetch + real-DB
 * convention as `competencyData.test.ts`, transitively importing `@ice/db`.
 * Run via:
 *
 *   cd apps/web && DATABASE_URL=postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition \
 *     ../worker/node_modules/.bin/tsx src/lib/ragData.test.ts
 *
 * `PHASE_18_RAG_PROVIDER_ENABLED` is deliberately left unset (default
 * false), so the Socratic *completion* call always takes the zero-cost
 * deterministic fallback in both cases below — this test is scoped to the
 * query-EMBEDDING call only, so it never has to also mock the separate
 * Responses-API completion shape `competencyData.test.ts` already covers.
 */

process.env.OPENAI_API_KEY = "sk-test-rag-hybrid-embedding";

const realFetch = globalThis.fetch;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_TASK = "socratic_rag_query_embedding";

function embeddingResponse(promptTokens: number) {
  const body = {
    data: [{ embedding: Array.from({ length: 8 }, () => 0.01), index: 0 }],
    model: EMBEDDING_MODEL,
    usage: { prompt_tokens: promptTokens },
  };
  const text = JSON.stringify(body);
  return { ok: true, status: 200, json: async () => body, text: async () => text } as unknown as Response;
}

/** Every call answers as a successful single-vector embeddings response —
 *  sufficient for both tests, since neither depends on retry/failure paths
 *  (those belong to `hybridRetrieval.test.ts`'s own pure-function coverage). */
function installEmbeddingFetch(promptTokens: number) {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return embeddingResponse(promptTokens);
  }) as unknown as typeof fetch;
  return () => calls;
}

async function seedConversation(emailTag: string) {
  const email = `e2e-rag-hybrid-embedding-${emailTag}-${Date.now()}@example.com`;
  const userId = await createVerifiedTestUser(email, "password123");
  const seeded = await seedPublishedEdition(userId);
  // Three chunks, not one or two: BM25's IDF formula gives a term appearing
  // in exactly 1 of a 2-document corpus a raw IDF of EXACTLY zero
  // (log((N-freq+0.5)/(freq+0.5)) with N=2, freq=1 is log(1.5/1.5)=0), which
  // zeroes every score and makes `Bm25Index.query` return nothing at all —
  // a real degenerate property of tiny corpora, not a hybrid-retrieval bug.
  // A third, differently-worded unrelated chunk (N=3) gives the body
  // chunk's distinctive terms a genuinely positive IDF, so BM25 actually
  // surfaces it, same as a real multi-chunk Library would.
  await db.insert(ragChunks).values([
    {
      userId,
      workId: seeded.workId,
      documentId: seeded.documentId,
      processingRunId: seeded.runId,
      textBlockId: seeded.bodyBlockId,
      sourceType: "uploaded",
      sourceKey: `text-block:${seeded.bodyBlockId}`,
      chunkIndex: 0,
      content: "Vicious people act on decision, yet live according to passion. Vice remains a state on which one decides.",
      contentHash: `rag-hybrid-embedding-body-${emailTag}`,
      anchor: {
        kind: "reader",
        href: `/works/${seeded.workId}/reader#block-${seeded.bodyBlockId}`,
        workId: seeded.workId,
        processingRunId: seeded.runId,
        pageIndex: 0,
        textBlockId: seeded.bodyBlockId,
        blockOrder: 1,
        startOffset: 0,
        endOffset: 106,
      },
    },
    {
      userId,
      workId: seeded.workId,
      documentId: seeded.documentId,
      processingRunId: seeded.runId,
      textBlockId: seeded.bodyBlockId,
      sourceType: "uploaded",
      sourceKey: `text-block:${seeded.bodyBlockId}:unrelated`,
      chunkIndex: 1,
      content: "An unrelated passage about tidal astronomy and lunar calendars, sharing no vocabulary with the question below.",
      contentHash: `rag-hybrid-embedding-unrelated-${emailTag}`,
      anchor: {
        kind: "reader",
        href: `/works/${seeded.workId}/reader#block-${seeded.bodyBlockId}`,
        workId: seeded.workId,
        processingRunId: seeded.runId,
        pageIndex: 0,
        textBlockId: seeded.bodyBlockId,
        blockOrder: 2,
        startOffset: 106,
        endOffset: 200,
      },
    },
    {
      userId,
      workId: seeded.workId,
      documentId: seeded.documentId,
      processingRunId: seeded.runId,
      textBlockId: seeded.bodyBlockId,
      sourceType: "uploaded",
      sourceKey: `text-block:${seeded.bodyBlockId}:unrelated-2`,
      chunkIndex: 2,
      content: "A separate note on medieval manuscript pigments, likewise sharing no vocabulary with the question below.",
      contentHash: `rag-hybrid-embedding-unrelated-2-${emailTag}`,
      anchor: {
        kind: "reader",
        href: `/works/${seeded.workId}/reader#block-${seeded.bodyBlockId}`,
        workId: seeded.workId,
        processingRunId: seeded.runId,
        pageIndex: 0,
        textBlockId: seeded.bodyBlockId,
        blockOrder: 3,
        startOffset: 200,
        endOffset: 300,
      },
    },
  ]);
  const conversation = await createRagConversation(userId);
  return { email, userId, documentId: seeded.documentId, conversationId: conversation.id };
}

async function queryEmbeddingLogRows(documentId: string) {
  return db
    .select()
    .from(aiUsageLogs)
    .where(and(eq(aiUsageLogs.documentId, documentId), eq(aiUsageLogs.task, EMBEDDING_TASK)));
}

// ---------------------------------------------------------------------------
// (a) RAG_HYBRID_RETRIEVAL=true: the embeddings endpoint is actually called,
// and exactly one usage row with real token counts/model/cost is written.
// ---------------------------------------------------------------------------
async function testHybridOnLogsQueryEmbeddingUsage() {
  const seed = await seedConversation("on");
  try {
    process.env.RAG_HYBRID_RETRIEVAL = "true";
    const getCalls = installEmbeddingFetch(11);

    const result = await answerRagConversation({
      userId: seed.userId,
      conversationId: seed.conversationId,
      question: "How does passion relate to decision?",
    });
    assert.ok(result, "the conversation exists and produces an answer");
    assert.ok(getCalls() >= 1, "the hybrid path called the embeddings endpoint at least once");

    const rows = await queryEmbeddingLogRows(seed.documentId);
    assert.equal(rows.length, 1, "exactly one query-embedding usage row is written per hybrid-enabled call");
    const row = rows[0]!;
    assert.equal(row.stage, "socratic-rag", "shares the completion call's stage, so it falls inside the same daily cost pool");
    assert.equal(row.provider, "openai");
    assert.equal(row.model, EMBEDDING_MODEL, "the real model the embeddings client reported, not a hardcoded guess");
    assert.equal(row.promptTokens, 11, "the real token count from the (mocked) provider response");
    assert.equal(row.completionTokens, 0, "an embedding call has no completion tokens");
    const expectedCost = estimateEmbeddingCostUsd(EMBEDDING_MODEL, 11);
    assert.ok(
      Math.abs(row.estimatedCostUsd - expectedCost) < 1e-9,
      `estimatedCostUsd (${row.estimatedCostUsd}) should equal estimateEmbeddingCostUsd(model, tokens) (${expectedCost})`,
    );
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RAG_HYBRID_RETRIEVAL;
    await deleteTestUser(seed.email);
  }
}

// ---------------------------------------------------------------------------
// (b) Flag off (the default): the embeddings endpoint is never called, and
// no query-embedding usage row is written — flag-off behavior stays exactly
// as it was before this change.
// ---------------------------------------------------------------------------
async function testHybridOffWritesNoQueryEmbeddingUsage() {
  const seed = await seedConversation("off");
  try {
    delete process.env.RAG_HYBRID_RETRIEVAL;
    const getCalls = installEmbeddingFetch(11);

    const result = await answerRagConversation({
      userId: seed.userId,
      conversationId: seed.conversationId,
      question: "How does passion relate to decision?",
    });
    assert.ok(result, "the conversation exists and produces an answer");
    assert.equal(getCalls(), 0, "the flag-off (lexical-only) path never calls the embeddings endpoint");

    const rows = await queryEmbeddingLogRows(seed.documentId);
    assert.equal(rows.length, 0, "no query-embedding usage row is written when the flag is off");
  } finally {
    globalThis.fetch = realFetch;
    await deleteTestUser(seed.email);
  }
}

async function main() {
  await testHybridOnLogsQueryEmbeddingUsage();
  await testHybridOffWritesNoQueryEmbeddingUsage();
  console.log("ragData.test.ts: all assertions passed");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    globalThis.fetch = realFetch;
    console.error(err);
    process.exit(1);
  });
