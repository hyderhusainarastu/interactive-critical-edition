import { db, researchClaims, researchJobRequests, researchProjectMembers } from "@ice/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getOwnedResearchProject } from "./projects";

/**
 * The project overview's zero-LLM insight feed: pure SQL reads over what a
 * project already has, computed fresh on every request rather than stored
 * — the same `@ice/roadmap`/curriculum precedent (`docs/PROJECT-LOG.md`
 * Design Decisions: "Roadmap computed on demand... no stale state to
 * invalidate"). A persisted feed snapshot would drift the instant a claim
 * is verified or a job finishes; recomputing means there is nothing to
 * invalidate and nothing that can silently go stale. No model call, no
 * cache table — every field here is a `count`/`select` over rows the
 * pipeline already wrote.
 */

export interface ResearchInsightFeed {
  unreviewedClaimCount: number;
  runningJobCount: number;
  recentFailedJobs: { id: string; jobType: string; error: string | null; updatedAt: Date }[];
  latestCompletedJob: { id: string; jobType: string; coverage: string | null; note: string | null; updatedAt: Date } | null;
}

const EMPTY_FEED: ResearchInsightFeed = {
  unreviewedClaimCount: 0,
  runningJobCount: 0,
  recentFailedJobs: [],
  latestCompletedJob: null,
};

export async function getResearchInsightFeed(userId: string, projectId: string): Promise<ResearchInsightFeed> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return EMPTY_FEED;

  const memberWorkIds = (await db.select({ workId: researchProjectMembers.workId }).from(researchProjectMembers).where(eq(researchProjectMembers.projectId, projectId)))
    .map((r) => r.workId)
    .filter((id): id is string => id != null);

  const [unreviewedClaimCount, jobs] = await Promise.all([
    memberWorkIds.length === 0
      ? Promise.resolve(0)
      : db
          .select({ id: researchClaims.id })
          .from(researchClaims)
          .where(
            and(
              eq(researchClaims.userId, userId),
              eq(researchClaims.status, "active"),
              eq(researchClaims.verificationStatus, "unreviewed"),
              inArray(researchClaims.workId, memberWorkIds),
            ),
          )
          .then((rows) => rows.length),
    db
      .select({
        id: researchJobRequests.id,
        jobType: researchJobRequests.jobType,
        status: researchJobRequests.status,
        coverage: researchJobRequests.coverage,
        note: researchJobRequests.note,
        error: researchJobRequests.error,
        updatedAt: researchJobRequests.updatedAt,
        scope: researchJobRequests.scope,
      })
      .from(researchJobRequests)
      .where(eq(researchJobRequests.userId, userId))
      .orderBy(desc(researchJobRequests.updatedAt))
      .limit(200),
  ]);

  const projectJobs = jobs.filter((job) => {
    const scope = job.scope as { workIds?: unknown } | null;
    const workIds = Array.isArray(scope?.workIds) ? (scope.workIds as unknown[]) : [];
    return workIds.some((id) => typeof id === "string" && memberWorkIds.includes(id));
  });

  const runningJobCount = projectJobs.filter((j) => j.status === "planned" || j.status === "queued" || j.status === "running").length;
  const recentFailedJobs = projectJobs
    .filter((j) => j.status === "failed")
    .slice(0, 5)
    .map((j) => ({ id: j.id, jobType: j.jobType, error: j.error, updatedAt: j.updatedAt }));
  const latestCompleted = projectJobs.find((j) => j.status === "complete") ?? null;

  return {
    unreviewedClaimCount,
    runningJobCount,
    recentFailedJobs,
    latestCompletedJob: latestCompleted
      ? { id: latestCompleted.id, jobType: latestCompleted.jobType, coverage: latestCompleted.coverage, note: latestCompleted.note, updatedAt: latestCompleted.updatedAt }
      : null,
  };
}
