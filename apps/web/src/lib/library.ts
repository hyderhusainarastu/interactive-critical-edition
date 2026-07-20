import {
  credibilityAssessments,
  db,
  documents,
  learningResources,
  processingRuns,
  readingRecords,
  researchResources,
  resourceRoles,
  understandingRatings,
  works,
} from "@ice/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

/**
 * The Library (plan §34.4 9.5): every source the research pipeline has
 * recommended for one of the reader's OWN uploads, read from the durable
 * cross-run tables `learning_resource`/`resource_role` (populated only by a
 * v3 run — see `apps/worker/src/analyze.ts`), not the run-scoped
 * `research_resource` the per-document "Sources consulted" panel uses.
 *
 * Scoping: a `resource_role` targets a `work_identity`, not a `works` row
 * directly, so "recommended for one of MY works" means joining through
 * `works.workIdentityId` — set the first time one of the user's uploads is
 * analyzed under v3. A user with no v3-analyzed work has an empty Library;
 * that is the honest state while production stays on v2, not a bug.
 */
export interface LibraryItem {
  id: string;
  title: string;
  url: string | null;
  provider: string;
  resourceType: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  peerReviewed: boolean | null;
  popularity: unknown;
  relationship: string;
  confidence: number;
  rationale: string | null;
  readerLevel: string | null;
  recommendedFor: { workId: string; title: string }[];
  credibility: { authority: string | null; score: number } | null;
  readingStatus: "planned" | "reading" | "completed" | "abandoned" | null;
  understandingScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getLibrary(userId: string): Promise<LibraryItem[]> {
  const ownedWorks = await db
    .select({ id: works.id, title: works.title, workIdentityId: works.workIdentityId })
    .from(works)
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)));
  const identityToWorks = new Map<string, { workId: string; title: string }[]>();
  for (const w of ownedWorks) {
    if (!w.workIdentityId) continue;
    const list = identityToWorks.get(w.workIdentityId) ?? [];
    list.push({ workId: w.id, title: w.title });
    identityToWorks.set(w.workIdentityId, list);
  }
  const ownedIdentityIds = [...identityToWorks.keys()];
  if (!ownedIdentityIds.length) return [];

  const roles = await db
    .select()
    .from(resourceRoles)
    .where(inArray(resourceRoles.workIdentityId, ownedIdentityIds));
  if (!roles.length) return [];

  const resourceIds = [...new Set(roles.map((r) => r.learningResourceId))];
  const resources = await db.select().from(learningResources).where(inArray(learningResources.id, resourceIds));
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  const [readingByResource, ratingByResource] = await Promise.all([
    db.select().from(readingRecords).where(and(eq(readingRecords.userId, userId), inArray(readingRecords.learningResourceId, resourceIds))),
    db.select().from(understandingRatings).where(and(eq(understandingRatings.userId, userId), inArray(understandingRatings.learningResourceId, resourceIds))),
  ]);
  const readingByResourceId = new Map(readingByResource.map((r) => [r.learningResourceId, r]));
  const ratingByResourceId = new Map(ratingByResource.map((r) => [r.learningResourceId, r]));

  // Credibility: one query joining research_resource -> processing_run ->
  // document, scoped to the exact owned works these roles point at (not a
  // workKey string match, which would compare the wrong identity — see the
  // 9.5 build notes) — then pick the most recently discovered row per
  // (workId, normalizedKey) pair for its credibility_assessment.
  const normalizedKeys = [...new Set(resources.map((r) => r.normalizedKey))];
  const ownedWorkIds = ownedWorks.map((w) => w.id);
  const candidateResources = normalizedKeys.length
    ? await db
        .select({
          resourceId: researchResources.id,
          normalizedKey: researchResources.normalizedKey,
          createdAt: researchResources.createdAt,
          workId: documents.workId,
        })
        .from(researchResources)
        .innerJoin(processingRuns, eq(processingRuns.id, researchResources.runId))
        .innerJoin(documents, eq(documents.id, processingRuns.documentId))
        .where(and(inArray(researchResources.normalizedKey, normalizedKeys), inArray(documents.workId, ownedWorkIds)))
    : [];
  const latestResourceIdByWorkKey = new Map<string, { resourceId: string; createdAt: Date }>();
  for (const c of candidateResources) {
    if (!c.normalizedKey) continue;
    const mapKey = `${c.workId}:${c.normalizedKey}`;
    const existing = latestResourceIdByWorkKey.get(mapKey);
    if (!existing || c.createdAt > existing.createdAt) latestResourceIdByWorkKey.set(mapKey, { resourceId: c.resourceId, createdAt: c.createdAt });
  }
  const credResourceIds = [...new Set([...latestResourceIdByWorkKey.values()].map((v) => v.resourceId))];
  const creds = credResourceIds.length
    ? await db.select().from(credibilityAssessments).where(inArray(credibilityAssessments.resourceId, credResourceIds))
    : [];
  const credByResourceId = new Map(creds.map((c) => [c.resourceId, c]));

  const items: LibraryItem[] = [];
  for (const role of roles) {
    const resource = resourceById.get(role.learningResourceId);
    if (!resource) continue;
    const recommendedFor = identityToWorks.get(role.workIdentityId) ?? [];
    const reading = readingByResourceId.get(resource.id);
    const rating = ratingByResourceId.get(resource.id);

    let credibility: LibraryItem["credibility"] = null;
    if (resource.normalizedKey) {
      for (const { workId } of recommendedFor) {
        const found = latestResourceIdByWorkKey.get(`${workId}:${resource.normalizedKey}`);
        const cred = found ? credByResourceId.get(found.resourceId) : undefined;
        if (cred) {
          credibility = { authority: cred.authority, score: cred.score };
          break;
        }
      }
    }

    items.push({
      id: resource.id,
      title: resource.title,
      url: resource.url,
      provider: resource.provider,
      resourceType: resource.resourceType,
      year: resource.year,
      authors: Array.isArray(resource.authors) ? (resource.authors as string[]) : [],
      venue: resource.venue,
      peerReviewed: resource.peerReviewed,
      popularity: resource.popularity,
      relationship: role.relationship,
      confidence: role.confidence,
      rationale: role.rationale,
      readerLevel: role.readerLevel,
      recommendedFor,
      credibility,
      readingStatus: reading?.status ?? null,
      understandingScore: rating?.score ?? null,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    });
  }

  return items;
}
