import {
  aiUsageLogs,
  db,
  documents,
  feedback,
  processingRuns,
  ragConversations,
  ragMessages,
  userDeletionArchives,
  usageEvents,
  users,
} from "@ice/db";
import { suggestReaderLevelFromCompletions, type ReaderLevel } from "@ice/roadmap";
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { getLibrary } from "@/lib/library";

/**
 * Workstream H (v.5) admin-dashboard queries. Every read `/admin-dash` needs
 * lives in this one file, read-only and parameterized throughout — no raw
 * string interpolation of request input into SQL anywhere below. This is
 * also the first file in the codebase to use SQL `date_trunc`
 * (`accountUsage.ts`'s own doc comment explicitly reserves that here): the
 * daily series need a real day-bucketed GROUP BY over a row count that can
 * meaningfully exceed any one user's own history, unlike the per-user
 * bucketing `accountUsage.ts` does in application code.
 *
 * THE PRIVACY GATE (plan §H, "data-sharing gate lives in the QUERY layer"):
 * `getAdminUserDetail` below only ever calls `getUserChatTranscripts` inside
 * the branch where the resolved user's data-sharing flag is true. A
 * non-opted-in user's conversation content is never selected out of
 * Postgres in the first place — the page can't accidentally render what was
 * never fetched.
 */

const DAILY_SERIES_DAYS = 30;
const USERS_PAGE_SIZE = 50;
// Beta-scale safety valve for the users-list merge below (see its own doc
// comment) — a real ceiling on rows fetched per side, not a pagination
// mechanism.
const USERS_FETCH_CAP = 5000;

// ---------------------------------------------------------------------------
// Shared day-axis helpers (same technique as accountUsage.ts's dayBuckets,
// generalized to arbitrary date_trunc('day', ...) query results).
// ---------------------------------------------------------------------------

function dayAxis(daysBack: number, now: Date = new Date()): Date[] {
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const axis: Date[] = [];
  for (let i = daysBack - 1; i >= 0; i -= 1) {
    axis.push(new Date(endOfToday.getFullYear(), endOfToday.getMonth(), endOfToday.getDate() - i));
  }
  return axis;
}

