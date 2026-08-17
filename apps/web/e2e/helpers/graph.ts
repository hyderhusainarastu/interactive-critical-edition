import {
  bibliographicRecords,
  claimRelationships,
  concepts,
  conceptMastery,
  credibilityAssessments,
  db,
  debateClusterMembers,
  debateClusterRelationships,
  debateClusters,
  documents,
  editionRelations,
  graphEdges,
  learningResources,
  pages,
  processingRuns,
  readingRecords,
  researchClaims,
  researchProjects,
  researchResources,
  researchResourceContents,
  resourceProvenance,
  resourceRoles,
  textBlocks,
  workIdentities,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";

/**
 * Seeds a ready work + document plus two globally-shared concepts, each
 * linked to the work via a `work -[presupposes]-> concept` graph edge — the
 * shape Phase 9.4's diagnostic reads (`apps/web/src/app/api/works/[workId]/
 * diagnostic/route.ts`). Concepts use a random slug per test run so repeat
 * runs never collide on the catalog's unique slug constraint.
 *
 * Seeded directly rather than produced by the real v3 pipeline for the same
 * CI-safety reason as `seedPublishedEdition`: no worker, no live model call.
 */
export async function seedWorkWithConcepts(
  userId: string,
  opts: {
    existingMastery?: { conceptIndex: 0 | 1; score: number; source: "explicit" | "diagnostic" | "inferred" };
    /** Reuse an existing concept pair (e.g. from a prior call) instead of
     *  creating new ones — for testing two works that share a concept. */
    reuseConceptIds?: [string, string];
    title?: string;
    readingStatus?: "planned" | "reading" | "completed" | "abandoned";
  } = {},
): Promise<{ workId: string; documentId: string; conceptIds: [string, string] }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [work] = await db
    .insert(works)
    .values({ userId, title: opts.title ?? "Nicomachean Ethics", authorName: "Aristotle" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/concepts.txt`,
      originalFilename: "concepts.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Akrasia is weakness of will. Sophrosyne is temperance.",
    })
    .returning({ id: documents.id });

  let conceptIds: [string, string];
  if (opts.reuseConceptIds) {
    conceptIds = opts.reuseConceptIds;
  } else {
    const inserted = await db
      .insert(concepts)
      .values([
        { slug: `akrasia-${suffix}`, kind: "concept", label: "Akrasia", summary: "Weakness of will — acting against one's own better judgment." },
        { slug: `sophrosyne-${suffix}`, kind: "concept", label: "Sophrosyne", summary: "Temperance, as understood in the Peripatetic tradition." },
      ])
      .returning({ id: concepts.id });
    conceptIds = [inserted[0].id, inserted[1].id];
  }

  await db.insert(graphEdges).values([
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: conceptIds[0],
      edgeType: "presupposes", confidence: 0.9, evidence: { role: "central", reason: "Central to the work's argument." }, createdBy: "system",
    },
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: conceptIds[1],
      edgeType: "presupposes", confidence: 0.7, evidence: { role: "mentioned", reason: "Contrasted with akrasia." }, createdBy: "system",
    },
  ]);

  if (opts.existingMastery) {
    await db.insert(conceptMastery).values({
      userId,
      conceptId: conceptIds[opts.existingMastery.conceptIndex],
      score: opts.existingMastery.score,
      source: opts.existingMastery.source,
      evidence: "seeded for test",
    });
  }

  if (opts.readingStatus) {
    await db.insert(readingRecords).values({ userId, workId: work.id, status: opts.readingStatus });
  }

  return { workId: work.id, documentId: doc.id, conceptIds };
}

/**
 * Seeds ONE work carrying all four graph node types the Phase 9.7 knowledge
 * graph shows (plan §34.4): the work itself, a referenced bibliographic
 * record (`work -[cites]-> bibliographic_record`, the pre-9.7 shape),
 * a concept (`work -[presupposes]-> concept`, same shape `seedWorkWithConcepts`
 * uses), and — via a published run + page + header text_block — a section
 * outline node. All in one work so a single `/works/[workId]/graph` fetch
 * exercises every node type together. Seeded directly for the same
 * CI-safety reason as the other seed helpers: no worker, no live model call.
 */
export async function seedWorkWithGraphData(
  userId: string,
  options: {
    title?: string;
    withRelatedSource?: boolean;
    withPublicSources?: boolean;
    conceptId?: string;
    /** Adds a SECOND `graph_edge` of a different edge type between the same
     *  (work, bib) pair — the multi-edge-type shape D-21-1's relation-filter
     *  edge test needs (a `cites` and an `influences` edge can coexist for
     *  one pair because citation-resolution and classification write
     *  independently). */
    withSecondEdgeType?: boolean;
    /** Links the work to a `work_identity` and seeds a `learning_resource`
     *  (keyed to the same bib record) with a `resource_role` pointing at that
     *  identity — the exact eligibility shape `/library/[resourceId]`
     *  enforces, so the graph contract's `destination` field has a real,
     *  non-404 route to point at. */
    withLibraryResource?: boolean;
  } = {},
): Promise<{ workId: string; documentId: string; bibId: string; resourceId: string; relatedResourceId?: string; publicResourceIds: string[]; conceptId: string; sectionBlockId: string; libraryResourceId?: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const workTitle = options.title ?? "On the Soul";
  const [work] = await db
    .insert(works)
    .values({ userId, title: workTitle, authorName: "Aristotle" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/graph.txt`,
      originalFilename: "graph.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "The soul is the form of a natural body having life potentially.",
    })
    .returning({ id: documents.id });

  const [run] = await db
    .insert(processingRuns)
    .values({
      documentId: doc.id,
      version: 1,
      pipelineVersion: "v2",
      status: "complete",
      stage: "publish",
      structureState: "full",
      isPublished: true,
      aiCostUsd: 0.01,
      degraded: false,
    })
    .returning({ id: processingRuns.id });
  const [page] = await db
    .insert(pages)
    .values({ runId: run.id, pageIndex: 0, isOcr: false, text: "The soul is the form of a natural body." })
    .returning({ id: pages.id });
  const [sectionBlock] = await db
    .insert(textBlocks)
    .values({ pageId: page.id, blockOrder: 0, kind: "header", text: "Book II: The Nature of the Soul" })
    .returning({ id: textBlocks.id });

  const [bib] = await db
    .insert(bibliographicRecords)
    .values({ source: "crossref", title: "Physics", authors: "Aristotle", year: -350, accessStatus: "metadata_only" })
    .returning({ id: bibliographicRecords.id });
  const [resource] = await db
    .insert(researchResources)
    .values({
      runId: run.id,
      title: "Physics",
      provider: "crossref",
      resourceType: "book",
      year: -350,
      authors: ["Aristotle"],
      bibRecordId: bib.id,
      normalizedKey: `seeded-physics-${suffix}`,
      workKey: `work:physics:aristotle:${suffix}`,
      workCanonicalTitle: "Physics",
      workAuthorSurname: "aristotle",
      workEvidence: "seeded graph test",
    })
    .returning({ id: researchResources.id });
  await db.insert(credibilityAssessments).values({
    resourceId: resource.id,
    score: 0.82,
    authority: "A",
    relevance: 0.9,
    inspectionDepth: 1,
    evidenceStrength: 0.8,
    agreement: "strong",
    rationale: "seeded graph test",
  });
  await db.insert(resourceProvenance).values({
    resourceId: resource.id,
    provider: "crossref",
    query: "On the Soul Physics",
    inspectionDepth: 1,
    inspectedAt: new Date("2026-07-21T12:00:00.000Z"),
  });
  await db.insert(researchResourceContents).values({
    resourceId: resource.id,
    status: "open_access_indexed",
    sourceUrl: "https://example.test/open-physics",
    license: "CC BY 4.0",
    licenseEvidence: { providerLicense: "CC BY 4.0", seeded: true },
    text: "An openly licensed source excerpt for graph provenance testing.",
    contentHash: `seeded-hash-${suffix}`,
    retrievedAt: new Date("2026-07-21T12:00:01.000Z"),
  });
  await db.insert(editionRelations).values({
    runId: run.id,
    resourceId: resource.id,
    relationType: "explicit_reference",
    depth: 1,
    importance: 0.82,
    evidence: { category: "explicit_reference", sourceText: "Physics is cited in the source work." },
    confidence: 0.85,
  });
  let relatedResourceId: string | undefined;
  if (options.withRelatedSource) {
    const [review] = await db.insert(researchResources).values({
      runId: run.id,
      title: "Physics: a peer review",
      url: "https://example.test/physics-review",
      provider: "openalex",
      resourceType: "article",
      accessStatus: "metadata_only",
      year: -349,
      authors: ["Theophrastus"],
      normalizedKey: `seeded-physics-review-${suffix}`,
      workKey: `work:physics:aristotle:${suffix}`,
      workRole: "review",
      workCanonicalTitle: "Physics",
      workAuthorSurname: "aristotle",
      workEvidence: "seeded review grouping",
    }).returning({ id: researchResources.id });
    relatedResourceId = review.id;
    await db.insert(credibilityAssessments).values({ resourceId: review.id, score: 0.71, authority: "B", peerReviewed: true });
    await db.insert(resourceProvenance).values({ resourceId: review.id, provider: "openalex", query: "Physics review", inspectionDepth: 1, inspectedAt: new Date("2026-07-21T12:01:00.000Z") });
    await db.insert(editionRelations).values({
      runId: run.id,
      resourceId: review.id,
      relatedResourceId: resource.id,
      relationType: "review_of",
      depth: 1,
      importance: 0.71,
      evidence: { provenance: "seeded shared work identity" },
      confidence: 1,
    });
  }
  const publicResourceIds: string[] = [];
  if (options.withPublicSources) {
    for (const [provider, title, resourceType, authority] of [
      ["youtube", "A relevant lecture on Aristotle", "video", "D"],
      ["mastodon", "A relevant Mastodon discussion", "social_post", "E"],
      ["bluesky", "A relevant Bluesky discussion", "social_post", "E"],
    ] as const) {
      const [publicSource] = await db.insert(researchResources).values({
        runId: run.id,
        title,
        url: `https://example.test/${provider}/${suffix}`,
        provider,
        resourceType,
        accessStatus: "metadata_only",
        normalizedKey: `seeded-${provider}-${suffix}`,
      }).returning({ id: researchResources.id });
      publicResourceIds.push(publicSource.id);
      await db.insert(credibilityAssessments).values({ resourceId: publicSource.id, score: authority === "D" ? 0.25 : 0.1, authority, peerReviewed: false });
      await db.insert(resourceProvenance).values({ resourceId: publicSource.id, provider, query: "On the Soul relevant discussion", inspectionDepth: 0, inspectedAt: new Date("2026-07-21T12:02:00.000Z") });
      await db.insert(editionRelations).values({ runId: run.id, resourceId: publicSource.id, relationType: "supplementary_context", depth: 0, importance: 0.2, evidence: { provider, supplementary: true }, confidence: 0.5 });
    }
  }
  const concept = options.conceptId
    ? { id: options.conceptId }
    : (await db
        .insert(concepts)
        .values({ slug: `hylomorphism-${suffix}`, kind: "doctrine", label: "Hylomorphism", summary: "Matter and form as co-constituents of a substance." })
        .returning({ id: concepts.id }))[0]!;

  await db.insert(graphEdges).values([
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "bibliographic_record", targetId: bib.id,
      edgeType: "cites", confidence: 0.85, evidence: { category: "explicit_reference" }, createdBy: "system",
    },
    {
      userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: concept.id,
      edgeType: "presupposes", confidence: 0.8, evidence: { role: "central", reason: "Core doctrine of the work." }, createdBy: "system",
    },
    ...(options.withSecondEdgeType
      ? [{
          userId, sourceType: "work" as const, sourceId: work.id, targetType: "bibliographic_record" as const, targetId: bib.id,
          edgeType: "influences" as const, confidence: 0.7, evidence: { category: "conceptual_influence" }, createdBy: "system" as const,
        }]
      : []),
  ]);

  let libraryResourceId: string | undefined;
  if (options.withLibraryResource) {
    const [identity] = await db
      .insert(workIdentities)
      .values({ workKey: `work:graph-test:${suffix}`, canonicalTitle: workTitle, authorSurname: "aristotle", authors: ["Aristotle"], evidence: "seeded graph contract test" })
      .returning({ id: workIdentities.id });
    await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));
    const [libraryResource] = await db
      .insert(learningResources)
      .values({
        title: "Physics",
        normalizedKey: `seeded-lr-${suffix}`,
        resourceType: "book",
        provider: "crossref",
        authors: ["Aristotle"],
        year: -350,
        bibRecordId: bib.id,
      })
      .returning({ id: learningResources.id });
    libraryResourceId = libraryResource.id;
    await db.insert(resourceRoles).values({
      learningResourceId: libraryResource.id,
      workIdentityId: identity.id,
      relationship: "explicit_reference",
      readerLevel: null,
      rationale: "Cited directly by the source work.",
      confidence: 0.85,
      createdBy: "system",
    });
  }

  return { workId: work.id, documentId: doc.id, bibId: bib.id, resourceId: resource.id, relatedResourceId, publicResourceIds, conceptId: concept.id, sectionBlockId: sectionBlock.id, libraryResourceId };
}

