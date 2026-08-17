import {
  credibilityAssessments,
  db,
  documents,
  learningResources,
  processingRuns,
  readingRecords,
  researchResources,
  resourceRoles,
  workIdentities,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";

/**
 * Seeds a work already linked to a `work_identity`, plus one Library item
 * recommended for it (`learning_resource` + `resource_role`) — the shape
 * `apps/worker/src/analyze.ts`'s v3-only promotion block writes (plan §34.4
 * 9.5). Concepts are real extraction output normally; the Library items here
 * are SEEDED rather than produced by the real pipeline, same CI-safety
 * reasoning as `seedWorkWithConcepts` (no worker, no live model call).
 */
export async function seedWorkWithLibraryItem(
  userId: string,
  opts: {
    title?: string;
    resourceTitle?: string;
    relationship?: "prerequisite" | "interpretive_aid" | "secondary_scholarly_recommendation";
    readingStatus?: "planned" | "reading" | "completed" | "abandoned";
    /** Reader level the seeded resource_role targets, or null for "every level" (the default, matching the prior hardcoded behavior). */
    readerLevel?: "beginner" | "undergraduate" | "advanced" | "research" | null;
  } = {},
): Promise<{ workId: string; resourceId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.title ?? "Vice and Reason", authorName: "Terence Irwin" })
    .returning({ id: works.id });
  const [identity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:${suffix}`, canonicalTitle: opts.title ?? "Vice and Reason", authorSurname: "irwin", authors: ["Terence Irwin"], evidence: "seeded for test" })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));

  const [resource] = await db
    .insert(learningResources)
    .values({
      title: opts.resourceTitle ?? "Nicomachean Ethics",
      normalizedKey: `title:${suffix}`,
      resourceType: "book",
      provider: "openalex",
      authors: ["Aristotle"],
      year: -340,
      peerReviewed: null,
    })
    .returning({ id: learningResources.id });
  await db.insert(resourceRoles).values({
    learningResourceId: resource.id,
    workIdentityId: identity.id,
    relationship: opts.relationship ?? "prerequisite",
    readerLevel: opts.readerLevel ?? null,
    rationale: "Foundational for understanding the paper's central argument.",
    confidence: 0.8,
    createdBy: "system",
  });

  if (opts.readingStatus) {
    await db.insert(readingRecords).values({ userId, learningResourceId: resource.id, status: opts.readingStatus });
  }

  return { workId: work.id, resourceId: resource.id };
}

/**
 * Same seeding shape as `seedWorkWithLibraryItem`, but for ONE work with
 * SEVERAL `resource_role` rows across different relationship categories —
 * what curriculum.spec.ts needs to exercise multiple stages at once (plan
 * §34.4 9.6). Kept separate rather than generalizing the singular helper so
 * existing callers/signatures don't change.
 *
 * Unlike `seedWorkWithLibraryItem`, this ALSO inserts a `documents` row.
 * `/library` reads across every owned work via `getLibrary(userId)`, which
 * never needs one — but `/works/[workId]/curriculum` resolves ownership
 * through `getOwnedDocument`, an inner join against `documents`, so a work
 * with no document 404s before the curriculum view ever renders.
 */
export async function seedWorkWithLibraryItems(
  userId: string,
  workTitle: string,
  items: {
    resourceTitle: string;
    relationship: "prerequisite" | "conceptual_influence" | "explicit_reference" | "historical_context" | "optional_extension";
    resourceType?: string;
    /** resource_role confidence — the Library's per-focus relevance evidence. */
    relationshipConfidence?: number;
    /** Creates the matching run-scoped credibility evidence when supplied. */
    credibilityScore?: number;
    /** `learning_resource.work_role` — defaults to "primary" like the schema. */
    workRole?: "primary" | "edition" | "translation" | "excerpt" | "review";
  }[],
  opts: { createdAt?: Date } = {},
): Promise<{ workId: string; resourceIds: string[] }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: workTitle, authorName: "Terence Irwin", ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) })
    .returning({ id: works.id });
  const [document] = await db.insert(documents).values({
    userId,
    workId: work.id,
    storagePath: `${userId}/${work.id}/none.txt`,
    originalFilename: "none.txt",
    mimeType: "text/plain",
    fileSize: 100,
    processingStatus: "ready",
    analysisStatus: "complete",
    extractedText: "Seeded text for curriculum tests.",
  }).returning({ id: documents.id });
  const [identity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:${suffix}`, canonicalTitle: workTitle, authorSurname: "irwin", authors: ["Terence Irwin"], evidence: "seeded for test" })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));

  const needsCredibility = items.some((item) => item.credibilityScore !== undefined);
  const [run] = needsCredibility
    ? await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v4", status: "complete" }).returning({ id: processingRuns.id })
    : [];

  const resourceIds: string[] = [];
  for (const [i, item] of items.entries()) {
    const [resource] = await db
      .insert(learningResources)
      .values({
      title: item.resourceTitle,
      normalizedKey: `title:${suffix}:${i}`,
        resourceType: item.resourceType ?? "book",
        provider: "openalex",
        authors: ["Aristotle"],
        year: -340,
        peerReviewed: null,
        ...(item.workRole ? { workRole: item.workRole } : {}),
      })
      .returning({ id: learningResources.id });
    await db.insert(resourceRoles).values({
      learningResourceId: resource.id,
      workIdentityId: identity.id,
      relationship: item.relationship,
      readerLevel: null,
      rationale: "Seeded rationale text for a Playwright fixture.",
      confidence: item.relationshipConfidence ?? 0.8,
      createdBy: "system",
    });
    if (run && item.credibilityScore !== undefined) {
      const [researchResource] = await db.insert(researchResources).values({
        runId: run.id,
        title: item.resourceTitle,
        normalizedKey: `title:${suffix}:${i}`,
        provider: "openalex",
        resourceType: item.resourceType ?? "book",
      }).returning({ id: researchResources.id });
      await db.insert(credibilityAssessments).values({ resourceId: researchResource.id, score: item.credibilityScore, authority: "B" });
    }
    resourceIds.push(resource.id);
  }

  return { workId: work.id, resourceIds };
}

