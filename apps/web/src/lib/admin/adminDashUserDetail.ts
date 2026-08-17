import {
  aiUsageLogs,
  db,
  documents,
  processingRuns,
  ragConversations,
  ragMessages,
  userDeletionArchives,
  usageEvents,
  users,
} from "@ice/db";
import { suggestReaderLevelFromCompletions, type ReaderLevel } from "@ice/roadmap";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getLibrary } from "@/lib/library";
import { DAILY_SERIES_DAYS, dayAxis, dayLabels, fillDailySeries } from "@/lib/admin/adminDashDayAxis";

/**
 * Extracted verbatim from `adminDashData.ts` (Workstream H, v.5): the
 * `/admin-dash/users/[id]` drill-down. Read-only and parameterized
 * throughout. `adminDashData.ts` re-exports everything below unchanged.
 *
 * THE PRIVACY GATE (plan §H, "data-sharing gate lives in the QUERY layer"):
 * `getAdminUserDetail` below only ever calls `getUserChatTranscripts` inside
 * the branch where the resolved user's data-sharing flag is true. A
 * non-opted-in user's conversation content is never selected out of
 * Postgres in the first place — the page can't accidentally render what was
 * never fetched.
 */

// ---------------------------------------------------------------------------
// User drill-down
// ---------------------------------------------------------------------------

export interface AdminChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface AdminChatTranscript {
  id: string;
  title: string;
  updatedAt: Date;
  messages: AdminChatMessage[];
}

export interface AdminUserDetail {
  status: "active" | "deleted";
  userId: string;
  email: string;
  name: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  /** Current flag for an active user; the point-in-time snapshot
   *  (`dataSharingWasEnabled`) for a deleted one. */
  dataSharingEnabled: boolean;
  readerLevelSelfChosen: ReaderLevel | null;
  /** Only ever computed for an active user — a deleted user's Library and
   *  reading history cascade away with the account, so there is nothing
   *  left to infer from; null there means "not computable", not "no
   *  signal", and the page must say so rather than implying absence. */
  readerLevelInferred: ReaderLevel | null;
  docsProcessed: number;
  totalAiCostUsd: number;
  chatMessages: number;
  lastActiveAt: Date | null;
  /** Null for a deleted user — the Storage objects are gone with the
   *  account, so there is no live byte count left to report. */
  storageBytes: number | null;
  /**
   * Populated ONLY when the privacy gate (this file's header) is open for
   * this user; null means "gate closed or not applicable" — never "no
   * conversations" — the page draws that distinction explicitly in copy
   * rather than treating an empty array and a closed gate the same way.
   */
  transcripts: AdminChatTranscript[] | null;
  /** Content-free by construction (event type + path + timestamp only, no
   *  free text) — shown regardless of the data-sharing flag, which gates
   *  conversation CONTENT, not this. Survives account deletion since
   *  `usage_event.user_id` carries no FK (see schema.ts). */
  usageEventDaily: Array<{ label: string; value: number }>;
}

async function resolveUserForDetail(
  id: string,
): Promise<
  | { status: "active"; row: typeof users.$inferSelect }
  | { status: "deleted"; row: typeof userDeletionArchives.$inferSelect }
  | null
> {
  const [active] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (active) return { status: "active", row: active };
  const [archived] = await db.select().from(userDeletionArchives).where(eq(userDeletionArchives.userId, id)).limit(1);
  if (archived) return { status: "deleted", row: archived };
  return null;
}

/** THE PRIVACY GATE's other half: the actual content query. Only ever
 *  called from inside a `dataSharingEnabled` check in `getAdminUserDetail` —
 *  never called speculatively "just in case the page wants it later". */
async function getUserChatTranscripts(userId: string): Promise<AdminChatTranscript[]> {
  const conversations = await db
    .select({ id: ragConversations.id, title: ragConversations.title, updatedAt: ragConversations.updatedAt })
    .from(ragConversations)
    .where(eq(ragConversations.userId, userId))
    .orderBy(desc(ragConversations.updatedAt))
    .limit(20);
  if (conversations.length === 0) return [];

  const ids = conversations.map((c) => c.id);
  const messageRows = await db
    .select({
      conversationId: ragMessages.conversationId,
      role: ragMessages.role,
      content: ragMessages.content,
      createdAt: ragMessages.createdAt,
    })
    .from(ragMessages)
    .where(inArray(ragMessages.conversationId, ids))
    .orderBy(ragMessages.createdAt);

  const byConversation = new Map<string, AdminChatMessage[]>();
  for (const m of messageRows) {
    const list = byConversation.get(m.conversationId) ?? [];
    list.push({ role: m.role, content: m.content, createdAt: m.createdAt });
    byConversation.set(m.conversationId, list);
  }

  return conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    messages: byConversation.get(c.id) ?? [],
  }));
}