/**
 * Bare `work` + `document` pair (no analysis apparatus) — the minimal
 * ownership-chain shape `getOwnedDocument()` (the `/api/works/:id/graph`
 * gate) requires, shared by the Stage 3 TEST-lane fixture helpers below.
 * Mirrors `graph-scene.spec.ts`'s own local `seedMinimalWork`, hoisted here
 * since several new fixtures need it.
 */
async function insertBareWork(userId: string, title: string): Promise<string> {
  const [work] = await db.insert(works).values({ userId, title, authorName: "Test Author" }).returning({ id: works.id });
  await db.insert(documents).values({
    userId,
    workId: work.id,
    storagePath: `${userId}/${work.id}/fixture.txt`,
    originalFilename: "fixture.txt",
    mimeType: "text/plain",
    fileSize: 42,
    processingStatus: "ready",
    analysisStatus: "complete",
    extractedText: `${title} — fixture text.`,
  });
  return work.id;
}

/**
 * Charter §16 / spec §7.1 boundary-count and dense-hub/long-label fixtures
 * — a work connected to exactly `count` distinct `concept` nodes via a
 * `presupposes` `graph_edge` each. Deliberately the CHEAPEST real shape
 * that produces an exact, predictable total node count (`count` + 1 for
 * the root work itself): no research_resource/credibility scaffolding,
 * since the boundary-count tests (11/12/13, 23/24/25, 59/60/61, 119/120/121
 * — `disclosure.ts`'s `INITIAL_NEIGHBOR_CAP`/`VISIBLE_CAP`) only need a
 * real, owner-scoped topology of the right SIZE, not varied node kinds.
 *
 * `longLabelAt` (0-based index into the generated concepts) seeds one
 * concept with a deliberately long, multi-word label — the same "long
 * labels" fixture spec §7.1 calls for, folded into this generator rather
 * than a separate DB round trip, since both are cheap to produce in the
 * same loop.
 */
