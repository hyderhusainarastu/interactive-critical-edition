import type { EmbeddingBatchResult, EmbeddingProvider } from "@ice/ai-adapters";
import { RETRIEVAL_LIMITS } from "@ice/claims";
import {
  bibliographicRecords,
  citations,
  claimLoci,
  claimPairCandidates,
  claimRelationships,
  claimScores,
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
import type { StructuredCaller } from "@ice/research";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildJudgeEngagementContext,
  computeBm25CandidatePairs,
  computeEvidenceGapForPair,
  deriveSectionKey,
  detectRelationshipsForProject,
  judgeCandidatePairsForProject,
  mapStrongerSide,
  type JudgeAnthropicCaller,
} from "./detectRelationships";
import { runResearchJob } from "./jobRunner";

// ---------------------------------------------------------------------------
// Judge-stage mocks — mimic `AnthropicTextJsonClient`/`OpenAIResponsesClient`'s
// validate-then-return contract without any network call (the
// `MockStructuredCaller` precedent from `extractClaims.integration.test.ts`).
// ---------------------------------------------------------------------------

type AnthropicResponder = (callIndex: number) => { ok: true; data: unknown } | { ok: false; error: string };

class MockAnthropicJudgeCaller implements JudgeAnthropicCaller {
  available = true;
  calls = 0;
  constructor(private readonly responder: AnthropicResponder) {}
  async call<T>(params: { model: string; validate: (parsed: unknown) => T }) {
    const outcome = this.responder(this.calls);
    this.calls += 1;
    if (outcome.ok) {
      const data = params.validate(outcome.data);
      return { ok: true as const, data, model: params.model, promptTokens: 100, completionTokens: 50 };
    }
    return { ok: false as const, error: outcome.error, model: params.model, promptTokens: 20, completionTokens: 0 };
  }
}

class UnavailableAnthropicCaller implements JudgeAnthropicCaller {
  available = false;
  calls = 0;
  async call(): Promise<never> {
    this.calls += 1;
    throw new Error("UnavailableAnthropicCaller must never be called — check `available` first.");
  }
}

class MockOpenAIJudgeCaller implements StructuredCaller {
  available = true;
  calls = 0;
  constructor(private readonly responder: (callIndex: number) => unknown) {}
  async call<T>(params: { model: string; validate: (parsed: unknown) => T }) {
    const parsed = this.responder(this.calls);
    this.calls += 1;
    const data = params.validate(parsed);
    return { data, promptTokens: 90, completionTokens: 40, model: params.model };
  }
}

class UnavailableOpenAICaller implements StructuredCaller {
  available = false;
  calls = 0;
  async call(): Promise<never> {
    this.calls += 1;
    throw new Error("UnavailableOpenAICaller must never be called — check `available` first.");
  }
}

/** A valid judge JSON payload — `relationship`/`category` are the only
 *  fields `validateJudgeResponse` requires to succeed. */
function judgeResponse(overrides: Record<string, unknown> = {}) {
  return {
    relationship: "contradiction",
    category: "findings",
    explanation: "They report incompatible effect directions on the same measured outcome under the same conditions.",
    strongerEvidence: "paper_a",
    resolution: "A replication with a larger sample would resolve which direction is correct.",
    mechanism: null,
    ...overrides,
  };
}

/**
 * Integration tests for the full detect_relationships pipeline: the
 * DETERMINISTIC Stage-1 half (Phase 26.2a: three-channel retrieval +
 * citation engagement, $0) AND the PAID judge stage (Phase 26.2b). Skipped
 * when DATABASE_URL is unset, matching every other `*.integration.test.ts`
 * file's convention.
 *
 * Every test costs exactly $0, real provider keys or not: Stage-1 only
 * reads pre-seeded `research_claim_embedding` rows (never calls
 * `embedBatch`), and `runDetect`'s judge-provider defaults are explicitly
 * UNAVAILABLE mocks (`UnavailableAnthropicCaller`/`UnavailableOpenAICaller`)
 * — never `detectRelationshipsForProject`'s own production defaults, which
 * construct real clients that read `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`
 * from the ambient environment. Only the tests in the "judge stage" describe
 * block below explicitly inject a caller, and every one of those uses a
 * canned mock (`MockAnthropicJudgeCaller`/`MockOpenAIJudgeCaller`), never a
 * real client.
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

async function seedClaimScore(claimId: string, dimension: "evidence_strength" | "textual_support", score: number) {
  await db.insert(claimScores).values({ claimId, dimension, score, label: "moderate", tier: null, signals: ["test"], scorerVersion: "test-v1" });
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

/**
 * Defaults the judge stage's two providers to explicitly UNAVAILABLE mocks
 * — never `detectRelationshipsForProject`'s own production defaults (real
 * `AnthropicTextJsonClient`/`OpenAIResponsesClient` instances, which read
 * `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` from the ambient environment). Every
 * test below this helper that doesn't explicitly test the judge stage must
 * stay genuinely $0 regardless of whether real provider keys happen to be
 * exported in whatever shell runs this suite (e.g. during a paid canary
 * session elsewhere in this same repo) — see this file's own top comment.
 */
