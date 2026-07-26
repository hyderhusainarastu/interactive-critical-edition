import type { EmbeddingBatchResult, EmbeddingProvider } from "@ice/ai-adapters";
import {
  bibliographicRecords,
  citations,
  claimLoci,
  claimPairCandidates,
  db,
  documents,
  researchClaimEmbeddings,
  researchClaims,
  researchJobRequests,
  researchProjectMembers,
  researchProjects,
  users,
  works,
} from "@ice/db";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { computeBm25CandidatePairs, deriveSectionKey, detectRelationshipsForProject } from "./detectRelationships";
import { runResearchJob } from "./jobRunner";

/**
 * Integration tests for the detect_relationships DETERMINISTIC pipeline
 * (Phase 26.2a: three-channel Stage-1 retrieval + citation engagement, both
 * $0). Skipped when DATABASE_URL is unset, matching every other
 * `*.integration.test.ts` file's convention. No LLM/embedding provider call
 * is ever made by this pipeline (it only reads pre-seeded
 * `research_claim_embedding` rows) — every test here costs exactly $0.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// A deterministic mock embedder — never calls a real provider. `model`
// matches `RETRIEVAL_THRESHOLDS.calibratedFor`'s default
// ("text-embedding-3-small") so `assertThresholdsCalibratedFor` passes
// without needing to set RESEARCH_EMBEDDING_MODEL in the test env.
// ---------------------------------------------------------------------------

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";
  readonly model = "text-embedding-3-small";
  readonly dim = 1536;
  readonly available = true;
  async embedBatch(): Promise<EmbeddingBatchResult> {
    throw new Error("detectRelationships must never call embedBatch — it only reads pre-existing embedding rows");
  }
  estimateCostUsd(): number {
    return 0;
  }
}

class UnavailableEmbeddingProvider implements EmbeddingProvider {
  readonly id = "none";
  readonly model = "none";
  readonly dim = 0;
  readonly available = false;
  async embedBatch(): Promise<EmbeddingBatchResult> {
    throw new Error("unavailable");
  }
  estimateCostUsd(): number {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedUser() {
  const [user] = await db.insert(users).values({ email: `dr-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  return user.id;
}

async function seedWork(userId: string, title: string) {
  const [work] = await db.insert(works).values({ userId, title, authorName: "Test Author" }).returning({ id: works.id });
  return work.id;
}

async function seedDocumentForWork(userId: string, workId: string) {
  const [document] = await db
    .insert(documents)
    .values({
      workId,
      userId,
      fileSize: 1,
      storagePath: `dr/${crypto.randomUUID()}.txt`,
      originalFilename: "t.txt",
      mimeType: "text/plain",
    })
    .returning({ id: documents.id });
  return document.id;
}

/** A minimal, unanchored claim — satisfies `research_claim_grounded` via the
 *  `anchor_state = 'unanchored'` branch, so no page/text_block chain is
 *  needed for tests that only exercise relationship DETECTION, not
 *  extraction/anchoring. */
async function seedClaim(userId: string, workId: string, claimText: string, claimNature = "interpretive") {
  const [claim] = await db
    .insert(researchClaims)
    .values({
      userId,
      workId,
      anchorState: "unanchored",
      claimText,
      claimNature: claimNature as (typeof researchClaims.$inferInsert)["claimNature"],
      confidence: "medium",
      section: "Body",
      sourceScope: "full_text",
      supportingExcerpt: claimText.slice(0, Math.min(20, claimText.length)) || "x",
      excerptVerified: false,
      contentHash: crypto.randomUUID(),
      promptVersion: "test-v1",
    })
    .returning();
  return claim;
}

async function seedProject(userId: string, workIds: string[]) {
  const [project] = await db.insert(researchProjects).values({ userId, title: "Test Research Project" }).returning({ id: researchProjects.id });
  for (const workId of workIds) {
    await db.insert(researchProjectMembers).values({ projectId: project.id, memberType: "work", workId, role: "central" });
  }
  return project.id;
}