export async function seedWorkWithManyConceptNodes(
  userId: string,
  options: { title?: string; count: number; longLabelAt?: number },
): Promise<{ workId: string; documentId: string; conceptIds: string[] }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = options.title ?? `Boundary-count work ${options.count} ${suffix}`;
  const workId = await insertBareWork(userId, title);
  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, workId)).limit(1);

  const conceptIds: string[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const label =
      options.longLabelAt === i
        ? `An unusually long concept label meant to exercise the label layer's two-line maximum and truncation rules, item ${i} of ${suffix}`
        : `Boundary concept ${i} ${suffix}`;
    const [concept] = await db
      .insert(concepts)
      .values({ slug: `boundary-${suffix}-${i}`, kind: "concept", label, summary: `Fixture concept ${i}.` })
      .returning({ id: concepts.id });
    conceptIds.push(concept.id);
  }

  await db.insert(graphEdges).values(
    conceptIds.map((conceptId) => ({
      userId,
      sourceType: "work" as const,
      sourceId: workId,
      targetType: "concept" as const,
      targetId: conceptId,
      edgeType: "presupposes" as const,
      confidence: 0.7,
      evidence: { role: "fixture", reason: "seeded boundary-count fixture" },
      createdBy: "system" as const,
    })),
  );

  return { workId, documentId: doc.id, conceptIds };
}

