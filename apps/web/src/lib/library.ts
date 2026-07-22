import {
  credibilityAssessments,
  citations,
  citationLibraryLinks,
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
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { matchesLibrarySearch, normalizeForSearch, SOURCE_TYPE_LABEL } from "@/lib/librarySearch";

// Re-exported for existing/other server-side callers — the canonical
// definitions now live in `librarySearch.ts` (client-safe: no `@ice/db`
// import), so a "use client" component can import them directly without
// dragging this server module's DB dependency into the browser bundle.
export { matchesLibrarySearch, normalizeForSearch, SOURCE_TYPE_LABEL };

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
 * analyzed under v3. A user with no v3-analyzed work has no Library sources
 * yet, but still receives a focusable empty shelf for their uploaded works.
 */
/**
 * Phase 20.6: a review/edition/translation/excerpt record displayed UNDER its
 * canonical work entry rather than beside it as a sibling row. Everything the
 * record carried is preserved here — attachment is a display decision, not a
 * data merge.
 */
export interface AttachedLibraryRecord {
  id: string;
  title: string;
  role: string;
  url: string | null;
  provider: string;
  resourceType: string;
  year: number | null;
  authors: string[];
  citationProvenance: LibraryItem["citationProvenance"];
}

export interface LibraryItem {
  id: string;
  title: string;
  url: string | null;
  provider: string;
  resourceType: string;
  year: number | null;
  authors: string[];
  venue: string | null;
  doi: string | null;
  isbn: string | null;
  peerReviewed: boolean | null;
  popularity: unknown;
  relationship: string;
  confidence: number;
  rationale: string | null;
  readerLevel: string | null;
  /**
   * The relationship and credibility evidence for each one of the owner's
   * works this source supports. A Library resource has no one intrinsic
   * relevance: it is relevant in relation to a particular uploaded work.
   */
  focusMetrics: Array<{
    workId: string;
    relationship: string;
    rationale: string | null;
    readerLevel: ReaderLevel | null;
    /** resource_role confidence: relationship relevance for this work. */
    relevance: number;
    credibility: { authority: string | null; score: number } | null;
  }>;
  /** Every role this one canonical resource plays across the reader's works. */
  roles: Array<{
    relationship: string;
    readerLevel: ReaderLevel | null;
    rationale: string | null;
    confidence: number;
    recommendedFor: { workId: string; title: string }[];
  }>;
  /** Exact authorial/direct citation evidence, separate from discovery provenance. */
  citationProvenance: Array<{
    source: "Bibliography" | "Footnote" | "Endnote" | "Direct citation";
    location: string;
    resolutionState: "pending" | "resolved" | "unresolved";
  }>;
  recommendedFor: { workId: string; title: string }[];
  /** Phase 20.6: how this record relates to its canonical work identity. */
  workRole: string;
  /** Phase 20.6: reviews/editions/translations collapsed under this entry. */
  attached: AttachedLibraryRecord[];
  credibility: { authority: string | null; score: number } | null;
  creatorVerification: string | null;
  readingStatus: "planned" | "reading" | "completed" | "abandoned" | null;
  understandingScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LibraryWork {
  id: string;
  title: string;
  createdAt: Date;
}

export interface LibraryData {
  /** All active uploads, newest first — including works with no sources yet. */
  works: LibraryWork[];
  items: LibraryItem[];
}

function creatorVerification(creator: unknown): string | null {
  if (!creator || typeof creator !== "object") return null;
  const verification = (creator as { verification?: unknown }).verification;
  return typeof verification === "string" ? verification : null;
}

const AUTHORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

export async function getLibrary(userId: string, options: { search?: string } = {}): Promise<LibraryData> {
  const ownedWorks = await db
    .select({ id: works.id, title: works.title, workIdentityId: works.workIdentityId, createdAt: works.createdAt })
    .from(works)
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(desc(works.createdAt), works.id);
  const libraryWorks: LibraryWork[] = ownedWorks.map(({ id, title, createdAt }) => ({ id, title, createdAt }));
  const identityToWorks = new Map<string, { workId: string; title: string }[]>();
  for (const w of ownedWorks) {
    if (!w.workIdentityId) continue;
    const list = identityToWorks.get(w.workIdentityId) ?? [];
    list.push({ workId: w.id, title: w.title });
    identityToWorks.set(w.workIdentityId, list);
  }
  const ownedIdentityIds = [...identityToWorks.keys()];
  // Keep all uploads in the payload even before a v3/v4 run establishes a
  // work_identity. The Library's focus selector must be able to open on a
  // newly uploaded work with an honest empty-recommendations state.
  if (!ownedIdentityIds.length) return { works: libraryWorks, items: [] };

  const roles = await db
    .select()
    .from(resourceRoles)
    .where(inArray(resourceRoles.workIdentityId, ownedIdentityIds));
  if (!roles.length) return { works: libraryWorks, items: [] };

  const resourceIds = [...new Set(roles.map((r) => r.learningResourceId))];
  const resources = await db.select().from(learningResources).where(inArray(learningResources.id, resourceIds));
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  const citationProvenanceRows = resourceIds.length
    ? await db
        .select({
          learningResourceId: citationLibraryLinks.learningResourceId,
          sourceType: citations.sourceType,
          sourceAnchor: citations.sourceAnchor,
          resolutionState: citations.resolutionState,
        })
        .from(citationLibraryLinks)
        .innerJoin(citations, eq(citations.id, citationLibraryLinks.citationId))
        .where(inArray(citationLibraryLinks.learningResourceId, resourceIds))
    : [];
  const citationProvenanceByResourceId = new Map<string, LibraryItem["citationProvenance"]>();
  for (const provenance of citationProvenanceRows) {
    const anchor = provenance.sourceAnchor as { pageIndex?: number | null; marker?: string | null } | null;
    const location = [
      anchor?.pageIndex != null ? `page ${anchor.pageIndex + 1}` : null,
      anchor?.marker ? `note ${anchor.marker}` : null,
    ].filter(Boolean).join(" · ") || "source location unavailable";
    const source = provenance.sourceType === "bibliography"
      ? "Bibliography"
      : provenance.sourceType === "footnote"
        ? "Footnote"
        : provenance.sourceType === "endnote"
          ? "Endnote"
          : "Direct citation";
    const existing = citationProvenanceByResourceId.get(provenance.learningResourceId) ?? [];
    if (!existing.some((entry) => entry.source === source && entry.location === location && entry.resolutionState === provenance.resolutionState)) {
      existing.push({ source, location, resolutionState: provenance.resolutionState });
      citationProvenanceByResourceId.set(provenance.learningResourceId, existing);
    }
  }

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
  /** Phase 20.6: the canonical work identity of each ITEM's resource (not of
   *  the uploads it is recommended for) — the display-collapse group key. */
  const resourceIdentityByItemId = new Map<string, string>();
  for (const [resourceId, resourceRolesForResource] of rolesByResourceId) {
    const resource = resourceById.get(resourceId);
    if (!resource) continue;
    const currentResource = resource;
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
    const recommendedFor = [...recommendedByWorkId.values()].sort((left, right) => left.title.localeCompare(right.title) || left.workId.localeCompare(right.workId));
    const primaryRole = libraryRoles[0];
    if (!primaryRole) continue;
    const reading = readingByResourceId.get(resource.id);
    const rating = ratingByResourceId.get(resource.id);

    function credibilityForWork(workId: string): LibraryItem["credibility"] {
      if (!currentResource.normalizedKey) return null;
      const found = latestResourceIdByWorkKey.get(`${workId}:${currentResource.normalizedKey}`);
      const cred = found ? credByResourceId.get(found.resourceId) : undefined;
      return cred ? { authority: cred.authority, score: cred.score } : null;
    }

    let credibility: LibraryItem["credibility"] = null;
    if (resource.normalizedKey) {
      for (const { workId } of recommendedFor) {
        const candidate = credibilityForWork(workId);
        if (candidate) {
          const candidateRank = AUTHORITY_ORDER[candidate.authority ?? "E"] ?? 5;
          const currentRank = AUTHORITY_ORDER[credibility?.authority ?? "E"] ?? 5;
          if (!credibility || candidateRank < currentRank || (candidateRank === currentRank && candidate.score > credibility.score)) {
            credibility = candidate;
          }
        }
      }
    }

    const focusMetrics = recommendedFor.flatMap((work) => {
      const role = resourceRolesForResource
        .filter((candidate) => identityToWorks.get(candidate.workIdentityId)?.some((owned) => owned.workId === work.workId))
        .sort((left, right) => right.confidence - left.confidence || left.relationship.localeCompare(right.relationship))[0];
      if (!role) return [];
      return [{
        workId: work.workId,
        relationship: role.relationship,
        rationale: role.rationale,
        readerLevel: role.readerLevel as ReaderLevel | null,
        relevance: role.confidence,
        credibility: credibilityForWork(work.workId),
      }];
    });

    items.push({
      id: resource.id,
      title: resource.title,
      url: resource.url,
      provider: resource.provider,
      resourceType: resource.resourceType,
      year: resource.year,
      authors: Array.isArray(resource.authors) ? (resource.authors as string[]) : [],
      venue: resource.venue,
      doi: resource.doi,
      isbn: resource.isbn,
      peerReviewed: resource.peerReviewed,
      popularity: resource.popularity,
      relationship: primaryRole.relationship,
      confidence: primaryRole.confidence,
      rationale: primaryRole.rationale,
      readerLevel: primaryRole.readerLevel,
      focusMetrics,
      roles: libraryRoles,
      citationProvenance: citationProvenanceByResourceId.get(resource.id) ?? [],
      recommendedFor,
      workRole: resource.workRole,
      attached: [],
      credibility,
      creatorVerification: creatorVerification(resource.creator),
      readingStatus: reading?.status ?? null,
      understandingScore: rating?.score ?? null,
      createdAt: resource.createdAt,
      updatedAt: resource.updatedAt,
    });
    if (resource.workIdentityId) resourceIdentityByItemId.set(resource.id, resource.workIdentityId);
  }

  // Phase 20.6 canonical display collapse: resources sharing one canonical
  // work identity render as ONE Library entry — the primary text — with its
  // reviews/editions/translations ATTACHED under it, never merged into it
  // (each attached record keeps its id, role, provenance, and reading state
  // in the payload). Resources with no established identity (including every
  // directly-seeded test fixture) are untouched. Recommendations and focus
  // evidence from attached records are folded into the canonical entry so
  // work-focus filtering still finds the group.
  const ROLE_DISPLAY_RANK: Record<string, number> = { primary: 0, edition: 1, translation: 2, excerpt: 3, review: 4 };
  const groupsByIdentity = new Map<string, LibraryItem[]>();
  const collapsedItems: LibraryItem[] = [];
  for (const item of items) {
    const identityId = resourceIdentityByItemId.get(item.id);
    if (!identityId) {
      collapsedItems.push(item);
      continue;
    }
    groupsByIdentity.set(identityId, [...(groupsByIdentity.get(identityId) ?? []), item]);
  }
  for (const group of groupsByIdentity.values()) {
    if (group.length === 1) {
      collapsedItems.push(group[0]);
      continue;
    }
    const sorted = [...group].sort((left, right) =>
      (ROLE_DISPLAY_RANK[left.workRole] ?? 5) - (ROLE_DISPLAY_RANK[right.workRole] ?? 5) ||
      (right.doi ? 1 : 0) - (left.doi ? 1 : 0) ||
      (right.isbn ? 1 : 0) - (left.isbn ? 1 : 0) ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id));
    const [head, ...rest] = sorted;
    const mergedRecommended = new Map(head.recommendedFor.map((work) => [work.workId, work]));
    const mergedFocus = new Map(head.focusMetrics.map((metric) => [metric.workId, metric]));
    const mergedRoles = [...head.roles];
    for (const item of rest) {
      for (const work of item.recommendedFor) if (!mergedRecommended.has(work.workId)) mergedRecommended.set(work.workId, work);
      for (const metric of item.focusMetrics) if (!mergedFocus.has(metric.workId)) mergedFocus.set(metric.workId, metric);
      mergedRoles.push(...item.roles);
    }
    collapsedItems.push({
      ...head,
      recommendedFor: [...mergedRecommended.values()].sort((left, right) => left.title.localeCompare(right.title) || left.workId.localeCompare(right.workId)),
      focusMetrics: [...mergedFocus.values()],
      roles: mergedRoles,
      attached: rest.map((item) => ({
        id: item.id,
        title: item.title,
        role: item.workRole,
        url: item.url,
        provider: item.provider,
        resourceType: item.resourceType,
        year: item.year,
        authors: item.authors,
        citationProvenance: item.citationProvenance,
      })),
    });
  }

  // Server-authoritative search (plan §20.1): filtered here, before the
  // payload is ever serialized to a client, rather than shipping every
  // item to the browser and filtering with a client useMemo the way the
  // existing relationship/source-type/reader-level filters do. Applied
  // last, over the fully-assembled items, so it composes with everything
  // above (credibility, roles, recommendedFor) with no risk of excluding
  // a resource before its search-relevant fields (doi/isbn/venue) are set.
  const normalizedQuery = options.search ? normalizeForSearch(options.search) : "";
  const searchedItems = normalizedQuery ? collapsedItems.filter((item) => matchesLibrarySearch(item, normalizedQuery)) : collapsedItems;

  return { works: libraryWorks, items: searchedItems };
}