/**
 * Seeds one owned work plus one `learning_resource` with every field the
 * Library search bar (plan §20.1) is required to match against — title,
 * authors, venue, year, DOI, ISBN, and resource type — all independently
 * settable so a test can search on exactly one field at a time. Kept as a
 * separate helper (append-only convention for this sub-phase) rather than
 * widening `seedWorkWithLibraryItem`'s existing signature.
 */
export async function seedSearchableLibraryItem(
  userId: string,
  opts: {
    workTitle?: string;
    resourceTitle: string;
    authors?: string[];
    venue?: string | null;
    year?: number | null;
    doi?: string | null;
    isbn?: string | null;
    resourceType?: string;
  },
): Promise<{ workId: string; resourceId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.workTitle ?? "Search Fixture Work", authorName: "Terence Irwin" })
    .returning({ id: works.id });
  const [identity] = await db
    .insert(workIdentities)
    .values({
      workKey: `work:test:${suffix}`,
      canonicalTitle: opts.workTitle ?? "Search Fixture Work",
      authorSurname: "irwin",
      authors: ["Terence Irwin"],
      evidence: "seeded for test",
    })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));

  const [resource] = await db
    .insert(learningResources)
    .values({
      title: opts.resourceTitle,
      normalizedKey: `title:${suffix}`,
      resourceType: opts.resourceType ?? "book",
      provider: "openalex",
      authors: opts.authors ?? ["Aristotle"],
      venue: opts.venue ?? null,
      year: opts.year ?? null,
      doi: opts.doi ?? null,
      isbn: opts.isbn ?? null,
      peerReviewed: null,
    })
    .returning({ id: learningResources.id });
  await db.insert(resourceRoles).values({
    learningResourceId: resource.id,
    workIdentityId: identity.id,
    relationship: "prerequisite",
    readerLevel: null,
    rationale: "Seeded rationale text for a Playwright search fixture.",
    confidence: 0.8,
    createdBy: "system",
  });

  return { workId: work.id, resourceId: resource.id };
}