/**
 * Dense-hub fixture (spec §7.1 "Dense hub: 1 node, many links") — the root
 * work node cites `hubDegree` distinct bibliographic records, so the work
 * node itself carries `hubDegree` real edges. Exercises `sizing.ts`'s
 * `computeNodeScale` clamp (charter: "no hub may exceed the sizing
 * formula's own clamp") against a REAL degree, not a synthetic one.
 */
export async function seedWorkWithDenseHub(userId: string, options: { title?: string; hubDegree: number }): Promise<{ workId: string; documentId: string; bibIds: string[] }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = options.title ?? `Dense-hub work ${suffix}`;
  const workId = await insertBareWork(userId, title);
  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, workId)).limit(1);

  const bibIds: string[] = [];
  for (let i = 0; i < options.hubDegree; i += 1) {
    const [bib] = await db
      .insert(bibliographicRecords)
      .values({ source: "crossref", title: `Hub citation ${i} ${suffix}`, authors: "Fixture Author", year: 1900 + i, accessStatus: "metadata_only" })
      .returning({ id: bibliographicRecords.id });
    bibIds.push(bib.id);
  }

  await db.insert(graphEdges).values(
    bibIds.map((bibId) => ({
      userId,
      sourceType: "work" as const,
      sourceId: workId,
      targetType: "bibliographic_record" as const,
      targetId: bibId,
      edgeType: "cites" as const,
      confidence: 0.8,
      evidence: { category: "explicit_reference" },
      createdBy: "system" as const,
    })),
  );

  return { workId, documentId: doc.id, bibIds };
}

