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
import type { ReaderLevel } from "@ice/roadmap";
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
  /** Every role this one canonical resource plays across the reader's works. */
  roles: Array<{
    relationship: string;
    readerLevel: ReaderLevel | null;
    rationale: string | null;
    confidence: number;
    recommendedFor: { workId: string; title: string }[];
  }>;
  recommendedFor: { workId: string; title: string }[];
  credibility: { authority: string | null; score: number } | null;
  creatorVerification: string | null;
  readingStatus: "planned" | "reading" | "completed" | "abandoned" | null;
  understandingScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function creatorVerification(creator: unknown): string | null {
  if (!creator || typeof creator !== "object") return null;
  const verification = (creator as { verification?: unknown }).verification;
  return typeof verification === "string" ? verification : null;
}

const AUTHORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

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

  const rolesByResourceId = new Map<string, typeof roles>();
  for (const role of roles) {
    const grouped = rolesByResourceId.get(role.learningResourceId) ?? [];
    grouped.push(role);
    rolesByResourceId.set(role.learningResourceId, grouped);
  }

  const items: LibraryItem[] = [];
  for (const [resourceId, resourceRolesForResource] of rolesByResourceId) {
    const resource = resourceById.get(resourceId);
    if (!resource) continue;
    const sortedRoles = [...resourceRolesForResource].sort((left, right) => right.confidence - left.confidence);
    const libraryRoles = sortedRoles.map((role) => ({
      relationship: role.relationship,
      readerLevel: role.readerLevel as ReaderLevel | null,
      rationale: role.rationale,
      confidence: role.confidence,
      recommendedFor: identityToWorks.get(role.workIdentityId) ?? [],
    }));
    const recommendedByWorkId = new Map<string, { workId: string; title: string }>();
    for (const role of libraryRoles) {
      for (const work of role.recommendedFor) recommendedByWorkId.set(work.workId, work);
    }
    const recommendedFor = [...recommendedByWorkId.values()];
    const primaryRole = libraryRoles[0];
    if (!primaryRole) continue;
    const reading = readingByResourceId.get(resource.id);
    const rating = ratingByResourceId.get(resource.id);

    let credibility: LibraryItem["credibility"] = null;
    if (resource.normalizedKey) {
      for (const { workId } of recommendedFor) {
        const found = latestResourceIdByWorkKey.get(`${workId}:${resource.normalizedKey}`);
        const cred = found ? credByResourceId.get(found.resourceId) : undefined;
        if (cred) {
          const candidate = { authority: cred.authority, score: cred.score };
          const candidateRank = AUTHORITY_ORDER[candidate.authority ?? "E"] ?? 5;
          const currentRank = AUTHORITY_ORDER[credibility?.authority ?? "E"] ?? 5;
          if (!credibility || candidateRank < currentRank || (candidateRank === currentRank && candidate.score > credibility.score)) {
            credibility = candidate;
          }
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
      relationship: primaryRole.relationship,
      confidence: primaryRole.confidence,
      rationale: primaryRole.rationale,
      readerLevel: primaryRole.readerLevel,
      roles: libraryRoles,
      recommendedFor,
      credibility,
      creatorVerification: creatorVerification(resource.creator),
      readingStatus: reading?.status ?? null,
      understandingScore: rating?.score ?? null,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    });
  }

  return items;
}
