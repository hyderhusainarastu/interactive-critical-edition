import { OpenAIResponsesClient, estimateCostUsd, safetyIdentifierFor } from "@ice/ai-adapters";
import {
  aiUsageLogs,
  db,
  documents,
  ragChunks,
  ragConversations,
  ragMessageCitations,
  ragMessages,
  works,
} from "@ice/db";
import {
  SOCRATIC_SYSTEM_PROMPT,
  buildSocraticInput,
  canonicalWorkDisplayTitles,
  fallbackSocraticAnswer,
  retrieveOwnerRagChunks,
  RAG_RESPONSE_HARD_CAP_USD,
  RAG_RESPONSE_LATENCY_CAP_MS,
  type RagAnchor,
  type RetrievedRagChunk,
  validateSocraticAnswer,
} from "@ice/rag";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { processCompetencySignals, type CompetencyNoticeView } from "./competencyData";

export type RagCitationView = {
  chunkId: string;
  ordinal: number;
  href: string;
  label: string;
  sourceType: "uploaded" | "open_access";
  pageIndex?: number;
  license?: string;
};

export type RagMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: RagCitationView[];
  createdAt: string;
  latencyMs: number | null;
};

const MAX_HISTORY_MESSAGES = 6;
export const RAG_DAILY_SOFT_CAP_USD = 1;
// Sub-phase 22.9b (plan §3.5): the Socratic answer call and the competency-
// designation call share ONE daily pool, so a chatty day of either kind
// degrades the other rather than each independently reaching $1 (which
// would silently double the real ceiling this constant is meant to be).
const RAG_SPEND_STAGES = ["socratic-rag", "competency-designation"] as const;

function explicitlyEnabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function messageView(message: { id: string; role: "user" | "assistant"; content: string; createdAt: Date; latencyMs: number | null }, citations: RagCitationView[] = []): RagMessageView {
  return { ...message, citations, createdAt: message.createdAt.toISOString() };
}

function citationView(chunk: { id: string; anchor: unknown; sourceType: "uploaded" | "open_access"; sourceUrl: string | null; license: string | null; workTitle: string }, ordinal: number): RagCitationView {
  const anchor = chunk.anchor as RagAnchor;
  return {
    chunkId: chunk.id,
    ordinal,
    href: anchor.href || chunk.sourceUrl || "#",
    label: anchor.kind === "reader"
      ? `${chunk.workTitle}${typeof anchor.pageIndex === "number" ? ` · page ${anchor.pageIndex + 1}` : ""}`
      : `${chunk.workTitle} · open-access source`,
    sourceType: chunk.sourceType,
    ...(typeof anchor.pageIndex === "number" ? { pageIndex: anchor.pageIndex } : {}),
    ...(chunk.license ? { license: chunk.license } : {}),
  };
}

export async function listRagConversations(userId: string) {
  return db
    .select({ id: ragConversations.id, title: ragConversations.title, contextWorkId: ragConversations.contextWorkId, updatedAt: ragConversations.updatedAt })
    .from(ragConversations)
    .where(and(eq(ragConversations.userId, userId), eq(ragConversations.status, "active")))
    .orderBy(desc(ragConversations.updatedAt));
}

export async function getOwnedRagConversation(userId: string, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(ragConversations)
    .where(and(eq(ragConversations.id, conversationId), eq(ragConversations.userId, userId), eq(ragConversations.status, "active")))
    .limit(1);
  return conversation ?? null;
}

export async function createRagConversation(userId: string, contextWorkId?: string | null) {
  const [conversation] = await db
    .insert(ragConversations)
    .values({ userId, contextWorkId: contextWorkId ?? null })
    .returning();
  return conversation;
}

export async function getRagConversationView(userId: string, conversationId: string) {
  const conversation = await getOwnedRagConversation(userId, conversationId);
  if (!conversation) return null;
  const rows = await db
    .select({
      id: ragMessages.id,
      role: ragMessages.role,
      content: ragMessages.content,
      createdAt: ragMessages.createdAt,
      latencyMs: ragMessages.latencyMs,
      ordinal: ragMessageCitations.ordinal,
      chunkId: ragChunks.id,
      anchor: ragChunks.anchor,
      sourceType: ragChunks.sourceType,
      sourceUrl: ragChunks.sourceUrl,
      license: ragChunks.license,
      workTitle: works.title,
      workId: ragChunks.workId,
    })
    .from(ragMessages)
    .leftJoin(ragMessageCitations, eq(ragMessages.id, ragMessageCitations.messageId))
    .leftJoin(ragChunks, eq(ragMessageCitations.chunkId, ragChunks.id))
    .leftJoin(works, eq(ragChunks.workId, works.id))
    .where(eq(ragMessages.conversationId, conversation.id))
    .orderBy(asc(ragMessages.createdAt), asc(ragMessageCitations.ordinal));

  // Phase 20.6: historical citations also display under the canonical work
  // entry (same resolution `retrieveOwnerRagChunks` applies to new answers).
  const canonicalTitles = await canonicalWorkDisplayTitles(
    userId,
    rows.map((row) => row.workId).filter((id): id is string => Boolean(id)),
  );

  const messages = new Map<string, RagMessageView>();
  for (const row of rows) {
    const existing = messages.get(row.id) ?? messageView({ id: row.id, role: row.role, content: row.content, createdAt: row.createdAt, latencyMs: row.latencyMs });
    if (row.chunkId && row.anchor && row.sourceType && row.workTitle && row.ordinal != null) {
      const displayTitle = (row.workId ? canonicalTitles.get(row.workId) : undefined) ?? row.workTitle;
      existing.citations.push(citationView({ id: row.chunkId, anchor: row.anchor, sourceType: row.sourceType, sourceUrl: row.sourceUrl, license: row.license, workTitle: displayTitle }, row.ordinal));
    }
    messages.set(row.id, existing);
  }
  return {
    conversation: { id: conversation.id, title: conversation.title, contextWorkId: conversation.contextWorkId, updatedAt: conversation.updatedAt.toISOString() },
    messages: [...messages.values()],
  };
}