/**
 * "Realistic held/missing mix" (spec §7.1) — a work citing several
 * bibliographic records in three real states: `read` (a `reading_record`
 * with `status: "completed"`), `reading` (`status: "reading"`), and
 * `missing` (no `reading_record`/`understanding_rating` at all — the
 * default a cited-but-unowned record gets, per `buildGraph()`'s own state
 * derivation read above this helper's own module). Exercises `theme.ts`'s
 * per-`NodeState` visual mapping against real DB-derived states rather
 * than a hand-constructed `DisplayNode`.
 */
export async function seedWorkWithMixedStateNodes(
  userId: string,
  options: { title?: string; readCount: number; readingCount: number; missingCount: number },
): Promise<{ workId: string; documentId: string; readBibIds: string[]; readingBibIds: string[]; missingBibIds: string[] }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = options.title ?? `Mixed-state work ${suffix}`;
  const workId = await insertBareWork(userId, title);
  const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, workId)).limit(1);

  async function seedBibGroup(count: number, label: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const [bib] = await db
        .insert(bibliographicRecords)
        .values({ source: "crossref", title: `${label} citation ${i} ${suffix}`, authors: "Fixture Author", year: 1950 + i, accessStatus: "metadata_only" })
        .returning({ id: bibliographicRecords.id });
      ids.push(bib.id);
    }
    return ids;
  }

  const readBibIds = await seedBibGroup(options.readCount, "Read");
  const readingBibIds = await seedBibGroup(options.readingCount, "Reading");
  const missingBibIds = await seedBibGroup(options.missingCount, "Missing");
  const allBibIds = [...readBibIds, ...readingBibIds, ...missingBibIds];

  await db.insert(graphEdges).values(
    allBibIds.map((bibId) => ({
      userId,
      sourceType: "work" as const,
      sourceId: workId,
      targetType: "bibliographic_record" as const,
      targetId: bibId,
      edgeType: "cites" as const,
      confidence: 0.75,
      evidence: { category: "explicit_reference" },
      createdBy: "system" as const,
    })),
  );

  if (readBibIds.length > 0) {
    await db.insert(readingRecords).values(readBibIds.map((bibId) => ({ userId, bibId, status: "completed" as const })));
  }
  if (readingBibIds.length > 0) {
    await db.insert(readingRecords).values(readingBibIds.map((bibId) => ({ userId, bibId, status: "reading" as const })));
  }
  // missingBibIds intentionally get no reading_record/understanding_rating.

  return { workId, documentId: doc.id, readBibIds, readingBibIds, missingBibIds };
}