async function seedJobRequest(userId: string, projectId: string) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({ userId, jobType: "detect_relationships", scope: { projectId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

async function seedLocus(claimId: string, locusKey: string, origin: "excerpt" | "block" | "footnote" | "citation" = "block") {
  await db.insert(claimLoci).values({ claimId, locusKey, origin, rawLocus: locusKey });
}

async function seedEmbedding(claimId: string, model: string, vector: number[]) {
  await db.insert(researchClaimEmbeddings).values({ claimId, model, inputHash: crypto.randomUUID(), embedding: vector, dim: vector.length });
}

/** `research_claim_embedding.embedding` is a FIXED `vector(1536)` column —
 *  Postgres rejects any other length outright. `oneHotIndex` picks which of
 *  the 1536 dimensions is set to 1 (all others 0), so two claims can be
 *  given either identical (same index → cosine similarity 1.0) or
 *  orthogonal (different index → cosine similarity 0.0) unit vectors. */
function oneHotVector(oneHotIndex: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => (i === oneHotIndex ? 1 : 0));
}

/** A RESOLVED citation from `citingWorkId`'s document to a bibliographic
 *  record whose title matches `citedTitle` — the deterministic engagement
 *  join's whole input. */
async function seedResolvedCitation(userId: string, citingWorkId: string, citedTitle: string) {
  const documentId = await seedDocumentForWork(userId, citingWorkId);
  const [bibRecord] = await db
    .insert(bibliographicRecords)
    .values({ source: "test", title: citedTitle })
    .returning({ id: bibliographicRecords.id });
  await db.insert(citations).values({
    documentId,
    rawText: citedTitle,
    normalizedQuery: citedTitle,
    sourceType: "footnote",
    resolvedBibId: bibRecord.id,
    resolutionSource: "test",
    resolutionState: "resolved",
  });
  return bibRecord.id;
}

async function runDetect(requestId: string, projectId: string, embedder: EmbeddingProvider = new MockEmbeddingProvider()) {
  let outcome!: Awaited<ReturnType<typeof detectRelationshipsForProject>>;
  await runResearchJob(requestId, async (ctx) => {
    outcome = await detectRelationshipsForProject(ctx, projectId, embedder);
    return outcome;
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("detect_relationships (integration)", () => {
  const cleanupUsers: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("locus-only pair: two claims with disjoint vocabulary but a shared locus key are still found (invisible to dense/bm25)", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "The quokka enjoys basking on warm rocks in the afternoon sun.");
    const claimB = await seedClaim(userId, workB, "Photosynthesis converts light energy into chemical bonds in chloroplasts.");
    // Zero shared vocabulary, zero embeddings — ONLY the locus channel(s) can
    // find this pair. An exact locus match also always implies a matching
    // section (the section key is derived FROM the locus key), so both the
    // `locus` and `locus_section` channels co-fire here — that is expected,
    // not a bug: the coarser section channel is a strict superset condition
    // of the exact-locus one.
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");

    const projectId = await seedProject(userId, [workA, workB]);
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider());

    expect(outcome.channelCounts).toMatchObject({ dense: 0, bm25: 0, locus: 1, locusSection: 1 });
    expect(outcome.candidatesPersisted).toBe(1);

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const [row] = await db
      .select()
      .from(claimPairCandidates)
      .where(and(eq(claimPairCandidates.claimLoId, loId), eq(claimPairCandidates.claimHiId, hiId)));
    expect(row).toBeDefined();
    expect(row.retrievalSources).toEqual([
      { channel: "locus", score: 1 },
      { channel: "locus_section", score: 0.7 },
    ]);
    expect(row.bestRetrievalScore).toBe(1);

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");
    expect(request.coverage).toBe("partial"); // judge stage not yet implemented
  });

  it("cross-work-only: two claims in the SAME work sharing a locus key are never candidated", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Solo Work");
    const claim1 = await seedClaim(userId, workA, "First claim about the same passage.");
    const claim2 = await seedClaim(userId, workA, "Second claim, also about that passage.");
    await seedLocus(claim1.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claim2.id, "aristotle:nicomachean-ethics:1151a");

    const projectId = await seedProject(userId, [workA]);
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider());

    expect(outcome.claimsInScope).toBe(2);
    expect(outcome.candidatesFound).toBe(0);
    expect(outcome.candidatesPersisted).toBe(0);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.coverage).toBe("full"); // nothing found — honestly complete
  });

  it("embeddingless claim is still reachable via bm25 when the other retrieval channels miss it", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const workC = await seedWork(userId, "Decoy Work"); // widens the BM25 corpus so A/B's shared terms don't just self-dominate a 2-doc index
    const claimA = await seedClaim(userId, workA, "the incontinent agent acts against better judgment");
    const claimB = await seedClaim(userId, workB, "an incontinent agent knowingly acts against their own better judgment");
    await seedClaim(userId, workC, "photosynthesis in green plants requires chlorophyll");
    // No embedding rows for either claim, no shared locus — only BM25 can find this pair.

    const projectId = await seedProject(userId, [workA, workB, workC]);
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new MockEmbeddingProvider());

    expect(outcome.channelCounts.dense).toBe(0); // neither claim has an embedding row
    expect(outcome.channelCounts.bm25).toBeGreaterThan(0);
    expect(outcome.candidatesPersisted).toBeGreaterThanOrEqual(1);

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const [row] = await db
      .select()
      .from(claimPairCandidates)
      .where(and(eq(claimPairCandidates.claimLoId, loId), eq(claimPairCandidates.claimHiId, hiId)));
    expect(row).toBeDefined();
    const sources = row.retrievalSources as { channel: string; score: number }[];
    expect(sources.some((s) => s.channel === "bm25")).toBe(true);
  });

  it("dense channel: two embedded claims above denseMin are found even with disjoint vocabulary and no locus", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Zzyzx flibbertigibbet wombat quokka.");
    const claimB = await seedClaim(userId, workB, "Zzyzx flibbertigibbet wombat quokka, restated.");
    const model = "text-embedding-3-small";
    // Identical one-hot vectors — cosine similarity 1.0, well above denseMin.
    await seedEmbedding(claimA.id, model, oneHotVector(0));
    await seedEmbedding(claimB.id, model, oneHotVector(0));

    const projectId = await seedProject(userId, [workA, workB]);
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new MockEmbeddingProvider());

    expect(outcome.channelCounts.dense).toBe(1);
    expect(outcome.candidatesPersisted).toBe(1);
  });

  it("dense channel is honestly skipped (not silently zero) when the embedding provider is unavailable", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    await seedClaim(userId, workA, "A claim with no locus and no bm25 overlap whatsoever alpha.");
    await seedClaim(userId, workB, "A completely different claim beta gamma delta epsilon.");

    const projectId = await seedProject(userId, [workA, workB]);
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider());

    expect(outcome.concerns.some((c) => c.includes("No embedding provider configured"))).toBe(true);
    expect(outcome.channelCounts.dense).toBe(0);
  });

  it("idempotent re-run: a second run over an unchanged claim set persists zero new candidates", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Repeated-run claim about the same locus.");
    const claimB = await seedClaim(userId, workB, "Another work discussing that exact same locus.");
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");

    const projectId = await seedProject(userId, [workA, workB]);

    const firstRequestId = await seedJobRequest(userId, projectId);
    const first = await runDetect(firstRequestId, projectId, new UnavailableEmbeddingProvider());
    expect(first.candidatesPersisted).toBe(1);

    const secondRequestId = await seedJobRequest(userId, projectId);
    const second = await runDetect(secondRequestId, projectId, new UnavailableEmbeddingProvider());
    expect(second.candidatesFound).toBe(1); // Stage-1 retrieval still finds it...
    expect(second.candidatesPersisted).toBe(0); // ...but it's a dedup hit, not a new row

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const rows = await db
      .select()
      .from(claimPairCandidates)
      .where(and(eq(claimPairCandidates.claimLoId, loId), eq(claimPairCandidates.claimHiId, hiId)));
    expect(rows).toHaveLength(1); // exactly one row total, not two
  });

  it("citation engagement: direct_citation when one work's resolved citation matches the other work's title", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "On Vice and Reason");
    const workB = await seedWork(userId, "Reason and Its Limits");
    const claimA = await seedClaim(userId, workA, "Claim A anchored to the shared locus.");
    const claimB = await seedClaim(userId, workB, "Claim B anchored to the very same shared locus.");
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");
    // Work A cites a bibliographic record whose title matches Work B's own title.
    await seedResolvedCitation(userId, workA, "Reason and Its Limits");

    const projectId = await seedProject(userId, [workA, workB]);
    const requestId = await seedJobRequest(userId, projectId);
    await runDetect(requestId, projectId, new UnavailableEmbeddingProvider());

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const [row] = await db
      .select()
      .from(claimPairCandidates)
      .where(and(eq(claimPairCandidates.claimLoId, loId), eq(claimPairCandidates.claimHiId, hiId)));
    expect(row.engagement).toBe("direct_citation");
    expect(row.engagementEvidence).toMatchObject({ citingWorkId: workA, citedWorkId: workB });
  });

  it("citation engagement: reciprocal_citation when both works cite each other", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Alpha Work");
    const workB = await seedWork(userId, "Beta Work");
    const claimA = await seedClaim(userId, workA, "Claim from Alpha at the shared locus.");
    const claimB = await seedClaim(userId, workB, "Claim from Beta at the shared locus.");
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");
    await seedResolvedCitation(userId, workA, "Beta Work");
    await seedResolvedCitation(userId, workB, "Alpha Work");

    const projectId = await seedProject(userId, [workA, workB]);
    const requestId = await seedJobRequest(userId, projectId);
    await runDetect(requestId, projectId, new UnavailableEmbeddingProvider());

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const [row] = await db
      .select()
      .from(claimPairCandidates)
      .where(and(eq(claimPairCandidates.claimLoId, loId), eq(claimPairCandidates.claimHiId, hiId)));
    expect(row.engagement).toBe("reciprocal_citation");
  });

  it("citation engagement: shared_citation when neither work cites the other but both cite a common third record", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Gamma Work");
    const workB = await seedWork(userId, "Delta Work");
    const claimA = await seedClaim(userId, workA, "Claim from Gamma at the shared locus.");
    const claimB = await seedClaim(userId, workB, "Claim from Delta at the shared locus.");
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");

    const documentA = await seedDocumentForWork(userId, workA);
    const documentB = await seedDocumentForWork(userId, workB);
    const [thirdBib] = await db.insert(bibliographicRecords).values({ source: "test", title: "A Common Third Source" }).returning({ id: bibliographicRecords.id });
    await db.insert(citations).values({
      documentId: documentA,
      rawText: "A Common Third Source",
      normalizedQuery: "A Common Third Source",
      sourceType: "footnote",
      resolvedBibId: thirdBib.id,
      resolutionSource: "test",
      resolutionState: "resolved",
    });
    await db.insert(citations).values({
      documentId: documentB,
      rawText: "A Common Third Source",
      normalizedQuery: "A Common Third Source",
      sourceType: "footnote",
      resolvedBibId: thirdBib.id,
      resolutionSource: "test",
      resolutionState: "resolved",
    });

    const projectId = await seedProject(userId, [workA, workB]);
    const requestId = await seedJobRequest(userId, projectId);
    await runDetect(requestId, projectId, new UnavailableEmbeddingProvider());

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const [row] = await db
      .select()
      .from(claimPairCandidates)
      .where(and(eq(claimPairCandidates.claimLoId, loId), eq(claimPairCandidates.claimHiId, hiId)));
    expect(row.engagement).toBe("shared_citation");
    expect(row.engagementEvidence).toMatchObject({ sharedBibliographicRecordIds: [thirdBib.id] });
  });

  it("citation engagement: none_detected when a candidate pair has no citation link at all", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Epsilon Work");
    const workB = await seedWork(userId, "Zeta Work");
    const claimA = await seedClaim(userId, workA, "Claim from Epsilon at the shared locus.");
    const claimB = await seedClaim(userId, workB, "Claim from Zeta at the shared locus.");
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");

    const projectId = await seedProject(userId, [workA, workB]);
    const requestId = await seedJobRequest(userId, projectId);
    await runDetect(requestId, projectId, new UnavailableEmbeddingProvider());

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const [row] = await db
      .select()
      .from(claimPairCandidates)
      .where(and(eq(claimPairCandidates.claimLoId, loId), eq(claimPairCandidates.claimHiId, hiId)));
    expect(row.engagement).toBe("none_detected");
    expect(row.engagementEvidence).toBeNull();
  });

  it("fewer than two claims in scope: honestly full coverage, nothing persisted", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Lone Work");
    await seedClaim(userId, workA, "The only claim in this project.");

    const projectId = await seedProject(userId, [workA]);
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId);

    expect(outcome.candidatesPersisted).toBe(0);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.coverage).toBe("full");
  });

  it("rejects a project the requesting user does not own", async () => {
    const ownerId = await seedUser();
    const otherId = await seedUser();
    cleanupUsers.push(ownerId, otherId);
    const workId = await seedWork(ownerId, "Owner's Work");
    await seedClaim(ownerId, workId, "A claim only the owner should see.");
    const projectId = await seedProject(ownerId, [workId]);

    // The OTHER user's own request, pointed at the owner's project id.
    const [request] = await db
      .insert(researchJobRequests)
      .values({ userId: otherId, jobType: "detect_relationships", scope: { projectId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
      .returning({ id: researchJobRequests.id });

    await expect(runDetect(request.id, projectId)).rejects.toThrow(/does not belong to the requesting user/);
  });
});

describe("computeBm25CandidatePairs (unit, no DB)", () => {
  it("excludes same-work pairs even at perfect BM25 similarity", () => {
    const claims = [
      { id: "a", workId: "w1", claimText: "practical wisdom and virtue" },
      { id: "b", workId: "w1", claimText: "practical wisdom and virtue" },
    ];
    expect(computeBm25CandidatePairs(claims)).toEqual([]);
  });

  it("finds a cross-work pair with real vocabulary overlap", () => {
    const claims = [
      { id: "a", workId: "w1", claimText: "the incontinent agent acts against better judgment" },
      { id: "b", workId: "w2", claimText: "an incontinent agent knowingly acts against their own better judgment" },
      { id: "c", workId: "w3", claimText: "photosynthesis in green plants requires chlorophyll" },
    ];
    const pairs = computeBm25CandidatePairs(claims);
    expect(pairs.some((p) => [p.loId, p.hiId].sort().join(" ") === ["a", "b"].sort().join(" "))).toBe(true);
    expect(pairs.every((p) => ![p.loId, p.hiId].includes("c"))).toBe(true);
  });
});

describe("deriveSectionKey (unit, no DB)", () => {
  it("drops the locus, keeping the author:work-slug portion", () => {
    expect(deriveSectionKey("aristotle:nicomachean-ethics:1151a")).toBe("aristotle:nicomachean-ethics");
  });

  it("passes through a key with fewer than two colon-separated parts unchanged", () => {
    expect(deriveSectionKey("solo")).toBe("solo");
  });
});
