import {
  aiUsageLogs,
  db,
  documents,
  processingRuns,
  ragMessages,
  userDeletionArchives,
  usageEvents,
  users,
} from "@ice/db";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { DAILY_SERIES_DAYS, dayAxis, dayLabels, fillDailySeries } from "@/lib/admin/adminDashDayAxis";

/**
 * Extracted verbatim from `adminDashData.ts` (Workstream H, v.5): the
 * `/admin-dash` overview page's own queries — tiles, the 30-day daily
 * series, and processing-run health. Read-only and parameterized
 * throughout. `adminDashData.ts` re-exports everything below unchanged.
 */

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
