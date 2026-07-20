import { db, learningResources, readingRecords, resourceRoles, understandingRatings, works } from "@ice/db";
import {
  buildCurriculum,
  countByRoute,
  type CurriculumCandidate,
  type CurriculumResult,
  type CurriculumRoute,
  type ProfileEntry,
} from "@ice/curriculum";
import { and, eq, inArray } from "drizzle-orm";

const EMPTY_ROUTE_COUNTS: Record<CurriculumRoute, number> = { minimal: 0, university: 0, graduate: 0 };

export interface CurriculumResponse extends CurriculumResult {
  /** False when the work has never been analyzed under v3 — 9.6 is a read-time
   *  view over `resource_role`/`learning_resource` (9.5), so there's nothing
   *  to build a study guide from yet. Same honest-empty-state posture as the
   *  Library (`apps/web/src/lib/library.ts`) rather than a silent empty list. */
  hasWorkIdentity: boolean;
  routeCounts: Record<CurriculumRoute, number>;
}

/**
 * The curriculum/study guide for ONE work (plan §34.4 9.6) — a five-stage,
 * route-filtered read-time view over the same `resource_role`/
 * `learning_resource` rows the Library reads, scoped to this one work's
 * `work_identity_id` instead of every owned work. No new table, no new AI
 * call: recomputed fresh each request from data 9.4/9.5's canaries already
 * proved gets written correctly (plan §34.3 "reuse, don't rebuild"), same
 * posture as `computeRoadmap` over `graph_edge`.
 *
 * Returns null when the caller doesn't own `workId` (IDOR-safe — the caller
 * turns this into a 404, never a distinguishable "forbidden").
 */
export async function computeCurriculum(
  userId: string,
  workId: string,
  route: CurriculumRoute,
): Promise<CurriculumResponse | null> {
  const [work] = await db
    .select({ id: works.id, workIdentityId: works.workIdentityId })
    .from(works)
    .where(and(eq(works.id, workId), eq(works.userId, userId)))
    .limit(1);
  if (!work) return null;

  if (!work.workIdentityId) {
    return { hasWorkIdentity: false, route, stages: [], routeCounts: EMPTY_ROUTE_COUNTS };
  }

  const roles = await db.select().from(resourceRoles).where(eq(resourceRoles.workIdentityId, work.workIdentityId));
  if (!roles.length) {
    return { hasWorkIdentity: true, route, stages: [], routeCounts: EMPTY_ROUTE_COUNTS };
  }

  const resourceIds = [...new Set(roles.map((r) => r.learningResourceId))];
  const resources = await db.select().from(learningResources).where(inArray(learningResources.id, resourceIds));
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  const [readingByResource, ratingByResource] = await Promise.all([
    db
      .select()
      .from(readingRecords)
      .where(and(eq(readingRecords.userId, userId), inArray(readingRecords.learningResourceId, resourceIds))),
    db
      .select()
      .from(understandingRatings)
      .where(and(eq(understandingRatings.userId, userId), inArray(understandingRatings.learningResourceId, resourceIds))),
  ]);

  const profile = new Map<string, ProfileEntry>();
  for (const r of readingByResource) {
    if (!r.learningResourceId) continue;
    profile.set(r.learningResourceId, { ...profile.get(r.learningResourceId), status: r.status });
  }
  for (const r of ratingByResource) {
    if (!r.learningResourceId) continue;
    profile.set(r.learningResourceId, { ...profile.get(r.learningResourceId), score: r.score });
  }

  const candidates: CurriculumCandidate[] = [];
  for (const role of roles) {
    const resource = resourceById.get(role.learningResourceId);
    if (!resource) continue;
    candidates.push({
      learningResourceId: resource.id,
      title: resource.title,
      authors: Array.isArray(resource.authors) ? (resource.authors as string[]) : [],
      year: resource.year,
      resourceType: resource.resourceType,
      relationship: role.relationship,
      readerLevel: role.readerLevel,
      rationale: role.rationale,
      confidence: role.confidence,
    });
  }

  const result = buildCurriculum(candidates, profile, route);
  const routeCounts = countByRoute(candidates, profile);

  return { hasWorkIdentity: true, ...result, routeCounts };
}