/** Widened (sub-phase 22.9b, plan §3.5) to sum BOTH chat stages sharing the
 * $1/day pool — exported so `competencyData.ts`'s own gating sees the exact
 * same combined total this file's `generateSocraticAnswer` already gates on. */
export async function currentRagSpend(userId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ value: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .innerJoin(documents, eq(aiUsageLogs.documentId, documents.id))
    .where(and(eq(documents.userId, userId), inArray(aiUsageLogs.stage, RAG_SPEND_STAGES), gte(aiUsageLogs.createdAt, today)));
  return Number(row?.value ?? 0);
}

function answerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answer", "citedChunkIds", "notFound"],
    properties: {
      answer: { type: "string", minLength: 1, maxLength: 2400 },
      citedChunkIds: { type: "array", items: { type: "string" }, maxItems: 6 },
      notFound: { type: "boolean" },
    },
  } as const;
}

function withRagLatencyCap<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socratic provider latency cap reached")), RAG_RESPONSE_LATENCY_CAP_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function generateSocraticAnswer(userId: string, question: string, history: Array<{ role: "user" | "assistant"; content: string }>, chunks: RetrievedRagChunk[]) {
  const fallback = fallbackSocraticAnswer(question, chunks);
  if (!chunks.length) return { answer: fallback, provider: "deterministic-retrieval", model: "not-found", promptTokens: 0, completionTokens: 0, cost: 0 };

  const client = new OpenAIResponsesClient();
  const model = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const projected = estimateCostUsd(model, 6_000, 700);
  if (!explicitlyEnabled("PHASE_18_RAG_PROVIDER_ENABLED") || !client.available || projected > RAG_RESPONSE_HARD_CAP_USD || await currentRagSpend(userId) + projected > RAG_DAILY_SOFT_CAP_USD) {
    return { answer: fallback, provider: "deterministic-retrieval", model: "lexical-socratic-fallback", promptTokens: 0, completionTokens: 0, cost: 0 };
  }

  try {
    const result = await withRagLatencyCap(client.call({
      model,
      system: SOCRATIC_SYSTEM_PROMPT,
      input: buildSocraticInput({ question, history, chunks }),
      schema: answerSchema(),
      schemaName: "library_grounded_socratic_answer",
      safetyIdentifier: safetyIdentifierFor(userId),
      maxOutputTokens: 700,
      validate: (parsed) => validateSocraticAnswer(parsed, chunks.map((chunk) => chunk.id)),
    }));
    return {
      answer: result.data,
      provider: "openai",
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cost: estimateCostUsd(result.model, result.promptTokens, result.completionTokens),
    };
  } catch {
    // A provider error never turns into an unsupported answer. The cited,
    // deterministic Socratic fallback is still useful and has zero spend.
    return { answer: fallback, provider: "deterministic-retrieval", model: "lexical-socratic-fallback", promptTokens: 0, completionTokens: 0, cost: 0 };
  }
}

export async function answerRagConversation(input: { userId: string; conversationId: string; question: string }) {
  const conversation = await getOwnedRagConversation(input.userId, input.conversationId);
  if (!conversation) return null;
  const question = input.question.trim().replace(/\s+/g, " ");
  const [userMessage] = await db.insert(ragMessages).values({ conversationId: conversation.id, role: "user", content: question }).returning();
  const prior = await db
    .select({ role: ragMessages.role, content: ragMessages.content })
    .from(ragMessages)
    .where(eq(ragMessages.conversationId, conversation.id))
    .orderBy(desc(ragMessages.createdAt))
    .limit(MAX_HISTORY_MESSAGES);
  const chunks = await retrieveOwnerRagChunks(input.userId, question);
  const started = Date.now();
  const generated = await generateSocraticAnswer(input.userId, question, [...prior].reverse(), chunks);
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
  const title = conversation.title === "New conversation" ? question.slice(0, 96) : conversation.title;
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
