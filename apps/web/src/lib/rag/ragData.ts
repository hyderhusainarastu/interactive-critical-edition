import { estimateEmbeddingCostUsd } from "@ice/ai-adapters";
import {
  aiUsageLogs,
  db,
  ragConversations,
  ragMessageCitations,
  ragMessageClaimCitations,
  ragMessages,
} from "@ice/db";
import {
  DEFAULT_RESEARCH_MODE,
  defaultEmbedQuery,
  isExplicitResearchMode,
  retrieveOwnerRagChunks,
  type ResearchMode,
} from "@ice/rag";
import { desc, eq } from "drizzle-orm";
import { processCompetencySignals, type CompetencyNoticeView } from "@/lib/rag/competencyData";
import { deriveRagConversationTitle } from "@/lib/rag/ragTitle";
import { citationView, claimCitationView, messageView } from "@/lib/rag/ragViews";
import {
  RAG_DAILY_SOFT_CAP_USD,
  createRagConversation,
  currentRagSpend,
  getOwnedRagConversation,
  getRagConversationView,
  listRagConversations,
} from "@/lib/rag/ragConversations";
import { generateResearchModeAnswer, generateSocraticAnswer } from "@/lib/rag/ragAnswer";

export type { RagCitationView, RagClaimCitationView, RagMessageView } from "@/lib/rag/ragViews";
export {
  RAG_DAILY_SOFT_CAP_USD,
  createRagConversation,
  currentRagSpend,
  getOwnedRagConversation,
  getRagConversationView,
  listRagConversations,
};

const MAX_HISTORY_MESSAGES = 6;

