import { conceptMastery, concepts, db, documents, ragConversations, ragMessages, readingRecords, works } from "@ice/db";
import { and, desc, eq } from "drizzle-orm";

/**
 * Workstream G (v.5) `/account/usage` data. Deliberately counts- and
 * progress-only — no `estimatedCostUsd`/`aiCostUsd` figure anywhere, per the
 * project's no-user-facing-cost-figures rule (the admin dashboard,
 * Workstream H, is the one surface allowed to show spend).
 *
 * Bucketing is done in application code over a small per-user row set
 * (beta scale) rather than a SQL `date_trunc` — the plan reserves that
 * (Workstream H's `lib/adminDashData.ts`) as the one file introducing it,
 * and a beta-scale per-user history has no performance reason to need it.
 */

const MONTHS_BACK = 6;
const DAYS_BACK = 14;
const MAX_CONCEPT_AXES = 6;

interface MonthBucket { start: Date; end: Date; label: string }
interface DayBucket { start: Date; end: Date }

function monthBuckets(count: number, now: Date = new Date()): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    buckets.push({ start, end, label: start.toLocaleDateString("en-US", { month: "short" }) });
  }
  return buckets;
}

function dayBuckets(count: number, now: Date = new Date()): DayBucket[] {
  const buckets: DayBucket[] = [];
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  for (let i = count - 1; i >= 0; i -= 1) {
    const end = new Date(endOfToday.getFullYear(), endOfToday.getMonth(), endOfToday.getDate() - i);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
    buckets.push({ start, end });
  }
  return buckets;
}

function countInBucket(dates: Array<Date | null>, bucket: { start: Date; end: Date }): number {
  return dates.filter((d) => d !== null && d >= bucket.start && d < bucket.end).length;
}

export interface AccountUsageSnapshot {
  docsOverTime: Array<{ label: string; value: number }>;
  readingProgressLabels: string[];
  readingProgressStarted: number[];
  readingProgressCompleted: number[];
  conceptAxes: string[];
  conceptValues: number[];
  chatActivity: number[];
}

export async function getAccountUsageSnapshot(userId: string): Promise<AccountUsageSnapshot> {
  const months = monthBuckets(MONTHS_BACK);
  const days = dayBuckets(DAYS_BACK);

  const docRows = await db.select({ createdAt: documents.createdAt }).from(documents).where(eq(documents.userId, userId));
  const docsOverTime = months.map((bucket) => ({ label: bucket.label, value: countInBucket(docRows.map((r) => r.createdAt), bucket) }));

  const recordRows = await db
    .select({ startedAt: readingRecords.startedAt, finishedAt: readingRecords.finishedAt })
    .from(readingRecords)
    .where(eq(readingRecords.userId, userId));
  // LineChart's own emptiness check is `series.some(v => finite values
  // exist)` — unlike RadarChart (which deliberately treats a real 0 score
  // as legitimate data), a month bucket's count of 0 is ALSO a finite
  // number, so 6 always-populated zero buckets would never trip LineChart's
  // empty state at all. When this account has no reading records
  // whatsoever, pass genuinely empty series instead of six zeros, so the
  // chart's own empty state renders honestly rather than a flat zero line.
  const readingProgressStarted = recordRows.length === 0 ? [] : months.map((bucket) => countInBucket(recordRows.map((r) => r.startedAt), bucket));
  const readingProgressCompleted = recordRows.length === 0 ? [] : months.map((bucket) => countInBucket(recordRows.map((r) => r.finishedAt), bucket));

  const masteryRows = await db
    .select({ label: concepts.label, score: conceptMastery.score })
    .from(conceptMastery)
    .innerJoin(concepts, eq(conceptMastery.conceptId, concepts.id))
    .where(eq(conceptMastery.userId, userId))
    .orderBy(desc(conceptMastery.score))
    .limit(MAX_CONCEPT_AXES);

  const chatRows = await db
    .select({ createdAt: ragMessages.createdAt })
    .from(ragMessages)
    .innerJoin(ragConversations, eq(ragMessages.conversationId, ragConversations.id))
    .where(and(eq(ragConversations.userId, userId), eq(ragMessages.role, "user")));
  // Same reasoning as readingProgress above — Sparkline's own emptiness
  // check counts finite values, and a zero-message day is still finite.
  const chatActivity = chatRows.length === 0 ? [] : days.map((bucket) => countInBucket(chatRows.map((r) => r.createdAt), bucket));

  return {
    docsOverTime,
    readingProgressLabels: months.map((b) => b.label),
    readingProgressStarted,
    readingProgressCompleted,
    conceptAxes: masteryRows.map((r) => r.label),
    conceptValues: masteryRows.map((r) => r.score),
    chatActivity,
  };
}

/** `/account/plan`'s non-enforced, decorative usage meters — never a real
 *  cap, always labeled as such (no upgrade affordance actually gates
 *  anything during the beta). Reuses `documents`/`works` counts already
 *  computed elsewhere in this file's spirit rather than a new query shape. */
export async function getAccountPlanCounts(userId: string): Promise<{ works: number; documents: number; chatMessages: number }> {
  const [workRows, docRows, chatRows] = await Promise.all([
    db.select({ id: works.id }).from(works).where(eq(works.userId, userId)),
    db.select({ id: documents.id }).from(documents).where(eq(documents.userId, userId)),
    db
      .select({ id: ragMessages.id })
      .from(ragMessages)
      .innerJoin(ragConversations, eq(ragMessages.conversationId, ragConversations.id))
      .where(eq(ragConversations.userId, userId)),
  ]);
  return { works: workRows.length, documents: docRows.length, chatMessages: chatRows.length };
}