/**
 * Seeds a minimal, real debate cluster (Phase 28.4: the knowledge-graph
 * debate layer) — `research_claim` → `claim_relationship` → `debate_cluster`/
 * `debate_cluster_member`/`debate_cluster_relationship`, the exact tables
 * `buildGraph()`'s `graphDebateLayer` addition and the `GET
 * /api/graph/debate/[clusterId]/expand` route read. Two claims (from `workId`,
 * or from `workId` and `options.secondWorkId` when both endpoints of the
 * debate should attach to DIFFERENT owned works — the multi-work "linked to
 * participating WORKS" shape) are judged as contradicting each other and
 * clustered — the smallest real shape `findClaimClusters` ever emits
 * (components need ≥2 members, plan §Pipeline). `buildGraph()` is a pure DB
 * read (no worker/live-API dependency), so this stays CI-safe the same way
 * `seedWorkWithGraphData` above already is.
 *
 * Claims are seeded `anchorState: "unanchored"` with a null `text_block_id`
 * — a real, DB-CHECK-satisfying combination
 * (`research_claim_grounded`/`research_claim_unanchored_no_block`) chosen
 * deliberately over building out page/text_block infrastructure this
 * feature doesn't read at all.
 */
export async function seedDebateCluster(
  userId: string,
  workId: string,
  options: { secondWorkId?: string; hidden?: boolean; status?: "active" | "stale" } = {},
): Promise<{
  projectId: string;
  clusterId: string;
  claimAId: string;
  claimBId: string;
  claimLoId: string;
  claimHiId: string;
  relationshipId: string;
}> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [project] = await db
    .insert(researchProjects)
    .values({ userId, title: `Debate test project ${suffix}` })
    .returning({ id: researchProjects.id });

  async function insertClaim(text: string, targetWorkId: string): Promise<string> {
    const [claim] = await db
      .insert(researchClaims)
      .values({
        userId,
        workId: targetWorkId,
        anchorState: "unanchored",
        claimText: text,
        claimNature: "interpretive",
        confidence: "high",
        section: "Body",
        sourceScope: "full_text",
        supportingExcerpt: text,
        excerptVerified: false,
        contentHash: `seeded-claim-${crypto.randomUUID()}`,
        promptVersion: "seed-v1",
      })
      .returning({ id: researchClaims.id });
    return claim.id;
  }

  const claimAId = await insertClaim("The soul is inseparable from the body it is the form of.", workId);
  const claimBId = await insertClaim("The soul can exist independently of any body.", options.secondWorkId ?? workId);
  const [claimLoId, claimHiId] = [claimAId, claimBId].sort();

  const [relationship] = await db
    .insert(claimRelationships)
    .values({
      userId,
      projectId: project.id,
      claimLoId,
      claimHiId,
      valence: "contradiction",
      category: "theoretical",
      judgeBranch: "humanities",
      explanation: "One claim asserts strict hylomorphic unity of soul and body; the other asserts separability — a direct contradiction.",
      resolution: "Resolve by clarifying which faculty of soul each claim is actually about.",
      engagement: "none_detected",
      basisHash: `seeded-basis-${suffix}`,
      promptVersion: "seed-v1",
      provider: "seed",
      model: "seed",
    })
    .returning({ id: claimRelationships.id });

  const [cluster] = await db
    .insert(debateClusters)
    .values({
      userId,
      projectId: project.id,
      name: "Is the soul separable from the body?",
      researchQuestion: "Can the soul exist independently of the body it forms?",
      memberHash: `seeded-member-hash-${suffix}`,
      edgeCount: 1,
      counts: { contradiction: 1, support: 0, nuance: 0 },
      status: options.status ?? "active",
      hidden: options.hidden ?? false,
      promptVersion: "seed-v1",
      provider: "seed",
      model: "seed",
    })
    .returning({ id: debateClusters.id });

  await db.insert(debateClusterMembers).values([
    { clusterId: cluster.id, claimId: claimAId },
    { clusterId: cluster.id, claimId: claimBId },
  ]);
  await db.insert(debateClusterRelationships).values({ clusterId: cluster.id, claimRelationshipId: relationship.id });

  return { projectId: project.id, clusterId: cluster.id, claimAId, claimBId, claimLoId, claimHiId, relationshipId: relationship.id };
}