export async function answerRagConversation(input: {
  userId: string;
  conversationId: string;
  question: string;
  mode?: ResearchMode;
  claimId?: string;
  clusterId?: string;
  workIdB?: string;
}) {
  const conversation = await getOwnedRagConversation(input.userId, input.conversationId);
  if (!conversation) return null;
  const question = input.question.trim().replace(/\s+/g, " ");
  const mode: ResearchMode = input.mode ?? DEFAULT_RESEARCH_MODE;
  const [userMessage] = await db.insert(ragMessages).values({ conversationId: conversation.id, role: "user", content: question }).returning();
  const prior = await db
    .select({ role: ragMessages.role, content: ragMessages.content })
    .from(ragMessages)
    .where(eq(ragMessages.conversationId, conversation.id))
    .orderBy(desc(ragMessages.createdAt))
    .limit(MAX_HISTORY_MESSAGES);

  // Phase 28.6: research modes retrieve via the judged claim graph, not
  // lexical rag_chunks — a wholly separate path from the socratic default
  // below, sharing only the conversation/message bookkeeping and the
  // "socratic-rag" cost pool (plan §Web surfaces: "cost shares the existing
  // daily pool"). Competency-signal inference (sub-phase 22.9b) stays
  // scoped to the socratic default; a research-mode turn resolves its
  // promise to an empty array rather than skipping the field outright, so
  // the SSE layer's shape never has to special-case a missing promise.
  if (isExplicitResearchMode(mode)) {
    const started = Date.now();
    const generated = await generateResearchModeAnswer(input.userId, conversation.id, mode, question, [...prior].reverse(), {
      contextWorkId: conversation.contextWorkId,
      claimId: input.claimId,
      clusterId: input.clusterId,
      workIdB: input.workIdB,
    });
    const latencyMs = Date.now() - started;
    const [assistantMessage] = await db.insert(ragMessages).values({
      conversationId: conversation.id,
      role: "assistant",
      content: generated.answer.answer,
      mode,
      provider: generated.provider,
      model: generated.model,
      promptTokens: generated.promptTokens,
      completionTokens: generated.completionTokens,
      estimatedCostUsd: generated.cost,
      latencyMs,
    }).returning();
    const citedClaims = generated.claims.filter((claim) => generated.answer.citedClaimIds.includes(claim.id));
    if (citedClaims.length) {
      await db.insert(ragMessageClaimCitations).values(citedClaims.map((claim, ordinal) => ({ messageId: assistantMessage.id, claimId: claim.id, ordinal })));
    }
    if (generated.cost > 0) {
      await db.insert(aiUsageLogs).values({
        // No natural document to attribute a claim-based answer to (a
        // research_claim isn't 1:1 with one document the way a rag_chunk
        // is) — null is the honest value, matching this column's own
        // nullable/`set null` design (see the Design Decisions log entry),
        // not a guess at the "first" cited claim's work.
        documentId: null,
        task: "research_mode_answer",
        stage: "socratic-rag",
        provider: generated.provider,
        model: generated.model,
        promptTokens: generated.promptTokens,
        completionTokens: generated.completionTokens,
        estimatedCostUsd: generated.cost,
      });
    }
    const modeTitle = deriveRagConversationTitle(conversation.title, question);
    await db.update(ragConversations).set({ title: modeTitle, updatedAt: new Date() }).where(eq(ragConversations.id, conversation.id));

    return {
      user: messageView(userMessage),
      assistant: messageView(assistantMessage, [], citedClaims.map((claim, ordinal) => claimCitationView(claim, ordinal))),
      competencyPromise: Promise.resolve([] as CompetencyNoticeView[]),
      notFound: generated.answer.notFound,
    };
  }

  // Phase 29.3 follow-up: `retrieveOwnerRagChunks` only ever invokes
  // `embedQuery` when `RAG_HYBRID_RETRIEVAL` is on (the flag-off path returns
  // before touching `options.embedQuery` at all — see `@ice/rag`'s
  // `index.ts`), so this wrapper is safe to pass unconditionally: flag-off
  // behavior stays byte-identical (no fetch, no usage row, `queryEmbeddingUsage`
  // stays null) and flag-on behavior gains real cost accounting for the query
  // embedding call that was previously invisible to `ai_usage_log`.
  let queryEmbeddingUsage: { model: string; inputTokens: number; estimatedCostUsd: number } | null = null;
  const chunks = await retrieveOwnerRagChunks(input.userId, question, undefined, {
    embedQuery: async (text) => {
      const embedded = await defaultEmbedQuery(text);
      queryEmbeddingUsage = {
        model: embedded.model,
        inputTokens: embedded.inputTokens,
        estimatedCostUsd: estimateEmbeddingCostUsd(embedded.model, embedded.inputTokens),
      };
      return embedded;
    },
  });
  const started = Date.now();
  const generated = await generateSocraticAnswer(input.userId, conversation.id, question, [...prior].reverse(), chunks);
  const latencyMs = Date.now() - started;
  const [assistantMessage] = await db.insert(ragMessages).values({
    conversationId: conversation.id,
    role: "assistant",
    content: generated.answer.answer,
    provider: generated.provider,
    model: generated.model,
    promptTokens: generated.promptTokens,
    completionTokens: generated.completionTokens,
    estimatedCostUsd: generated.cost,
    latencyMs,
  }).returning();
  const citations = chunks.filter((chunk) => generated.answer.citedChunkIds.includes(chunk.id));
  if (citations.length) {
    await db.insert(ragMessageCitations).values(citations.map((chunk, ordinal) => ({ messageId: assistantMessage.id, chunkId: chunk.id, ordinal })));
  }
  if (generated.cost > 0 && chunks[0]) {
    await db.insert(aiUsageLogs).values({
      documentId: chunks[0].documentId,
      task: "socratic_rag_answer",
      stage: "socratic-rag",
      provider: generated.provider,
      model: generated.model,
      promptTokens: generated.promptTokens,
      completionTokens: generated.completionTokens,
      estimatedCostUsd: generated.cost,
    });
  }
  // Same "socratic-rag" stage as the completion log above (not a separate
  // stage) so the query-embedding cost naturally falls inside the existing
  // `RAG_SPEND_STAGES`/`RAG_DAILY_SOFT_CAP_USD` pool `currentRagSpend` sums,
  // with no change to that gating logic needed. `documentId` uses the same
  // "attribute to the first retrieved chunk's document" convention as the
  // completion log; a hybrid query that surfaces no chunks at all still
  // incurred a real embedding cost, so it's logged with a null documentId
  // rather than dropped (`ai_usage_log.document_id` is nullable, `set null`
  // on delete, by design — see the Design Decisions log entry).
  if (queryEmbeddingUsage) {
    const usage: { model: string; inputTokens: number; estimatedCostUsd: number } = queryEmbeddingUsage;
    await db.insert(aiUsageLogs).values({
      documentId: chunks[0]?.documentId ?? null,
      task: "socratic_rag_query_embedding",
      stage: "socratic-rag",
      provider: "openai",
      model: usage.model,
      promptTokens: usage.inputTokens,
      completionTokens: 0,
      estimatedCostUsd: usage.estimatedCostUsd,
    });
  }
  const title = deriveRagConversationTitle(conversation.title, question);
  await db.update(ragConversations).set({ title, updatedAt: new Date() }).where(eq(ragConversations.id, conversation.id));

  // Sub-phase 22.9b (plan §3.5): kicked off AFTER the answer is generated
  // (so the shared cost pool already reflects this turn's Socratic spend,
  // giving the answer call priority), but never awaited here — the SSE
  // layer (`streamAnswer` in the conversations route) races this against
  // its own 6s fail-silent cap so a slow/failed competency pass can never
  // delay or fail the answer itself.
  const previousAssistantMessage = [...prior].reverse().slice(0, -1).findLast((message) => message.role === "assistant")?.content ?? null;
  const competencyPromise: Promise<CompetencyNoticeView[]> = processCompetencySignals({
    userId: input.userId,
    conversationId: conversation.id,
    messageId: userMessage.id,
    userMessage: question,
    previousAssistantMessage,
    contextWorkId: conversation.contextWorkId,
    chunkWorkIds: chunks.map((chunk) => chunk.workId),
    usageDocumentId: chunks[0]?.documentId ?? null,
  });

  return {
    user: messageView(userMessage),
    assistant: messageView(assistantMessage, citations.map((chunk, ordinal) => citationView(chunk, ordinal))),
    competencyPromise,
    notFound: generated.answer.notFound,
  };
}