/**
 * Phase 20.4: a Library entry (`learning_resource`) recommended for one of
 * the user's own uploads, with its OWN `work_identity` set — the identity
 * "Upload source text" should attach a newly-uploaded document to. Two
 * DISTINCT identities are seeded deliberately: `recommendingWork`'s own
 * identity (what `resource_role.work_identity_id` targets — "recommended
 * FOR this owned work") is not the same thing as the resource's own
 * canonical identity (what `learning_resource.work_identity_id` records —
 * "this resource, if uploaded, IS this canonical work"). Conflating the two
 * would make every recommended-for chip look like "the user already owns
 * this," which is exactly the bug this seeding shape exists to avoid.
 */
export async function seedLibraryItemForSourceAttach(
  userId: string,
  opts: {
    resourceTitle?: string;
    recommendingWorkTitle?: string;
    /** When true, also creates an owned work + document sharing the
     *  resource's own identity — simulating "the user already has the full
     *  text," so the attach affordance must not be offered. */
    alreadyOwned?: boolean;
  } = {},
): Promise<{ resourceId: string; recommendingWorkId: string; resourceWorkIdentityId: string; ownedWorkId: string | null }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const resourceTitle = opts.resourceTitle ?? "Nicomachean Ethics";

  const [recommendingWork] = await db
    .insert(works)
    .values({ userId, title: opts.recommendingWorkTitle ?? "Recommending Upload", authorName: "Test Author" })
    .returning({ id: works.id });
  const [recommendingIdentity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:recommending:${suffix}`, canonicalTitle: opts.recommendingWorkTitle ?? "Recommending Upload", evidence: "seeded for test" })
    .returning({ id: workIdentities.id });
  await db.update(works).set({ workIdentityId: recommendingIdentity.id }).where(eq(works.id, recommendingWork.id));

  const [resourceIdentity] = await db
    .insert(workIdentities)
    .values({ workKey: `work:test:resource:${suffix}`, canonicalTitle: resourceTitle, evidence: "seeded for test" })
    .returning({ id: workIdentities.id });

  const [resource] = await db
    .insert(learningResources)
    .values({
      workIdentityId: resourceIdentity.id,
      title: resourceTitle,
      normalizedKey: `title:resource:${suffix}`,
      resourceType: "book",
      provider: "openalex",
      authors: ["Aristotle"],
      year: -340,
      peerReviewed: null,
    })
    .returning({ id: learningResources.id });

  await db.insert(resourceRoles).values({
    learningResourceId: resource.id,
    workIdentityId: recommendingIdentity.id,
    relationship: "prerequisite",
    readerLevel: null,
    rationale: "Seeded rationale for a source-attach Playwright fixture.",
    confidence: 0.8,
    createdBy: "system",
  });

  let ownedWorkId: string | null = null;
  if (opts.alreadyOwned) {
    const [ownedWork] = await db
      .insert(works)
      .values({ userId, title: resourceTitle, workIdentityId: resourceIdentity.id })
      .returning({ id: works.id });
    await db.insert(documents).values({
      userId,
      workId: ownedWork.id,
      storagePath: `${userId}/${ownedWork.id}/already-owned.txt`,
      originalFilename: "already-owned.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      extractedText: "Already-owned full text for a source-attach eligibility fixture.",
    });
    ownedWorkId = ownedWork.id;
  }

  return { resourceId: resource.id, recommendingWorkId: recommendingWork.id, resourceWorkIdentityId: resourceIdentity.id, ownedWorkId };
}
