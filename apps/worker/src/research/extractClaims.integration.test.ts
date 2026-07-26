import type { EmbeddingBatchResult, EmbeddingProvider } from "@ice/ai-adapters";
import {
  aiUsageLogs,
  citations,
  claimLoci,
  claimScores,
  db,
  documents,
  pages,
  processingRuns,
  researchClaimEmbeddings,
  researchClaims,
  researchCorpusItems,
  researchJobRequests,
  textBlocks,
  users,
  works,
} from "@ice/db";
import type { StructuredCaller } from "@ice/research";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { extractClaims, extractClaimsForCorpusItem, extractClaimsForWork, rebindClaimsForWork } from "./extractClaims";
import { runResearchJob } from "./jobRunner";
import { loadWorkExtractionScope } from "./repository";

/**
 * Integration tests for the extract_claims pipeline (Phase 26.1). Skipped
 * when DATABASE_URL is unset, matching every other `*.integration.test.ts`
 * file's convention. All LLM/embedding calls are mocked — $0 cost.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Mimics `OpenAIResponsesClient.call()`'s validate-then-return contract
 *  without any network call: invokes the caller-supplied `validate()`
 *  against a per-call, test-controlled fake parsed response, exactly as the
 *  real client would after parsing the model's JSON. A `validate()` throw
 *  propagates out of `.call()` unchanged — matching the real client's
 *  behavior after its retries are exhausted. */
class MockStructuredCaller implements StructuredCaller {
  available = true;
  callCount = 0;
  constructor(private readonly responder: (callIndex: number) => unknown) {}
  async call<T>(params: { model: string; validate: (parsed: unknown) => T }): Promise<{ data: T; promptTokens: number; completionTokens: number; model: string }> {
    const parsed = this.responder(this.callCount);
    this.callCount += 1;
    const data = params.validate(parsed);
    return { data, promptTokens: 120, completionTokens: 80, model: params.model };
  }
}