async function getUserUsageEventDaily(userId: string): Promise<Array<{ label: string; value: number }>> {
  const axis = dayAxis(DAILY_SERIES_DAYS);
  const since = axis[0]!;
  const rows = await db
    .select({ day: sql<string>`date_trunc('day', ${usageEvents.createdAt})`, value: sql<number>`count(*)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, since)))
    .groupBy(sql`date_trunc('day', ${usageEvents.createdAt})`);
  const values = fillDailySeries(rows, axis);
  const labels = dayLabels(axis);
  return axis.map((_, i) => ({ label: labels[i]!, value: values[i]! }));
}

/** Mirrors `accountDeletion.ts`'s `computeAggregates` cost cross-check
 *  (documented `ai_usage_log.document_id`-only undercount, cross-checked
 *  against `processing_run.ai_cost_usd`), read-only here rather than as a
 *  step in the deletion flow. */
async function computeActiveUserAggregates(userId: string): Promise<{
  docsProcessed: number;
  totalAiCostUsd: number;
  chatMessages: number;
  lastActiveAt: Date | null;
  storageBytes: number;
}> {
  const [[{ docsProcessed, storageBytes }], [{ costFromLogs }], [{ costFromRuns }], [{ chatMessages }], [{ lastActiveAt }]] =
    await Promise.all([
      db
        .select({ docsProcessed: count(), storageBytes: sql<number>`coalesce(sum(${documents.fileSize}), 0)` })
        .from(documents)
        .where(eq(documents.userId, userId)),
      db
        .select({ costFromLogs: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
        .from(aiUsageLogs)
        .innerJoin(documents, eq(aiUsageLogs.documentId, documents.id))
        .where(eq(documents.userId, userId)),
      db
        .select({ costFromRuns: sql<number>`coalesce(sum(${processingRuns.aiCostUsd}), 0)` })
        .from(processingRuns)
        .innerJoin(documents, eq(processingRuns.documentId, documents.id))
        .where(eq(documents.userId, userId)),
      db
        .select({ chatMessages: count() })
        .from(ragMessages)
        .innerJoin(ragConversations, eq(ragMessages.conversationId, ragConversations.id))
        .where(eq(ragConversations.userId, userId)),
      db.select({ lastActiveAt: sql<Date | null>`max(${usageEvents.createdAt})` }).from(usageEvents).where(eq(usageEvents.userId, userId)),
    ]);

  return {
    docsProcessed: Number(docsProcessed),
    totalAiCostUsd: Math.max(Number(costFromLogs), Number(costFromRuns)),
    chatMessages: Number(chatMessages),
    lastActiveAt: lastActiveAt ?? null,
    storageBytes: Number(storageBytes),
  };
}

export async function getAdminUserDetail(id: string): Promise<AdminUserDetail | null> {
  const resolved = await resolveUserForDetail(id);
  if (!resolved) return null;

  const resolvedUserId = resolved.status === "active" ? resolved.row.id : resolved.row.userId;
  const usageEventDaily = await getUserUsageEventDaily(resolvedUserId);

  if (resolved.status === "active") {
    const user = resolved.row;
    const aggregates = await computeActiveUserAggregates(user.id);

    let readerLevelInferred: ReaderLevel | null = null;
    try {
      const library = await getLibrary(user.id);
      const completedLevels = library.items
        .filter((item) => item.readingStatus === "completed")
        .map((item) => item.readerLevel as ReaderLevel | null);
      // `null` currentLevel deliberately, not the user's own self-chosen
      // level — an admin drill-down wants the raw inferred signal to
      // compare SIDE BY SIDE against the self-chosen value, not the
      // self-chosen-aware "only suggest something higher" nudge the
      // Library page itself shows the reader.
      readerLevelInferred = suggestReaderLevelFromCompletions(completedLevels, null);
    } catch {
      readerLevelInferred = null;
    }

    return {
      status: "active",
      userId: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      deletedAt: null,
      dataSharingEnabled: user.dataSharingEnabled,
      readerLevelSelfChosen: user.readerLevel,
      readerLevelInferred,
      docsProcessed: aggregates.docsProcessed,
      totalAiCostUsd: aggregates.totalAiCostUsd,
      chatMessages: aggregates.chatMessages,
      lastActiveAt: aggregates.lastActiveAt,
      storageBytes: aggregates.storageBytes,
      // THE PRIVACY GATE: only reached, and only ever calls the transcript
      // query, when the flag is true.
      transcripts: user.dataSharingEnabled ? await getUserChatTranscripts(user.id) : null,
      usageEventDaily,
    };
  }

  const archive = resolved.row;
  return {
    status: "deleted",
    userId: archive.userId,
    email: archive.email,
    name: archive.name,
    createdAt: archive.userCreatedAt,
    deletedAt: archive.deletedAt,
    dataSharingEnabled: archive.dataSharingWasEnabled ?? false,
    readerLevelSelfChosen: (archive.readerLevel as ReaderLevel | null) ?? null,
    readerLevelInferred: null,
    docsProcessed: archive.docsProcessed ?? 0,
    totalAiCostUsd: archive.totalAiCostUsd ?? 0,
    chatMessages: archive.chatMessages ?? 0,
    lastActiveAt: archive.lastActiveAt ?? null,
    storageBytes: null,
    // `rag_conversation.user_id` cascades from `user` — a deleted user's
    // conversations are already gone, not merely gated. Never queried.
    transcripts: null,
    usageEventDaily,
  };
}
