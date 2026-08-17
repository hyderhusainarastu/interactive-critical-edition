import {
  aiUsageLogs,
  db,
  documents,
  ragChunks,
  ragConversations,
  ragMessageCitations,
  ragMessageClaimCitations,
  ragMessages,
  researchClaims,
  works,
} from "@ice/db";
import { canonicalWorkDisplayTitles } from "@ice/rag";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  citationView,
  claimCitationView,
  messageView,
  type RagClaimCitationView,
  type RagMessageView,
} from "@/lib/rag/ragViews";

export const RAG_DAILY_SOFT_CAP_USD = 1;
// Sub-phase 22.9b (plan §3.5): the Socratic answer call and the competency-
// designation call share ONE daily pool, so a chatty day of either kind
// degrades the other rather than each independently reaching $1 (which
// would silently double the real ceiling this constant is meant to be).
const RAG_SPEND_STAGES = ["socratic-rag", "competency-designation"] as const;

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
  const [rows, claimRows] = await Promise.all([
    db
      .select({
        id: ragMessages.id,
        role: ragMessages.role,
        content: ragMessages.content,
        mode: ragMessages.mode,
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
      .orderBy(asc(ragMessages.createdAt), asc(ragMessageCitations.ordinal)),
    // Phase 28.6: claim citations are a SEPARATE join (rather than one query
    // with two left joins), since a message can carry both chunk and claim
    // citations at once and a combined join would cross-multiply the two
    // citation sets against each other.
    db
      .select({
        messageId: ragMessages.id,
        ordinal: ragMessageClaimCitations.ordinal,
        claimId: researchClaims.id,
        claimText: researchClaims.claimText,
        claimNature: researchClaims.claimNature,
        workTitle: works.title,
      })
      .from(ragMessages)
      .innerJoin(ragMessageClaimCitations, eq(ragMessages.id, ragMessageClaimCitations.messageId))
      .innerJoin(researchClaims, eq(ragMessageClaimCitations.claimId, researchClaims.id))
      .innerJoin(works, eq(researchClaims.workId, works.id))
      .where(eq(ragMessages.conversationId, conversation.id))
      .orderBy(asc(ragMessages.createdAt), asc(ragMessageClaimCitations.ordinal)),
  ]);

  // Phase 20.6: historical citations also display under the canonical work
  // entry (same resolution `retrieveOwnerRagChunks` applies to new answers).
  const canonicalTitles = await canonicalWorkDisplayTitles(
    userId,
    rows.map((row) => row.workId).filter((id): id is string => Boolean(id)),
  );

  const claimCitationsByMessage = new Map<string, RagClaimCitationView[]>();
  for (const row of claimRows) {
    const list = claimCitationsByMessage.get(row.messageId) ?? [];
    list.push(claimCitationView({ id: row.claimId, claimText: row.claimText, claimNature: row.claimNature, workTitle: row.workTitle }, row.ordinal));
    claimCitationsByMessage.set(row.messageId, list);
  }

  const messages = new Map<string, RagMessageView>();
  for (const row of rows) {
    const existing = messages.get(row.id) ?? messageView(
      { id: row.id, role: row.role, content: row.content, mode: row.mode, createdAt: row.createdAt, latencyMs: row.latencyMs },
      [],
      claimCitationsByMessage.get(row.id) ?? [],
    );
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