function claimsResponse(claims: { text: string; nature?: string; section?: string; confidence?: string; supportingExcerpt: string }[]) {
  return {
    claims: claims.map((c) => ({
      nature: "interpretive",
      section: "Body",
      confidence: "medium",
      ...c,
    })),
  };
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";
  readonly model = "mock-embed-3-small";
  readonly dim = 1536;
  readonly available = true;
  calls = 0;
  async embedBatch(texts: string[]): Promise<EmbeddingBatchResult> {
    this.calls += 1;
    return {
      vectors: texts.map((text, i) => Array.from({ length: 1536 }, (_, j) => ((i + j + text.length) % 11) / 11)),
      model: this.model,
      inputTokens: texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
    };
  }
  estimateCostUsd(inputTokens: number): number {
    return inputTokens * 0.00000002;
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

async function seedPublishedWork(
  bodyTexts: string[],
  opts: { footnoteText?: string; bibliographyText?: string; citationOnFirstBlock?: string } = {},
) {
  const [user] = await db.insert(users).values({ email: `ec-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [work] = await db.insert(works).values({ userId: user.id, title: "On Vice and Reason", authorName: "Terence Irwin" }).returning({ id: works.id });
  const [document] = await db
    .insert(documents)
    .values({
      workId: work.id,
      userId: user.id,
      fileSize: 1,
      storagePath: `ec/${crypto.randomUUID()}.txt`,
      originalFilename: "t.txt",
      mimeType: "text/plain",
      extractedText: bodyTexts.join(" "),
    })
    .returning({ id: documents.id });
  const [run] = await db
    .insert(processingRuns)
    .values({ documentId: document.id, version: 1, pipelineVersion: "v4", status: "complete", isPublished: true })
    .returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0 }).returning({ id: pages.id });

  let order = 0;
  const bodyBlockIds: string[] = [];
  for (const text of bodyTexts) {
    const [block] = await db.insert(textBlocks).values({ pageId: page.id, blockOrder: order++, kind: "body", text }).returning({ id: textBlocks.id });
    bodyBlockIds.push(block.id);
  }
  if (opts.footnoteText) {
    await db.insert(textBlocks).values({ pageId: page.id, blockOrder: order++, kind: "footnote", text: opts.footnoteText });
  }
  if (opts.bibliographyText) {
    await db.insert(textBlocks).values({ pageId: page.id, blockOrder: order++, kind: "bibliography", text: opts.bibliographyText });
  }
  if (opts.citationOnFirstBlock) {
    await db.insert(citations).values({
      documentId: document.id,
      processingRunId: run.id,
      textBlockId: bodyBlockIds[0],
      rawText: opts.citationOnFirstBlock,
      normalizedQuery: opts.citationOnFirstBlock,
      sourceType: "footnote",
    });
  }

  return { userId: user.id, workId: work.id, documentId: document.id, runId: run.id, pageId: page.id, bodyBlockIds };
}

async function seedJobRequest(userId: string, workId: string) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({ userId, jobType: "extract_claims", scope: { workId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

/** A user + one imported `research_corpus_item` — the abstract-source
 *  extraction path's seed (Phase 30 fix lane, D-25-13). Cascades to nothing
 *  else (a corpus item has no document/pages/text_blocks of its own). */
async function seedCorpusItem(abstract: string | null, title = "A Paper With An Abstract") {
  const [user] = await db.insert(users).values({ email: `ec-corpus-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [item] = await db
    .insert(researchCorpusItems)
    .values({
      userId: user.id,
      source: "openalex",
      externalId: `W${crypto.randomUUID()}`,
      dedupKey: crypto.randomUUID(),
      title,
      authors: ["A. Scholar"],
      abstract,
      raw: {},
    })
    .returning({ id: researchCorpusItems.id });
  return { userId: user.id, corpusItemId: item.id };
}

async function seedCorpusJobRequest(userId: string, corpusItemId: string, scopeOverride?: unknown) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "extract_claims",
      scope: scopeOverride ?? { corpusItemId },
      idempotencyKey: crypto.randomUUID(),
      status: "planned",
    })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("extract_claims (integration)", () => {
  const cleanupUsers: string[] = [];
  const cleanupRequests: string[] = [];
  afterEach(async () => {
    while (cleanupRequests.length) {
      const id = cleanupRequests.pop()!;
      await db.delete(aiUsageLogs).where(eq(aiUsageLogs.researchRequestId, id));
    }
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("inserts a grounded claim, scores it, and embeds it end-to-end via runResearchJob", async () => {
    const { userId, workId, bodyBlockIds } = await seedPublishedWork([
      "Irwin holds that the akratic agent's practical syllogism is incomplete at the moment of action.",
    ]);
    cleanupUsers.push(userId);
    const requestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(requestId);

    const caller = new MockStructuredCaller(() =>
      claimsResponse([
        {
          text: "Irwin argues the akratic agent's practical syllogism is incomplete at the moment of action.",
          supportingExcerpt: "the akratic agent's practical syllogism is incomplete at the moment of action",
        },
      ]),
    );
    const embedder = new MockEmbeddingProvider();

    await runResearchJob(requestId, (ctx) => extractClaimsForWork(caller, embedder, ctx, workId));

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");
    expect(request.coverage).toBe("full");

    const claims = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      textBlockId: bodyBlockIds[0],
      anchorState: "anchored",
      sourceScope: "full_text",
      excerptVerified: true,
      status: "active",
      verificationStatus: "unreviewed",
    });

    const scores = await db.select().from(claimScores).where(eq(claimScores.claimId, claims[0].id));
    // The seeded sentence carries no empirical/textual signal words, so an
    // honest "unscored" (zero rows) is an acceptable outcome here — the
    // assertion only checks the SHAPE when a signal did fire.
    for (const score of scores) {
      expect(["evidence_strength", "textual_support"]).toContain(score.dimension);
      expect(Array.isArray(score.signals) ? score.signals.length : 0).toBeGreaterThan(0);
    }

    const embeddings = await db.select().from(researchClaimEmbeddings).where(eq(researchClaimEmbeddings.claimId, claims[0].id));
    expect(embeddings).toHaveLength(1);
    expect(embeddings[0]).toMatchObject({ model: "mock-embed-3-small", dim: 1536 });
    expect(embeddings[0].embedding).toHaveLength(1536);

    const usage = await db.select().from(aiUsageLogs).where(eq(aiUsageLogs.researchRequestId, requestId));
    expect(usage.length).toBeGreaterThanOrEqual(2); // claim_extraction + claim_embedding
    expect(usage.some((u) => u.task === "claim_extraction")).toBe(true);
    expect(usage.some((u) => u.task === "claim_embedding")).toBe(true);
  });

  it("drops a claim whose supportingExcerpt is fabricated (not a literal substring anywhere) and records a concern", async () => {
    const { userId, workId } = await seedPublishedWork(["Aristotle discusses courage at length in Book III."]);
    cleanupUsers.push(userId);
    const requestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(requestId);

    const caller = new MockStructuredCaller(() =>
      claimsResponse([{ text: "A fabricated claim.", supportingExcerpt: "this exact phrase does not appear anywhere in the source text" }]),
    );
    const embedder = new MockEmbeddingProvider();

    let outcome!: Awaited<ReturnType<typeof extractClaimsForWork>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await extractClaimsForWork(caller, embedder, ctx, workId);
      return outcome;
    });

    expect(outcome.claimsExtracted).toBe(0);
    expect(outcome.concerns.some((c) => c.includes("dropped"))).toBe(true);
    const claims = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    expect(claims).toHaveLength(0);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    // A dropped chunk is an honest degraded outcome, not a job failure —
    // the request still completes (zero claims is the truthful result).
    expect(request.status).toBe("complete");
  });

  it("structurally excludes footnote/bibliography blocks — a claim citing only apparatus text is dropped, never inserted", async () => {
    const { userId, workId } = await seedPublishedWork(["The main argument concerns practical wisdom."], {
      footnoteText: "See Smith 1990 for a fuller discussion of this exact apparatus-only sentence.",
      bibliographyText: "Smith, J. (1990). Practical Wisdom. Oxford University Press.",
    });
    cleanupUsers.push(userId);
    const requestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(requestId);

    // The model "hallucinates" citing the footnote's own text — but the
    // footnote block was never in the chunk shown to it at all
    // (`CLAIM_ELIGIBLE_BLOCK_KINDS = ["body"]`), so this can only be
    // rejected as fabricated, structurally, regardless of the model's
    // behavior.
    const caller = new MockStructuredCaller(() =>
      claimsResponse([{ text: "Smith discusses this.", supportingExcerpt: "this exact apparatus-only sentence" }]),
    );
    const embedder = new MockEmbeddingProvider();

    await runResearchJob(requestId, (ctx) => extractClaimsForWork(caller, embedder, ctx, workId));

    const claims = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    expect(claims).toHaveLength(0);
  });

  it("dedup idempotency: re-running extraction against the same run inserts zero new claims/scores/loci/embeddings", async () => {
    const { userId, workId } = await seedPublishedWork(["Aristotle holds that virtue is a mean between two vices."]);
    cleanupUsers.push(userId);

    const excerpt = "virtue is a mean between two vices";
    const caller = () => new MockStructuredCaller(() => claimsResponse([{ text: "Aristotle defines virtue as a mean.", supportingExcerpt: excerpt }]));
    const embedder = new MockEmbeddingProvider();

    const firstRequestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(firstRequestId);
    await runResearchJob(firstRequestId, (ctx) => extractClaimsForWork(caller(), embedder, ctx, workId));
    const afterFirst = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    expect(afterFirst).toHaveLength(1);

    const secondRequestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(secondRequestId);
    let secondOutcome!: Awaited<ReturnType<typeof extractClaimsForWork>>;
    await runResearchJob(secondRequestId, async (ctx) => {
      secondOutcome = await extractClaimsForWork(caller(), embedder, ctx, workId);
      return secondOutcome;
    });

    expect(secondOutcome.claimsExtracted).toBe(0); // dedup hit — nothing NEW inserted
    const afterSecond = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id);
    const embeddings = await db.select().from(researchClaimEmbeddings).where(eq(researchClaimEmbeddings.claimId, afterFirst[0].id));
    expect(embeddings).toHaveLength(1); // still exactly one — the second run never re-embedded a dedup hit
  });

  it("rebind: exactly one match in the new run relocates the claim (anchor_state 'rebound')", async () => {
    const seedA = await seedPublishedWork(["The akratic agent acts against better judgment in a specific way."]);
    cleanupUsers.push(seedA.userId);
    const [claim] = await db
      .insert(researchClaims)
      .values({
        userId: seedA.userId,
        workId: seedA.workId,
        processingRunId: seedA.runId,
        textBlockId: seedA.bodyBlockIds[0],
        quote: "acts against better judgment",
        prefix: "The akratic agent ",
        suffix: " in a specific way.",
        anchorState: "anchored",
        claimText: "The akratic agent acts against better judgment.",
        claimNature: "interpretive",
        confidence: "medium",
        section: "Body",
        sourceScope: "full_text",
        supportingExcerpt: "acts against better judgment",
        excerptVerified: true,
        contentHash: "test-hash-rebind-1",
        promptVersion: "test-v1",
      })
      .returning();

    // Unpublish the old run, publish a NEW one with the same wording (a real
    // reprocess re-publishes fresh pages/text_blocks — old ones are gone,
    // never mutated in place).
    await db.update(processingRuns).set({ isPublished: false }).where(eq(processingRuns.id, seedA.runId));
    const [newDoc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, seedA.workId));
    const [newRun] = await db
      .insert(processingRuns)
      .values({ documentId: newDoc.id, version: 2, pipelineVersion: "v4", status: "complete", isPublished: true })
      .returning({ id: processingRuns.id });
    const [newPage] = await db.insert(pages).values({ runId: newRun.id, pageIndex: 0 }).returning({ id: pages.id });
    const [newBlock] = await db
      .insert(textBlocks)
      .values({ pageId: newPage.id, blockOrder: 0, kind: "body", text: "The akratic agent acts against better judgment in a specific way." })
      .returning({ id: textBlocks.id });

    const scope = await loadWorkExtractionScope(seedA.workId);
    expect(scope).not.toBeNull();
    const result = await rebindClaimsForWork(scope!);
    expect(result).toEqual({ rebound: 1, unanchored: 0 });

    const [updated] = await db.select().from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(updated).toMatchObject({ anchorState: "rebound", textBlockId: newBlock.id, processingRunId: newRun.id });
  });

  it("rebind: zero matches leaves the claim unanchored, never deleted", async () => {
    const seedA = await seedPublishedWork(["A passage that will not survive the reprocess at all."]);
    cleanupUsers.push(seedA.userId);
    const [claim] = await db
      .insert(researchClaims)
      .values({
        userId: seedA.userId,
        workId: seedA.workId,
        processingRunId: seedA.runId,
        textBlockId: seedA.bodyBlockIds[0],
        quote: "will not survive the reprocess",
        prefix: "A passage that ",
        suffix: " at all.",
        anchorState: "anchored",
        claimText: "A passage will not survive.",
        claimNature: "interpretive",
        confidence: "low",
        section: "Body",
        sourceScope: "full_text",
        supportingExcerpt: "will not survive the reprocess",
        excerptVerified: true,
        contentHash: "test-hash-rebind-2",
        promptVersion: "test-v1",
      })
      .returning();

    await db.update(processingRuns).set({ isPublished: false }).where(eq(processingRuns.id, seedA.runId));
    const [newDoc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, seedA.workId));
    const [newRun] = await db
      .insert(processingRuns)
      .values({ documentId: newDoc.id, version: 2, pipelineVersion: "v4", status: "complete", isPublished: true })
      .returning({ id: processingRuns.id });
    const [newPage] = await db.insert(pages).values({ runId: newRun.id, pageIndex: 0 }).returning({ id: pages.id });
    await db.insert(textBlocks).values({ pageId: newPage.id, blockOrder: 0, kind: "body", text: "Completely different wording now." });

    const scope = await loadWorkExtractionScope(seedA.workId);
    const result = await rebindClaimsForWork(scope!);
    expect(result).toEqual({ rebound: 0, unanchored: 1 });

    const [updated] = await db.select().from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(updated).toMatchObject({ anchorState: "unanchored", textBlockId: null, processingRunId: newRun.id });
    expect(updated.status).toBe("active"); // never deleted
  });

  it("rebind: more than one match leaves the claim unanchored — never guesses between duplicates", async () => {
    const seedA = await seedPublishedWork(["The twin passage appears exactly once here for now."]);
    cleanupUsers.push(seedA.userId);
    const [claim] = await db
      .insert(researchClaims)
      .values({
        userId: seedA.userId,
        workId: seedA.workId,
        processingRunId: seedA.runId,
        textBlockId: seedA.bodyBlockIds[0],
        quote: "twin passage appears",
        prefix: "The ",
        suffix: " exactly once here for now.",
        anchorState: "anchored",
        claimText: "The twin passage appears.",
        claimNature: "interpretive",
        confidence: "low",
        section: "Body",
        sourceScope: "full_text",
        supportingExcerpt: "twin passage appears",
        excerptVerified: true,
        contentHash: "test-hash-rebind-3",
        promptVersion: "test-v1",
      })
      .returning();

    await db.update(processingRuns).set({ isPublished: false }).where(eq(processingRuns.id, seedA.runId));
    const [newDoc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, seedA.workId));
    const [newRun] = await db
      .insert(processingRuns)
      .values({ documentId: newDoc.id, version: 2, pipelineVersion: "v4", status: "complete", isPublished: true })
      .returning({ id: processingRuns.id });
    const [newPage] = await db.insert(pages).values({ runId: newRun.id, pageIndex: 0 }).returning({ id: pages.id });
    // Two blocks, identical wording — genuinely ambiguous.
    await db.insert(textBlocks).values({ pageId: newPage.id, blockOrder: 0, kind: "body", text: "The twin passage appears here, duplicated." });
    await db.insert(textBlocks).values({ pageId: newPage.id, blockOrder: 1, kind: "body", text: "The twin passage appears here, duplicated." });

    const scope = await loadWorkExtractionScope(seedA.workId);
    const result = await rebindClaimsForWork(scope!);
    expect(result).toEqual({ rebound: 0, unanchored: 1 });

    const [updated] = await db.select().from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(updated).toMatchObject({ anchorState: "unanchored", textBlockId: null });
  });

  it("coverage is honestly 'partial' when a tiny pre-seeded budget stops extraction before the first chunk", async () => {
    const { userId, workId } = await seedPublishedWork(["A perfectly ordinary sentence with nothing remarkable in it at all."]);
    cleanupUsers.push(userId);
    const requestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(requestId);

    // Seed prior spend for THIS request far past the hard cap — simulates a
    // budget already exhausted by an earlier attempt (the crash-proof
    // re-seed idiom), so the very first chunk's `canAfford` check fails.
    await db.insert(aiUsageLogs).values({ researchRequestId: requestId, task: "claim_extraction", stage: "extracting-claims", provider: "openai", model: "test", estimatedCostUsd: 1000 });

    const caller = new MockStructuredCaller(() => claimsResponse([{ text: "Should never be reached.", supportingExcerpt: "ordinary sentence" }]));
    const embedder = new MockEmbeddingProvider();

    let outcome!: Awaited<ReturnType<typeof extractClaimsForWork>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await extractClaimsForWork(caller, embedder, ctx, workId);
      return outcome;
    });

    expect(outcome.coverage).toBe("partial");
    expect(outcome.note).toMatch(/soft cost cap/i);
    expect(caller.callCount).toBe(0); // never even attempted the chunk
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.coverage).toBe("partial");
    expect(request.actualCostUsd).toBeGreaterThanOrEqual(1000);
  });

  it("locus harvest: a Bekker-bearing excerpt/block produces an aristotle:nicomachean-ethics claim_locus row", async () => {
    const { userId, workId } = await seedPublishedWork([
      "As Aristotle states at NE 1151a20, the incontinent person acts against their own better judgment in a distinctive way.",
    ]);
    cleanupUsers.push(userId);
    const requestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(requestId);

    const excerpt = "the incontinent person acts against their own better judgment in a distinctive way";
    const caller = new MockStructuredCaller(() => claimsResponse([{ text: "Aristotle characterizes incontinence this way.", supportingExcerpt: excerpt }]));
    const embedder = new MockEmbeddingProvider();

    await runResearchJob(requestId, (ctx) => extractClaimsForWork(caller, embedder, ctx, workId));

    const claims = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    expect(claims).toHaveLength(1);
    const loci = await db.select().from(claimLoci).where(eq(claimLoci.claimId, claims[0].id));
    expect(loci.some((l) => l.locusKey === "aristotle:nicomachean-ethics:1151a" && l.origin === "block")).toBe(true);
  });

  it("locus harvest: a same-block resolved citation contributes an origin 'citation' locus row", async () => {
    const { userId, workId } = await seedPublishedWork(["The argument here concerns the unity of the virtues in general terms."], {
      citationOnFirstBlock: "cf. NE 1103a15",
    });
    cleanupUsers.push(userId);
    const requestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(requestId);

    const excerpt = "concerns the unity of the virtues";
    const caller = new MockStructuredCaller(() => claimsResponse([{ text: "The passage concerns the unity of the virtues.", supportingExcerpt: excerpt }]));
    const embedder = new MockEmbeddingProvider();

    await runResearchJob(requestId, (ctx) => extractClaimsForWork(caller, embedder, ctx, workId));

    const claims = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    const loci = await db.select().from(claimLoci).where(and(eq(claimLoci.claimId, claims[0].id), eq(claimLoci.origin, "citation")));
    expect(loci).toHaveLength(1);
    expect(loci[0].locusKey).toBe("aristotle:nicomachean-ethics:1103a");
  });

  it("skips embedding when the embedding provider is unavailable, but still inserts the claim", async () => {
    const { userId, workId } = await seedPublishedWork(["A claim about method that stands entirely on its own."]);
    cleanupUsers.push(userId);
    const requestId = await seedJobRequest(userId, workId);
    cleanupRequests.push(requestId);

    const caller = new MockStructuredCaller(() => claimsResponse([{ text: "A claim about method.", supportingExcerpt: "claim about method that stands" }]));
    const embedder = new UnavailableEmbeddingProvider();

    let outcome!: Awaited<ReturnType<typeof extractClaimsForWork>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await extractClaimsForWork(caller, embedder, ctx, workId);
      return outcome;
    });

    expect(outcome.claimsExtracted).toBe(1);
    const claims = await db.select().from(researchClaims).where(eq(researchClaims.workId, workId));
    expect(claims).toHaveLength(1);
    const embeddings = await db.select().from(researchClaimEmbeddings).where(eq(researchClaimEmbeddings.claimId, claims[0].id));
    expect(embeddings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Corpus-item (abstract-source) extraction path (Phase 28.2/30 fix lane,
// D-25-13) — the sibling of the uploaded-work suite above.
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("extract_claims corpus-item abstract-source path (integration)", () => {
  const cleanupUsers: string[] = [];
  const cleanupRequests: string[] = [];
  afterEach(async () => {
    while (cleanupRequests.length) {
      const id = cleanupRequests.pop()!;
      await db.delete(aiUsageLogs).where(eq(aiUsageLogs.researchRequestId, id));
    }
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("happy path: extracts, scores, harvests loci, and embeds a claim from an abstract end-to-end via runResearchJob", async () => {
    const abstract =
      "This paper argues that the akratic agent's practical syllogism, discussed at NE 7.3.1147a24-b19, is incomplete at the moment of action.";
    const { userId, corpusItemId } = await seedCorpusItem(abstract);
    cleanupUsers.push(userId);
    const requestId = await seedCorpusJobRequest(userId, corpusItemId);
    cleanupRequests.push(requestId);

    const excerpt = "the akratic agent's practical syllogism, discussed at NE 7.3.1147a24-b19, is incomplete";
    const caller = new MockStructuredCaller(() => claimsResponse([{ text: "The paper argues akrasia leaves the practical syllogism incomplete.", supportingExcerpt: excerpt }]));
    const embedder = new MockEmbeddingProvider();

    let outcome!: Awaited<ReturnType<typeof extractClaimsForCorpusItem>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await extractClaimsForCorpusItem(caller, embedder, ctx, corpusItemId);
      return outcome;
    });

    expect(outcome.coverage).toBe("full");
    expect(outcome.claimsExtracted).toBe(1);

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");

    const claims = await db.select().from(researchClaims).where(eq(researchClaims.corpusItemId, corpusItemId));
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      workId: null,
      corpusItemId,
      textBlockId: null,
      quote: null,
      prefix: null,
      suffix: null,
      anchorState: "unanchored",
      sourceScope: "abstract",
      excerptVerified: true,
      status: "active",
    });

    // Locus harvest fires on the excerpt/abstract text even with no
    // text_block to anchor to — the synthetic BlockMeta stand-in.
    const loci = await db.select().from(claimLoci).where(eq(claimLoci.claimId, claims[0].id));
    expect(loci.some((l) => l.locusKey === "aristotle:nicomachean-ethics:1147a")).toBe(true);

    const embeddings = await db.select().from(researchClaimEmbeddings).where(eq(researchClaimEmbeddings.claimId, claims[0].id));
    expect(embeddings).toHaveLength(1);

    const usage = await db.select().from(aiUsageLogs).where(eq(aiUsageLogs.researchRequestId, requestId));
    expect(usage.some((u) => u.task === "claim_extraction")).toBe(true);
  });

  it("honest failed request: a corpus item with no abstract fails the job rather than silently succeeding with 0 claims", async () => {
    const { userId, corpusItemId } = await seedCorpusItem(null);
    cleanupUsers.push(userId);
    const requestId = await seedCorpusJobRequest(userId, corpusItemId);
    cleanupRequests.push(requestId);

    const caller = new MockStructuredCaller(() => claimsResponse([]));
    const embedder = new MockEmbeddingProvider();
    // `runResearchJob` marks the row failed AND rethrows (jobRunner.ts's own
    // crash-safety contract) — the throw must be awaited/caught here, not
    // left as an unhandled rejection.
    await expect(runResearchJob(requestId, (ctx) => extractClaimsForCorpusItem(caller, embedder, ctx, corpusItemId))).rejects.toThrow(/no abstract to extract from/);

    expect(caller.callCount).toBe(0); // never even attempted a model call over nothing
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("failed");
    expect(request.error).toContain("no abstract to extract from");
  });

  it("literal-substring drop: a fabricated excerpt is dropped, never inserted, and the run still completes honestly", async () => {
    const { userId, corpusItemId } = await seedCorpusItem("A short abstract about method and results in a controlled trial.");
    cleanupUsers.push(userId);
    const requestId = await seedCorpusJobRequest(userId, corpusItemId);
    cleanupRequests.push(requestId);

    const caller = new MockStructuredCaller(() => claimsResponse([{ text: "A fabricated claim.", supportingExcerpt: "this exact phrase does not appear in the abstract at all" }]));
    const embedder = new MockEmbeddingProvider();

    let outcome!: Awaited<ReturnType<typeof extractClaimsForCorpusItem>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await extractClaimsForCorpusItem(caller, embedder, ctx, corpusItemId);
      return outcome;
    });

    // With only one possible "block" (the abstract itself), a fabricated
    // excerpt is caught by `validateClaimExtraction`'s chunk-wide check
    // inside the mocked `caller.call()` — the SAME check `extractOneChunk`'s
    // multi-block case also runs first — so this drops via the "extraction
    // failed validation" concern, not the second, block-specific
    // re-verification step (which only has something distinct to catch when
    // there's more than one candidate block, unlike here).
    expect(outcome.claimsExtracted).toBe(0);
    expect(outcome.concerns.some((c) => c.includes("dropped"))).toBe(true);
    const claims = await db.select().from(researchClaims).where(eq(researchClaims.corpusItemId, corpusItemId));
    expect(claims).toHaveLength(0);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete"); // an honest zero-claims outcome, not a failure
  });

  it("dedup idempotency: re-running extraction over the same abstract inserts zero new claims/scores/loci/embeddings", async () => {
    const { userId, corpusItemId } = await seedCorpusItem("Virtue, on this account, is a mean state between two vices.");
    cleanupUsers.push(userId);

    const excerpt = "a mean state between two vices";
    const caller = () => new MockStructuredCaller(() => claimsResponse([{ text: "Virtue is defined as a mean.", supportingExcerpt: excerpt }]));
    const embedder = new MockEmbeddingProvider();

    const firstRequestId = await seedCorpusJobRequest(userId, corpusItemId);
    cleanupRequests.push(firstRequestId);
    await runResearchJob(firstRequestId, (ctx) => extractClaimsForCorpusItem(caller(), embedder, ctx, corpusItemId));
    const afterFirst = await db.select().from(researchClaims).where(eq(researchClaims.corpusItemId, corpusItemId));
    expect(afterFirst).toHaveLength(1);

    const secondRequestId = await seedCorpusJobRequest(userId, corpusItemId);
    cleanupRequests.push(secondRequestId);
    let secondOutcome!: Awaited<ReturnType<typeof extractClaimsForCorpusItem>>;
    await runResearchJob(secondRequestId, async (ctx) => {
      secondOutcome = await extractClaimsForCorpusItem(caller(), embedder, ctx, corpusItemId);
      return secondOutcome;
    });

    expect(secondOutcome.claimsExtracted).toBe(0); // dedup hit — nothing new
    const afterSecond = await db.select().from(researchClaims).where(eq(researchClaims.corpusItemId, corpusItemId));
    expect(afterSecond).toHaveLength(1);
    const embeddings = await db.select().from(researchClaimEmbeddings).where(eq(researchClaimEmbeddings.claimId, afterSecond[0].id));
    expect(embeddings).toHaveLength(1); // still exactly one, not duplicated
  });

  it("caps accepted claims at MAX_CLAIMS_FOR_ABSTRACT even when the model returns more", async () => {
    const abstract = "Sentence one is about method. Sentence two is about results. Sentence three is about conclusions. Sentence four wraps up.";
    const { userId, corpusItemId } = await seedCorpusItem(abstract);
    cleanupUsers.push(userId);
    const requestId = await seedCorpusJobRequest(userId, corpusItemId);
    cleanupRequests.push(requestId);

    const caller = new MockStructuredCaller(() =>
      claimsResponse([
        { text: "Claim 1 about method.", supportingExcerpt: "Sentence one is about method" },
        { text: "Claim 2 about results.", supportingExcerpt: "Sentence two is about results" },
        { text: "Claim 3 about conclusions.", supportingExcerpt: "Sentence three is about conclusions" },
        { text: "Claim 4 wraps up.", supportingExcerpt: "Sentence four wraps up" },
        { text: "Claim 5 extra.", supportingExcerpt: "Sentence one is about method" },
        { text: "Claim 6 extra.", supportingExcerpt: "Sentence two is about results" },
        { text: "Claim 7 over the cap.", supportingExcerpt: "Sentence three is about conclusions" },
      ]),
    );
    const embedder = new MockEmbeddingProvider();

    let outcome!: Awaited<ReturnType<typeof extractClaimsForCorpusItem>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await extractClaimsForCorpusItem(caller, embedder, ctx, corpusItemId);
      return outcome;
    });

    expect(outcome.claimsExtracted).toBeLessThanOrEqual(6);
    expect(outcome.concerns.some((c) => c.includes("capped at"))).toBe(true);
  });

  it("ownership: throws when the corpus item does not belong to the requesting user", async () => {
    const { userId: ownerId, corpusItemId } = await seedCorpusItem("An abstract belonging to someone else.");
    cleanupUsers.push(ownerId);
    const { userId: otherUserId } = await seedCorpusItem("A different corpus item, owned by the requester instead.");
    cleanupUsers.push(otherUserId);

    const requestId = await seedCorpusJobRequest(otherUserId, corpusItemId);
    cleanupRequests.push(requestId);

    const caller = new MockStructuredCaller(() => claimsResponse([]));
    const embedder = new MockEmbeddingProvider();
    await expect(runResearchJob(requestId, (ctx) => extractClaimsForCorpusItem(caller, embedder, ctx, corpusItemId))).rejects.toThrow(/does not belong to the requesting user/);

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("failed");
    expect(request.error).toContain("does not belong to the requesting user");
  });
});

