import { and, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { claimRelationships, db, debateClusters, researchClaims, researchCorpusItems, researchJobRequests, researchMonitorHits, researchMonitors, researchProjects, works } from "@ice/db";

/**
 * Zero-LLM, zero-cache dashboard insight-feed queries (Phase 29.3
 * reverse-direction lane, plan §"What ScholarLens improves in existing
 * Palimnote (reverse direction)" — "Zero-LLM insight feed": "ScholarLens's
 * pure-DB-read dashboard pattern (library state + where the tension is) as
 * a Palimnote dashboard module").
 *
 * ZERO-LLM / ZERO-CACHE RULE: every count below is a plain owner-scoped SQL
 * `count(*)` aggregate over rows a paid research job already wrote — no
 * model call here, ever, and nothing is memoized. The dashboard is read at
 * most once per page load, so the cost of one extra `count()` query is
 * negligible next to the risk a cache would introduce: a stale "0
 * contradictions" reading right after a real one was detected is a worse
 * failure than a few extra milliseconds of query time (same reasoning the
 * Roadmap's "computed on demand, never a persisted snapshot" Design
 * Decision already applies elsewhere in this codebase).
 */
export interface ResearchInsightCounts {
  /** `research_project` rows this user owns that aren't archived. */
  activeProjects: number;
  /** `research_claim` rows with `verification_status = 'unreviewed'`
   *  (active, not hidden) — claims nobody has looked at yet. */
  claimsAwaitingReview: number;
  /** `claim_relationship` rows with `valence = 'contradiction'` created in
   *  the last 7 days — freshly surfaced tension, not the lifetime total. */
  newContradictions: number;
  /** `debate_cluster` rows with `status = 'active'` (not `stale`). */
  activeDebateClusters: number;
  /** `research_job_request` rows currently `queued`/`running`. */
  runningJobs: number;
  /** `research_job_request` rows that ended `failed`. */
  failedJobs: number;
  /** Phase 29.1: `research_monitor_hit` rows not yet dismissed, across
   *  every monitor this user owns — undismissed findings a monitor
   *  surfaced, not a lifetime total. */
  newMonitorHits: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function firstCount(rows: Array<{ value: number }>): number {
  return rows[0]?.value ?? 0;
}

/** Owner-scoped throughout — every query below filters on `userId` as a
 *  real SQL predicate, never fetched-then-filtered in application code
 *  (the standing per-user-data-isolation discipline this codebase applies
 *  everywhere else, e.g. `getOwnedDocument`). */
export async function getResearchInsightCounts(userId: string): Promise<ResearchInsightCounts> {
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

  const [
    activeProjectsRows,
    claimsAwaitingReviewRows,
    newContradictionsRows,
    activeDebateClustersRows,
    runningJobsRows,
    failedJobsRows,
    newMonitorHitsRows,
  ] = await Promise.all([
      db
        .select({ value: count() })
        .from(researchProjects)
        .where(and(eq(researchProjects.userId, userId), isNull(researchProjects.archivedAt))),
      db
        .select({ value: count() })
        .from(researchClaims)
        .where(
          and(
            eq(researchClaims.userId, userId),
            eq(researchClaims.status, "active"),
            eq(researchClaims.verificationStatus, "unreviewed"),
            eq(researchClaims.hidden, false),
          ),
        ),
      db
        .select({ value: count() })
        .from(claimRelationships)
        .where(
          and(
            eq(claimRelationships.userId, userId),
            eq(claimRelationships.status, "active"),
            eq(claimRelationships.valence, "contradiction"),
            gte(claimRelationships.createdAt, sevenDaysAgo),
          ),
        ),
      db
        .select({ value: count() })
        .from(debateClusters)
        .where(and(eq(debateClusters.userId, userId), eq(debateClusters.status, "active"))),
      db
        .select({ value: count() })
        .from(researchJobRequests)
        .where(and(eq(researchJobRequests.userId, userId), inArray(researchJobRequests.status, ["queued", "running"]))),
      db
        .select({ value: count() })
        .from(researchJobRequests)
        .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.status, "failed"))),
      // Phase 29.1: joined through research_monitor for ownership —
      // research_monitor_hit carries no user_id of its own.
      db
        .select({ value: count() })
        .from(researchMonitorHits)
        .innerJoin(researchMonitors, eq(researchMonitors.id, researchMonitorHits.monitorId))
        .where(and(eq(researchMonitors.userId, userId), isNull(researchMonitorHits.dismissedAt))),
    ]);

  return {
    activeProjects: firstCount(activeProjectsRows),
    claimsAwaitingReview: firstCount(claimsAwaitingReviewRows),
    newContradictions: firstCount(newContradictionsRows),
    activeDebateClusters: firstCount(activeDebateClustersRows),
    runningJobs: firstCount(runningJobsRows),
    failedJobs: firstCount(failedJobsRows),
    newMonitorHits: firstCount(newMonitorHitsRows),
  };
}

/**
 * "No empty noise" gate: the module is worth showing only when there's
 * something to say — at least one active project, or at least one non-zero
 * signal. A brand-new account with zero research activity should not see an
 * empty "Research activity" card competing for attention with the rest of
 * the dashboard.
 */
/**
 * Home surface's second evidence card (stage4-read-spec.md §1.2 item 2):
 * one concrete, linkable claim awaiting attention — not the
 * `claimsAwaitingReview` count above, which only tells Home "some number of
 * claims need review," not which one to name. Same owner-scoping and
 * active/unreviewed/not-hidden filter as `getResearchInsightCounts`'s own
 * `claimsAwaitingReviewRows` query (kept in exact sync — a claim this query
 * excludes must never be the one that count is nonzero for), just returning
 * the single most recently extracted row instead of a count. Zero new AI
 * call, zero cache — same discipline as every other query in this file.
 */
export interface ClaimAwaitingAttention {
  id: string;
  claimText: string;
  workTitle: string | null;
  corpusItemTitle: string | null;
}

export async function getClaimAwaitingAttention(userId: string): Promise<ClaimAwaitingAttention | null> {
  const [row] = await db
    .select({
      id: researchClaims.id,
      claimText: researchClaims.claimText,
      workTitle: works.title,
      corpusItemTitle: researchCorpusItems.title,
    })
    .from(researchClaims)
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .leftJoin(researchCorpusItems, eq(researchCorpusItems.id, researchClaims.corpusItemId))
    .where(
      and(
        eq(researchClaims.userId, userId),
        eq(researchClaims.status, "active"),
        eq(researchClaims.verificationStatus, "unreviewed"),
        eq(researchClaims.hidden, false),
      ),
    )
    .orderBy(desc(researchClaims.createdAt))
    .limit(1);
  return row ?? null;
}

export function hasResearchInsightSignal(counts: ResearchInsightCounts): boolean {
  return (
    counts.activeProjects > 0 ||
    counts.claimsAwaitingReview > 0 ||
    counts.newContradictions > 0 ||
    counts.activeDebateClusters > 0 ||
    counts.runningJobs > 0 ||
    counts.failedJobs > 0 ||
    counts.newMonitorHits > 0
  );
}