function isoDay(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function fillDailySeries(rows: Array<{ day: Date | string; value: number | string }>, axis: Date[]): number[] {
  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(isoDay(row.day), Number(row.value));
  return axis.map((d) => byDay.get(isoDay(d)) ?? 0);
}

function dayLabels(axis: Date[]): string[] {
  return axis.map((d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface AdminOverviewTiles {
  activeUsers: number;
  deletedUsers: number;
  documents: number;
  aiSpendUsd: number;
  totalTokens: number;
  chatMessages: number;
  pageViews: number;
  storageBytes: number;
}

export interface AdminDailySeries {
  labels: string[];
  spend: number[];
  uploads: number[];
  chats: number[];
  signups: number[];
}

export interface AdminRunHealth {
  totalRuns: number;
  publishedRuns: number;
  degradedRuns: number;
  researchCostUsd: number;
  byStage: Array<{ status: string; stage: string | null; count: number }>;
}

export interface AdminOverview {
  tiles: AdminOverviewTiles;
  daily: AdminDailySeries;
  runHealth: AdminRunHealth;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const axis = dayAxis(DAILY_SERIES_DAYS);
  const since = axis[0]!;

  const [activeUsersRows, deletedUsersRows, docStatsRows, spendRows, chatRows, pageViewRows] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(userDeletionArchives),
    db
      .select({ value: count(), storageBytes: sql<number>`coalesce(sum(${documents.fileSize}), 0)` })
      .from(documents),
    db
      .select({
        cost: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)`,
        tokens: sql<number>`coalesce(sum(${aiUsageLogs.promptTokens} + ${aiUsageLogs.completionTokens}), 0)`,
      })
      .from(aiUsageLogs),
    db.select({ value: count() }).from(ragMessages).where(eq(ragMessages.role, "user")),
    db.select({ value: count() }).from(usageEvents).where(eq(usageEvents.eventType, "page_view")),
  ]);

  const tiles: AdminOverviewTiles = {
    activeUsers: Number(activeUsersRows[0]?.value ?? 0),
    deletedUsers: Number(deletedUsersRows[0]?.value ?? 0),
    documents: Number(docStatsRows[0]?.value ?? 0),
    storageBytes: Number(docStatsRows[0]?.storageBytes ?? 0),
    aiSpendUsd: Number(spendRows[0]?.cost ?? 0),
    totalTokens: Number(spendRows[0]?.tokens ?? 0),
    chatMessages: Number(chatRows[0]?.value ?? 0),
    pageViews: Number(pageViewRows[0]?.value ?? 0),
  };

  const [spendByDay, uploadsByDay, chatsByDay, signupsByDay] = await Promise.all([
    db
      .select({
        day: sql<string>`date_trunc('day', ${aiUsageLogs.createdAt})`,
        value: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)`,
      })
      .from(aiUsageLogs)
      .where(gte(aiUsageLogs.createdAt, since))
      .groupBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`),
    db
      .select({ day: sql<string>`date_trunc('day', ${documents.createdAt})`, value: sql<number>`count(*)` })
      .from(documents)
      .where(gte(documents.createdAt, since))
      .groupBy(sql`date_trunc('day', ${documents.createdAt})`),
    db
      .select({ day: sql<string>`date_trunc('day', ${ragMessages.createdAt})`, value: sql<number>`count(*)` })
      .from(ragMessages)
      .where(and(eq(ragMessages.role, "user"), gte(ragMessages.createdAt, since)))
      .groupBy(sql`date_trunc('day', ${ragMessages.createdAt})`),
    db
      .select({ day: sql<string>`date_trunc('day', ${users.createdAt})`, value: sql<number>`count(*)` })
      .from(users)
      .where(gte(users.createdAt, since))
      .groupBy(sql`date_trunc('day', ${users.createdAt})`),
  ]);

  const daily: AdminDailySeries = {
    labels: dayLabels(axis),
    spend: fillDailySeries(spendByDay, axis),
    uploads: fillDailySeries(uploadsByDay, axis),
    chats: fillDailySeries(chatsByDay, axis),
    signups: fillDailySeries(signupsByDay, axis),
  };

  const [byStageRows, runAggRows] = await Promise.all([
    db
      .select({ status: processingRuns.status, stage: processingRuns.stage, value: sql<number>`count(*)` })
      .from(processingRuns)
      .groupBy(processingRuns.status, processingRuns.stage)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        total: sql<number>`count(*)`,
        published: sql<number>`count(*) filter (where ${processingRuns.isPublished})`,
        degraded: sql<number>`count(*) filter (where ${processingRuns.degraded})`,
        cost: sql<number>`coalesce(sum(${processingRuns.aiCostUsd}), 0)`,
      })
      .from(processingRuns),
  ]);

  const runHealth: AdminRunHealth = {
    totalRuns: Number(runAggRows[0]?.total ?? 0),
    publishedRuns: Number(runAggRows[0]?.published ?? 0),
    degradedRuns: Number(runAggRows[0]?.degraded ?? 0),
    researchCostUsd: Number(runAggRows[0]?.cost ?? 0),
    byStage: byStageRows.map((r) => ({ status: r.status, stage: r.stage, count: Number(r.value) })),
  };

  return { tiles, daily, runHealth };
}

// ---------------------------------------------------------------------------
// Users list
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  status: "active" | "deleted";
  email: string;
  name: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  docs: number;
  aiCostUsd: number;
  chatMessages: number;
  lastActiveAt: Date | null;
}

export type AdminUsersSortKey = "createdAt" | "email" | "docs" | "aiCostUsd" | "chatMessages" | "lastActiveAt";
export const ADMIN_USERS_SORT_KEYS: AdminUsersSortKey[] = [
  "createdAt",
  "email",
  "docs",
  "aiCostUsd",
  "chatMessages",
  "lastActiveAt",
];

export interface AdminUsersPage {
  rows: AdminUserRow[];
  page: number;
  pageSize: number;
  totalMatching: number;
}

/**
 * Active users and archived (deleted) users live in two differently-shaped
 * tables (`user` has real-time joinable activity; `user_deletion_archive`
 * is a flat point-in-time snapshot) — rather than fight a raw SQL
 * `UNION ALL` across mismatched column types, both search-filtered sets are
 * fetched (each capped at `USERS_FETCH_CAP`, a safety valve rather than a
 * real pagination mechanism) and merged/sorted/paginated in application
 * code, the same "beta-scale, document the trade-off" posture
 * `accountUsage.ts` already established for its own per-user bucketing.
 */
export async function getAdminUsersPage(options: {
  search?: string;
  sort?: AdminUsersSortKey;
  dir?: "asc" | "desc";
  page?: number;
}): Promise<AdminUsersPage> {
  const search = options.search?.trim() ?? "";
  const sort: AdminUsersSortKey = options.sort && ADMIN_USERS_SORT_KEYS.includes(options.sort) ? options.sort : "createdAt";
  const dir = options.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, options.page ?? 1);

  const activeWhere = search ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`)) : undefined;
  const activeRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      // The outer reference is written as the literal qualified column
      // `"user"."id"` rather than interpolating `${users.id}` — drizzle
      // renders a bare `${users.id}` inside a correlated subquery as the
      // UNQUALIFIED column name "id", and since `document` (aliased `d`
      // below) also has its own `id` column, Postgres then reports "column
      // reference \"id\" is ambiguous" (42702) — found live running this
      // exact query. Qualifying it explicitly resolves the correlation
      // unambiguously; `"user"` is this table's real SQL name (`pgTable("user", ...)`
      // in schema.ts), not user input, so a literal fragment is safe here.
      docs: sql<number>`(select count(*) from document d where d.user_id = "user"."id")`,
      aiCostUsd: sql<number>`(
        select coalesce(sum(l.estimated_cost_usd), 0) from ai_usage_log l
        join document d on d.id = l.document_id where d.user_id = "user"."id"
      )`,
      chatMessages: sql<number>`(
        select count(*) from rag_message m
        join rag_conversation c on c.id = m.conversation_id where c.user_id = "user"."id"
      )`,
      lastActiveAt: sql<Date | null>`(select max(e.created_at) from usage_event e where e.user_id = "user"."id")`,
    })
    .from(users)
    .where(activeWhere)
    .limit(USERS_FETCH_CAP);

  const archivedWhere = search
    ? or(ilike(userDeletionArchives.email, `%${search}%`), ilike(userDeletionArchives.name, `%${search}%`))
    : undefined;
  const archivedRows = await db
    .select({
      id: userDeletionArchives.userId,
      email: userDeletionArchives.email,
      name: userDeletionArchives.name,
      createdAt: userDeletionArchives.userCreatedAt,
      deletedAt: userDeletionArchives.deletedAt,
      docs: userDeletionArchives.docsProcessed,
      aiCostUsd: userDeletionArchives.totalAiCostUsd,
      chatMessages: userDeletionArchives.chatMessages,
      lastActiveAt: userDeletionArchives.lastActiveAt,
    })
    .from(userDeletionArchives)
    .where(archivedWhere)
    .limit(USERS_FETCH_CAP);

  const merged: AdminUserRow[] = [
    ...activeRows.map((r): AdminUserRow => ({
      id: r.id,
      status: "active",
      email: r.email,
      name: r.name,
      createdAt: r.createdAt,
      deletedAt: null,
      docs: Number(r.docs),
      aiCostUsd: Number(r.aiCostUsd),
      chatMessages: Number(r.chatMessages),
      lastActiveAt: r.lastActiveAt ?? null,
    })),
    ...archivedRows.map((r): AdminUserRow => ({
      id: r.id,
      status: "deleted",
      email: r.email,
      name: r.name,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      docs: Number(r.docs ?? 0),
      aiCostUsd: Number(r.aiCostUsd ?? 0),
      chatMessages: Number(r.chatMessages ?? 0),
      lastActiveAt: r.lastActiveAt ?? null,
    })),
  ];

  const dirMul = dir === "asc" ? 1 : -1;
  merged.sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av instanceof Date && bv instanceof Date) return dirMul * (av.getTime() - bv.getTime());
    if (typeof av === "number" && typeof bv === "number") return dirMul * (av - bv);
    return dirMul * String(av).localeCompare(String(bv));
  });

  const totalMatching = merged.length;
  const start = (page - 1) * USERS_PAGE_SIZE;
  const rows = merged.slice(start, start + USERS_PAGE_SIZE);

  return { rows, page, pageSize: USERS_PAGE_SIZE, totalMatching };
}

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

// ---------------------------------------------------------------------------
// Feedback inbox
// ---------------------------------------------------------------------------

export interface AdminFeedbackRow {
  id: string;
  userId: string | null;
  email: string | null;
  category: "bug" | "idea" | "praise" | "other";
  body: string;
  path: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export async function getAdminFeedback(): Promise<AdminFeedbackRow[]> {
  return db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(200);
}

export async function markFeedbackReadQuery(feedbackId: string): Promise<void> {
  await db.update(feedback).set({ readAt: new Date() }).where(eq(feedback.id, feedbackId));
}