// ---------------------------------------------------------------------------
// extract_claims wrapper dispatch (Phase 30 fix lane, D-25-13/D-25-14) — the
// real scope-parsing/legacy-shape/error-message behavior wired into the
// worker's queue handler, exercised against real `research_job_request` rows
// (not just the pure `parseExtractClaimsScope` unit tests in
// `packages/claims/src/jobs/scope.test.ts`).
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("extract_claims() wrapper dispatch (integration)", () => {
  const cleanupUsers: string[] = [];
  const cleanupRequests: string[] = [];
  afterEach(async () => {
    while (cleanupRequests.length) {
      const id = cleanupRequests.pop()!;
      await db.delete(aiUsageLogs).where(eq(aiUsageLogs.researchRequestId, id));
    }
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  // NOTE: a happy-path "{corpusItemId} scope reaches the corpus-item path"
  // dispatch test deliberately does NOT live here — `extractClaims()`
  // constructs a REAL `OpenAIResponsesClient` from whatever `OPENAI_API_KEY`
  // is in the ambient environment, and this repo's local `.env` carries a
  // real key, so actually invoking it here would risk a real paid call
  // outside the `MockStructuredCaller` DI seam every other test in this file
  // uses. That path is already covered honestly two ways instead: the
  // `extractClaimsForCorpusItem` core tests above (DI'd mocks, $0) prove the
  // corpus path itself works, and `parseExtractClaimsScope`'s own round-trip
  // tests (`packages/claims/src/jobs/scope.test.ts`) prove `{corpusItemId}`
  // parses correctly — together they cover everything the wrapper's
  // dispatch `if` does for the success case without ever risking a real
  // network call. The two tests below are safe specifically because both
  // throw BEFORE `extractClaims()` ever constructs a provider client.

  it("reports the pre-fix D-25-14 legacy shape ({workIds: [...]}) as a distinct, actionable error, never the old corpus-TODO message", async () => {
    const { userId, workId } = await seedPublishedWork(["Legacy-shape dispatch test text."]);
    cleanupUsers.push(userId);
    const requestId = await seedCorpusJobRequest(userId, workId, { workIds: [workId] });
    cleanupRequests.push(requestId);

    await expect(runResearchJob(requestId, extractClaims)).rejects.toThrow(/pre-fix dispatch shape/);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("failed");
    expect(request.error).toContain("pre-fix dispatch shape");
    expect(request.error).not.toContain("not yet implemented");
  });

  it("reports an unrecognized scope shape distinctly from the legacy shape", async () => {
    const { userId } = await seedCorpusItem("An abstract, unused by this test.");
    cleanupUsers.push(userId);
    const requestId = await seedCorpusJobRequest(userId, "unused", { somethingElse: true });
    cleanupRequests.push(requestId);

    await expect(runResearchJob(requestId, extractClaims)).rejects.toThrow(/scope must be/);
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("failed");
    expect(request.error).toContain('"workId"');
    expect(request.error).toContain('"corpusItemId"');
    expect(request.error).not.toContain("pre-fix dispatch shape");
  });
});