async function runDetect(
  requestId: string,
  projectId: string,
  embedder: EmbeddingProvider = new MockEmbeddingProvider(),
  anthropic: JudgeAnthropicCaller = new UnavailableAnthropicCaller(),
  openai: StructuredCaller = new UnavailableOpenAICaller(),
) {
  let outcome!: Awaited<ReturnType<typeof detectRelationshipsForProject>>;
  await runResearchJob(requestId, async (ctx) => {
    outcome = await detectRelationshipsForProject(ctx, projectId, embedder, anthropic, openai);
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
    expect(request.coverage).toBe("partial"); // the candidate exists but no judge provider is configured in this test (runDetect's default mocks), so it awaits judgment
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

// ---------------------------------------------------------------------------
// Judge stage (Phase 26.2b).
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("detect_relationships judge stage (integration)", () => {
  const cleanupUsers: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  /** Two cross-work claims sharing a locus — a deterministic, $0 Stage-1
   *  candidate every time, so these tests don't depend on BM25/dense scoring
   *  to guarantee a pair exists. */
  async function seedJudgeablePair(userId: string, claimAText = "Claim A about the shared locus.", claimBText = "Claim B about that very same locus.") {
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, claimAText);
    const claimB = await seedClaim(userId, workB, claimBText);
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");
    const projectId = await seedProject(userId, [workA, workB]);
    return { claimA, claimB, projectId };
  }

  it("judges a pair and persists a claim_relationship row with the right shape", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const { claimA, claimB, projectId } = await seedJudgeablePair(userId);

    const anthropic = new MockAnthropicJudgeCaller(() => ({ ok: true, data: judgeResponse() }));
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider(), anthropic, new UnavailableOpenAICaller());

    expect(outcome.judged).toBe(1);
    expect(outcome.alreadyJudged).toBe(0);
    expect(outcome.candidatesAwaitingJudgment).toBe(0);
    expect(anthropic.calls).toBe(1);

    const [loId, hiId] = [claimA.id, claimB.id].sort();
    const [row] = await db.select().from(claimRelationships).where(and(eq(claimRelationships.claimLoId, loId), eq(claimRelationships.claimHiId, hiId)));
    expect(row).toBeDefined();
    expect(row.valence).toBe("contradiction");
    expect(row.category).toBe("findings");
    expect(row.judgeBranch).toBe("empirical");
    expect(row.mechanism).toBeNull();
    expect(row.provider).toBe("anthropic");
    expect(row.engagement).toBe("none_detected");
    expect(row.basisHash).toMatch(/^[0-9a-f]{64}$/);

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.coverage).toBe("full");
  });

  it("basis-hash idempotency: a repeat detect_relationships run judges zero NEW pairs and makes zero new provider calls", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const { projectId } = await seedJudgeablePair(userId);

    const firstAnthropic = new MockAnthropicJudgeCaller(() => ({ ok: true, data: judgeResponse() }));
    const firstRequestId = await seedJobRequest(userId, projectId);
    const first = await runDetect(firstRequestId, projectId, new UnavailableEmbeddingProvider(), firstAnthropic, new UnavailableOpenAICaller());
    expect(first.judged).toBe(1);

    // A SECOND provider mock that throws if ever called — proves the repeat
    // run never even attempts a provider call for the already-judged pair.
    const secondAnthropic = new UnavailableAnthropicCaller();
    secondAnthropic.available = true; // available, but its call() throws — proving it's never invoked
    const secondRequestId = await seedJobRequest(userId, projectId);
    const second = await runDetect(secondRequestId, projectId, new UnavailableEmbeddingProvider(), secondAnthropic, new UnavailableOpenAICaller());

    expect(second.judged).toBe(0);
    expect(second.alreadyJudged).toBe(1);
    expect(second.candidatesAwaitingJudgment).toBe(0);
    expect(secondAnthropic.calls).toBe(0);

    const allRows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
    expect(allRows).toHaveLength(1); // exactly one row total, not two
  });

  it("skip-on-failure honesty: a failed judge call never fabricates a relationship row", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const { projectId } = await seedJudgeablePair(userId);

    const anthropic = new MockAnthropicJudgeCaller(() => ({ ok: false, error: "model output was not valid JSON" }));
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider(), anthropic, new UnavailableOpenAICaller());

    expect(outcome.judged).toBe(0);
    expect(outcome.judgeFailed).toBe(1);
    expect(outcome.candidatesAwaitingJudgment).toBe(1);

    const rows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
    expect(rows).toHaveLength(0);

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.coverage).toBe("partial");
  });

  it("falls back to the openai alternate when no Anthropic key is configured", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const { projectId } = await seedJudgeablePair(userId);

    const openai = new MockOpenAIJudgeCaller(() => judgeResponse({ relationship: "support", category: "theoretical" }));
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider(), new UnavailableAnthropicCaller(), openai);

    expect(outcome.judged).toBe(1);
    expect(openai.calls).toBe(1);

    const rows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
    expect(rows[0].provider).toBe("openai");
    expect(rows[0].valence).toBe("support");
  });

  it("evidence_gap dimension discipline: a mixed-dimension pair (lo scored on evidence_strength, hi on textual_support) never persists a gap", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const { claimA, claimB, projectId } = await seedJudgeablePair(userId);
    await seedClaimScore(claimA.id, "evidence_strength", 0.8);
    await seedClaimScore(claimB.id, "textual_support", 0.3);

    const anthropic = new MockAnthropicJudgeCaller(() => ({ ok: true, data: judgeResponse() }));
    const requestId = await seedJobRequest(userId, projectId);
    await runDetect(requestId, projectId, new UnavailableEmbeddingProvider(), anthropic, new UnavailableOpenAICaller());

    const rows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
    expect(rows[0].evidenceGap).toBeNull();
    expect(rows[0].evidenceGapDimension).toBeNull();
  });

  it("evidence_gap: a same-dimension pair with a material gap (>0.1) persists gap + dimension", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const { claimA, claimB, projectId } = await seedJudgeablePair(userId);
    await seedClaimScore(claimA.id, "evidence_strength", 0.8);
    await seedClaimScore(claimB.id, "evidence_strength", 0.2);

    const anthropic = new MockAnthropicJudgeCaller(() => ({ ok: true, data: judgeResponse() }));
    const requestId = await seedJobRequest(userId, projectId);
    await runDetect(requestId, projectId, new UnavailableEmbeddingProvider(), anthropic, new UnavailableOpenAICaller());

    const [loId] = [claimA.id, claimB.id].sort();
    const rows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
    expect(rows[0].evidenceGapDimension).toBe("evidence_strength");
    // The gap is signed lo-minus-hi — assert the magnitude/dimension rather
    // than a hardcoded sign, since which claim sorts to "lo" is UUID-order
    // dependent, not test-controlled.
    expect(Math.abs(rows[0].evidenceGap!)).toBeCloseTo(0.6, 2);
    expect(rows[0].evidenceGap === 0.6 || rows[0].evidenceGap === -0.6).toBe(true);
    void loId;
  });

  it("no judge provider configured: candidates are left honestly unjudged, never fabricated", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const { projectId } = await seedJudgeablePair(userId);

    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId); // defaults: both providers unavailable

    expect(outcome.judged).toBe(0);
    expect(outcome.candidatesAwaitingJudgment).toBe(1);
    expect(outcome.concerns.some((c) => c.includes("No judge provider configured"))).toBe(true);
    const rows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("maxJudgedPairsPerRequest truncation: candidates beyond the cap stay awaiting judgment this run", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const workC = await seedWork(userId, "Work C");
    const claimA = await seedClaim(userId, workA, "Claim A about the shared locus.");
    const claimB = await seedClaim(userId, workB, "Claim B about that very same locus.");
    const claimC = await seedClaim(userId, workC, "Claim C also about that very same locus.");
    // Three works sharing one locus produce all THREE cross-work pairs
    // (A-B, A-C, B-C) — `crossWorkPairsByKey`'s full pairwise combination
    // over one locus group, `@ice/claims`'s `retrieval/locus.ts`.
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimC.id, "aristotle:nicomachean-ethics:1151a");
    const projectId = await seedProject(userId, [workA, workB, workC]);

    // RETRIEVAL_LIMITS is a plain mutable module-level constant (not
    // env-rebindable after import) — temporarily lower the cap so 3 seeded
    // candidates exceed it without seeding 41+ works.
    const originalCap = RETRIEVAL_LIMITS.maxJudgedPairsPerRequest;
    RETRIEVAL_LIMITS.maxJudgedPairsPerRequest = 2;
    try {
      const anthropic = new MockAnthropicJudgeCaller(() => ({ ok: true, data: judgeResponse() }));
      const requestId = await seedJobRequest(userId, projectId);
      const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider(), anthropic, new UnavailableOpenAICaller());

      expect(outcome.judged).toBe(2); // capped at 2, not all 3 pending pairs
      expect(anthropic.calls).toBe(2);
      expect(outcome.candidatesAwaitingJudgment).toBe(1);
      expect(outcome.coverage).toBe("partial");
      expect(outcome.concerns.some((c) => c.includes("Judging capped at 2"))).toBe(true);

      const rows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
      expect(rows).toHaveLength(2); // exactly the capped count persisted, not all 3
    } finally {
      RETRIEVAL_LIMITS.maxJudgedPairsPerRequest = originalCap;
    }
  });

  it("mid-run budget stop: the loop stops once a call pushes spend over the soft cap, leaving the rest awaiting judgment", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const workC = await seedWork(userId, "Work C");
    const claimA = await seedClaim(userId, workA, "Claim A about the shared locus.");
    const claimB = await seedClaim(userId, workB, "Claim B about that very same locus.");
    const claimC = await seedClaim(userId, workC, "Claim C also about that very same locus.");
    await seedLocus(claimA.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimB.id, "aristotle:nicomachean-ethics:1151a");
    await seedLocus(claimC.id, "aristotle:nicomachean-ethics:1151a");
    const projectId = await seedProject(userId, [workA, workB, workC]); // 3 candidate pairs

    // A judge mock reporting real-looking but huge per-call token usage —
    // `estimateCostUsd`'s unknown-model fallback pricing ($1/$3 per Mtok
    // input/output) means 600k/300k tokens alone cost $1.50, well past the
    // default $1 soft cap, so `overSoftCap(ctx.budget)` (re-checked before
    // EVERY pair in `judgeCandidatePairsForProject`'s loop, not just once up
    // front) trips after the FIRST real call rather than gating nothing at
    // all — proving the stop is genuinely mid-run.
    class BudgetBurningAnthropicJudgeCaller implements JudgeAnthropicCaller {
      available = true;
      calls = 0;
      async call<T>(params: { model: string; validate: (parsed: unknown) => T }) {
        this.calls += 1;
        const data = params.validate(judgeResponse());
        return { ok: true as const, data, model: params.model, promptTokens: 600_000, completionTokens: 300_000 };
      }
    }
    const anthropic = new BudgetBurningAnthropicJudgeCaller();

    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runDetect(requestId, projectId, new UnavailableEmbeddingProvider(), anthropic, new UnavailableOpenAICaller());

    expect(outcome.judged).toBe(1); // exactly one pair judged before the budget check broke the loop
    expect(anthropic.calls).toBe(1); // the loop broke BEFORE attempting a second/third pair
    expect(outcome.candidatesAwaitingJudgment).toBe(2);
    expect(outcome.coverage).toBe("partial");
    expect(outcome.note).toMatch(/stopped early: cost budget/i);
    expect(outcome.concerns.some((c) => /Judging stopped after 1\/3 pair\(s\): cost budget reached\./.test(c))).toBe(true);

    const rows = await db.select().from(claimRelationships).where(eq(claimRelationships.userId, userId));
    expect(rows).toHaveLength(1);
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

describe("buildJudgeEngagementContext (unit, no DB)", () => {
  it("direct_citation, citing work is lo: no swap, kind direct_citation", () => {
    const { context, swapToHiFirst } = buildJudgeEngagementContext("direct_citation", { citingWorkId: "lo-work", citedWorkId: "hi-work" }, "lo-work", "hi-work");
    expect(context).toEqual({ kind: "direct_citation" });
    expect(swapToHiFirst).toBe(false);
  });

  it("direct_citation, citing work is hi: swaps so the citing work is presented as Work A", () => {
    const { context, swapToHiFirst } = buildJudgeEngagementContext("direct_citation", { citingWorkId: "hi-work", citedWorkId: "lo-work" }, "lo-work", "hi-work");
    expect(context).toEqual({ kind: "direct_citation" });
    expect(swapToHiFirst).toBe(true);
  });

  it("reciprocal_citation: engagement context included, never swaps (true either direction)", () => {
    const { context, swapToHiFirst } = buildJudgeEngagementContext("reciprocal_citation", { direction: "both" }, "lo-work", "hi-work");
    expect(context).toEqual({ kind: "direct_citation" });
    expect(swapToHiFirst).toBe(false);
  });

  it("shared_citation: no engagement context (the calibrated framing would be inaccurate)", () => {
    const { context, swapToHiFirst } = buildJudgeEngagementContext("shared_citation", { sharedBibliographicRecordIds: ["x"] }, "lo-work", "hi-work");
    expect(context).toBeUndefined();
    expect(swapToHiFirst).toBe(false);
  });

  it("none_detected: no engagement context", () => {
    const { context } = buildJudgeEngagementContext("none_detected", null, "lo-work", "hi-work");
    expect(context).toBeUndefined();
  });
});

describe("mapStrongerSide (unit, no DB)", () => {
  it("maps paper_a to lo when not swapped", () => {
    expect(mapStrongerSide("paper_a", false)).toBe("lo");
  });
  it("maps paper_b to hi when not swapped", () => {
    expect(mapStrongerSide("paper_b", false)).toBe("hi");
  });
  it("maps paper_a to hi when swapped (hi was presented as Work A)", () => {
    expect(mapStrongerSide("paper_a", true)).toBe("hi");
  });
  it("maps paper_b to lo when swapped", () => {
    expect(mapStrongerSide("paper_b", true)).toBe("lo");
  });
  it("neither is unaffected by swap", () => {
    expect(mapStrongerSide("neither", false)).toBe("neither");
    expect(mapStrongerSide("neither", true)).toBe("neither");
  });
});

describe("computeEvidenceGapForPair (unit, no DB)", () => {
  it("returns null when the claims share no scored dimension", () => {
    expect(computeEvidenceGapForPair([{ dimension: "evidence_strength", score: 0.8 }], [{ dimension: "textual_support", score: 0.3 }])).toBeNull();
  });

  it("returns null when either claim has no score at all", () => {
    expect(computeEvidenceGapForPair([], [{ dimension: "evidence_strength", score: 0.5 }])).toBeNull();
  });

  it("returns null when the shared-dimension gap does not clear the 0.1 minimum magnitude", () => {
    expect(
      computeEvidenceGapForPair([{ dimension: "evidence_strength", score: 0.55 }], [{ dimension: "evidence_strength", score: 0.5 }]),
    ).toBeNull();
  });

  it("reports evidence_strength with the signed gap when it clears the minimum", () => {
    expect(computeEvidenceGapForPair([{ dimension: "evidence_strength", score: 0.8 }], [{ dimension: "evidence_strength", score: 0.2 }])).toEqual({
      gap: 0.6,
      dimension: "evidence_strength",
    });
  });

  it("prefers evidence_strength over textual_support when both dimensions clear the minimum", () => {
    expect(
      computeEvidenceGapForPair(
        [
          { dimension: "evidence_strength", score: 0.9 },
          { dimension: "textual_support", score: 0.9 },
        ],
        [
          { dimension: "evidence_strength", score: 0.1 },
          { dimension: "textual_support", score: 0.1 },
        ],
      ),
    ).toEqual({ gap: 0.8, dimension: "evidence_strength" });
  });

  it("falls back to textual_support when evidence_strength doesn't clear the minimum on both sides", () => {
    expect(
      computeEvidenceGapForPair(
        [
          { dimension: "evidence_strength", score: 0.5 },
          { dimension: "textual_support", score: 0.9 },
        ],
        [
          { dimension: "evidence_strength", score: 0.52 },
          { dimension: "textual_support", score: 0.1 },
        ],
      ),
    ).toEqual({ gap: 0.8, dimension: "textual_support" });
  });
});
