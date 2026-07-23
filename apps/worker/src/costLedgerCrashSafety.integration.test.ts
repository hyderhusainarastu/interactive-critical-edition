/**
 * Regression for the floors2 crash report's §5 items 2 and 4 (cost-ledger
 * crash safety + error-cause preservation), AMENDED per the Opus verifier's
 * review of the first fix, then AMENDED AGAIN (round 2) per a second Opus
 * verifier pass:
 *
 * (1) PER-RUN PERSISTENCE: `processing_run.ai_cost_usd` must always report
 *     ONLY the run's OWN spend (`budget.spentUsd - seededUsd`), never the
 *     seeded total — this is `cost.ts`'s documented per-run invariant, the
 *     admin dashboard's global sum, and the reader's per-edition cost
 *     display. The seed still lives inside the in-memory `budget` itself, so
 *     `canAfford`/`overSoftCap` still enforce the true cumulative spend
 *     across a crash-loop retry — only the PERSISTED column is corrected.
 * (2) SEED SCOPE (round 1): the seed sums `ai_usage_log` rows joined ONLY to
 *     this document's prior FAILED runs (`processing_run.status = 'failed'`)
 *     — not complete runs, published or superseded. A crash-loop retry
 *     inherits its own failed spend (the caps still bind), but a legitimate
 *     reprocess after a successful publish starts its budget fresh.
 * (3) EPISODE SCOPING (round 2): "failed runs only" is not by itself enough —
 *     a failed run from BEFORE a later successful publish must stop seeding
 *     every reprocess that comes after that publish, forever. The seed is
 *     now further narrowed to failed runs whose `version` is strictly
 *     greater than the document's most recent COMPLETE run's version (0 when
 *     there has never been one) — i.e. only failures SINCE the last publish
 *     belong to the current crash episode. A publish resets the seed to $0;
 *     multiple failed runs within the same still-open episode still
 *     accumulate together. `ai_usage_log.run_id` is a real per-run column, so
 *     this is an exact per-run join, not a `created_at`-window approximation.
 *
 * Both the soft and hard cost caps are pinned to small, deterministic
 * values for this file via `process.env` BEFORE any module loads (the same
 * pattern `budgetStop.integration.test.ts` already established) —
 * `RESEARCH_LIMITS` captures `process.env` at import time, so setting these
 * inside a test body would be too late.
 */
vi.hoisted(() => {
  process.env.RESEARCH_COST_SOFT_CAP = "0.4";
  process.env.RESEARCH_COST_HARD_CAP = "5";
});

const researchMock = vi.hoisted(() => ({
  generateLaneQueries: vi.fn(),
  runDiscovery: vi.fn(),
  assessCandidate: vi.fn(),
}));
vi.mock("@ice/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/research")>()),
  allAdapters: () => [],
  generateLaneQueries: researchMock.generateLaneQueries,
  runDiscovery: researchMock.runDiscovery,
  assessCandidate: researchMock.assessCandidate,
}));

const classifyMock = vi.hoisted(() => ({ classifyRelationship: vi.fn() }));
vi.mock("@ice/ai-adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ice/ai-adapters")>();
  return {
    ...actual,
    OpenAIResponsesClient: class { available = false; },
    classifyRelationship: classifyMock.classifyRelationship,
  };
});

import { aiUsageLogs, bibliographicRecords, db, documents, editionRelations, processingRuns, users, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeEditionRun } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);

// Deterministic, exact cost via estimateCostUsd's fallback pricing
// ($1.00/$3.00 per MTOK for an unrecognized model): 100,000 prompt tokens +
// 50,000 completion tokens = 0.1 + 0.15 = $0.25 exactly, per successful
// classification call.
const FIXTURE_MODEL = "gpt-fixture-cost-model";
const FIXTURE_PROMPT_TOKENS = 100_000;
const FIXTURE_COMPLETION_TOKENS = 50_000;
const EXPECTED_COST_PER_CALL = 0.25;

function paidClassification() {
  return {
    category: "interpretive_aid" as const,
    explanation: "Deterministic fixture.",
    confidence: 0.7,
    provider: "openai" as const,
    model: FIXTURE_MODEL,
    promptTokens: FIXTURE_PROMPT_TOKENS,
    completionTokens: FIXTURE_COMPLETION_TOKENS,
    heuristic: false,
  };
}

function fixtureResource(over: { doi: string; title: string; url: string }) {
  return {
    provider: "openalex" as const,
    resourceType: "book" as const,
    title: over.title,
    authors: ["Fixture Author"],
    year: 2000,
    doi: over.doi,
    isbn: null,
    url: over.url,
    snippet: "A fixture resource for the cost-ledger crash-safety regression.",
    venue: null,
    popularity: null,
    raw: { fixture: true },
  };
}

async function seedDocument(tag: string) {
  const [user] = await db.insert(users).values({ email: `cost-flush-${tag}@example.com` }).returning({ id: users.id });
  const [work] = await db.insert(works).values({ userId: user.id, title: "Cost Ledger Fixture Work", authorName: "Fixture Author" }).returning({ id: works.id });
  const extractedText = "This fixture text names other scholarly sources for the cost-ledger crash-safety regression.";
  const [document] = await db.insert(documents).values({
    userId: user.id,
    workId: work.id,
    storagePath: `fixtures/${work.id}/cost-flush.txt`,
    originalFilename: "cost-flush.txt",
    mimeType: "text/plain",
    fileSize: 100,
    processingStatus: "ready",
    extractedText,
  }).returning({ id: documents.id });
  return { userId: user.id, workId: work.id, documentId: document.id, extractedText };
}

describe.skipIf(!hasDb)("analyzeEditionRun cost-ledger crash safety (floors2 crash follow-up, §5 items 2/4, Opus-amended)", () => {
  const cleanupUserIds: string[] = [];
  const cleanupDois: string[] = [];

  afterEach(async () => {
    researchMock.generateLaneQueries.mockReset();
    researchMock.runDiscovery.mockReset();
    researchMock.assessCandidate.mockReset();
    classifyMock.classifyRelationship.mockReset();
    for (const userId of cleanupUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
    for (const doi of cleanupDois.splice(0)) {
      await db.delete(bibliographicRecords).where(eq(bibliographicRecords.doi, doi));
    }
  });

  it("persists usage/cost through a mid-run crash and folds the driver cause into the error", async () => {
    const tag = crypto.randomUUID();
    const seeded = await seedDocument(tag);
    cleanupUserIds.push(seeded.userId);

    const doiA = `10.1234/${tag}-a`;
    const doiB = `10.1234/${tag}-b`;
    cleanupDois.push(doiA, doiB);
    const resourceA = fixtureResource({ doi: doiA, title: "Cost Ledger Source A", url: `https://fixture.invalid/${tag}/a` });
    const resourceB = fixtureResource({ doi: doiB, title: "Cost Ledger Source B", url: `https://fixture.invalid/${tag}/b` });

    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "explicit_citation", queries: ["cost ledger fixture"] }],
      usedModel: false,
      promptTokens: 0,
      completionTokens: 0,
    });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));

    // Candidate A's classification succeeds (real cost logged), candidate B's
    // throws a Postgres-shaped error (`.cause` carrying a real driver
    // code/message, exactly what DrizzleQueryError wraps) — modeling the
    // exact crash the floors2 incident hit mid-loop.
    researchMock.runDiscovery.mockResolvedValue({ resources: [resourceA, resourceB], attempts: [], laneByKey: new Map(), rounds: 1, saturationNote: null });
    const causedError = new Error('Failed query: insert into "research_resource" ... params: ...');
    (causedError as unknown as { cause?: unknown }).cause = {
      message: "duplicate key value violates unique constraint \"some_other_unique_constraint\"",
      code: "23505",
    };
    classifyMock.classifyRelationship
      .mockResolvedValueOnce(paidClassification())
      .mockRejectedValueOnce(causedError);

    const [runOne] = await db.insert(processingRuns).values({ documentId: seeded.documentId, version: 1, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });

    let caught: Error | null = null;
    try {
      await analyzeEditionRun({ runId: runOne.id, documentId: seeded.documentId, text: seeded.extractedText, pipeline: "v3" });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).not.toBeNull();
    // Error-cause preservation: the Postgres cause's own code/message must be
    // readable straight off the thrown error's message, not just Drizzle's
    // generic "Failed query" wrapper text.
    expect(caught!.message).toContain("Failed query");
    expect(caught!.message).toContain("23505");
    expect(caught!.message).toContain("duplicate key value violates unique constraint");

    // Cost-ledger crash safety: candidate A's real cost survived the crash —
    // both as its own ai_usage_log row and as the run's own ai_cost_usd,
    // despite the run having thrown. This is run 1's OWN spend; there is no
    // prior run for this document yet, so nothing was seeded.
    const usageAfterCrash = await db.select({ cost: aiUsageLogs.estimatedCostUsd }).from(aiUsageLogs).where(eq(aiUsageLogs.runId, runOne.id));
    expect(usageAfterCrash).toHaveLength(1);
    expect(usageAfterCrash[0].cost).toBeCloseTo(EXPECTED_COST_PER_CALL, 6);

    const [runOneRow] = await db.select({ aiCostUsd: processingRuns.aiCostUsd }).from(processingRuns).where(eq(processingRuns.id, runOne.id));
    expect(runOneRow.aiCostUsd).toBeCloseTo(EXPECTED_COST_PER_CALL, 6);

    // `analyzeEditionRun` itself never touches `processing_run.status` — that
    // is the CALLER's job (`extraction.ts`'s catch block sets it to
    // "failed"). Do that here too, so the run this crash actually produced
    // is in the same state a real crash-loop retry would find it in, before
    // exercising the seed behavior below.
    await db.update(processingRuns).set({ status: "failed" }).where(eq(processingRuns.id, runOne.id));
  });

  it("seeds a retry's budget from a prior FAILED run's own spend, but each run's OWN persisted cost stays per-run-correct, and the in-memory cap still sees the cumulative total", async () => {
    const tag = crypto.randomUUID();
    const seeded = await seedDocument(tag);
    cleanupUserIds.push(seeded.userId);

    // A prior FAILED run for this same document, with its own real spend
    // already persisted — modeling a crash-loop retry's history directly,
    // rather than re-driving a second real crash through the pipeline.
    const [failedRun] = await db
      .insert(processingRuns)
      .values({ documentId: seeded.documentId, version: 1, pipelineVersion: "v3", status: "failed", aiCostUsd: EXPECTED_COST_PER_CALL })
      .returning({ id: processingRuns.id });
    await db.insert(aiUsageLogs).values({
      documentId: seeded.documentId,
      runId: failedRun.id,
      task: "relationship_classification",
      stage: "classification",
      provider: "openai",
      model: FIXTURE_MODEL,
      promptTokens: FIXTURE_PROMPT_TOKENS,
      completionTokens: FIXTURE_COMPLETION_TOKENS,
      estimatedCostUsd: EXPECTED_COST_PER_CALL,
    });

    const doiC = `10.1234/${tag}-c`;
    cleanupDois.push(doiC);
    const resourceC = fixtureResource({ doi: doiC, title: "Cost Ledger Source C", url: `https://fixture.invalid/${tag}/c` });
    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "explicit_citation", queries: ["cost ledger fixture"] }],
      usedModel: false,
      promptTokens: 0,
      completionTokens: 0,
    });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));
    researchMock.runDiscovery.mockResolvedValue({ resources: [resourceC], attempts: [], laneByKey: new Map(), rounds: 1, saturationNote: null });
    classifyMock.classifyRelationship.mockResolvedValue(paidClassification());

    const [retryRun] = await db.insert(processingRuns).values({ documentId: seeded.documentId, version: 2, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });
    await analyzeEditionRun({ runId: retryRun.id, documentId: seeded.documentId, text: seeded.extractedText, pipeline: "v3" });

    const [retryRow] = await db
      .select({ aiCostUsd: processingRuns.aiCostUsd, degraded: processingRuns.degraded })
      .from(processingRuns)
      .where(eq(processingRuns.id, retryRun.id));
    // Per-run persistence (item 1): the retry's OWN persisted cost is ONLY
    // its own new spend ($0.25), not the seeded $0.25 + its own $0.25 = $0.50
    // the pre-fix code would have written here.
    expect(retryRow.aiCostUsd).toBeCloseTo(EXPECTED_COST_PER_CALL, 6);
    // In-memory cap behavior (item 3): the soft cap for this file is pinned
    // to $0.40 (see the top-of-file vi.hoisted env stub). The seed ($0.25)
    // plus this run's own new spend ($0.25) totals $0.50, which is >= the
    // $0.40 soft cap — so `overSoftCap` must still see the TRUE cumulative
    // total and report this run as degraded, even though the persisted
    // `aiCostUsd` column correctly shows only $0.25.
    expect(retryRow.degraded).toBe(true);

    // The document's total real spend across both runs is genuinely $0.50 —
    // just correctly attributed one run at a time, not double-counted or
    // hidden in either persisted column.
    const totalUsage = await db
      .select({ cost: aiUsageLogs.estimatedCostUsd })
      .from(aiUsageLogs)
      .where(eq(aiUsageLogs.documentId, seeded.documentId));
    const total = totalUsage.reduce((sum, row) => sum + row.cost, 0);
    expect(total).toBeCloseTo(EXPECTED_COST_PER_CALL * 2, 6);
  });

  it("does NOT seed a fresh reprocess's budget from a prior PUBLISHED run, even one whose spend is well above the soft cap", async () => {
    const tag = crypto.randomUUID();
    const seeded = await seedDocument(tag);
    cleanupUserIds.push(seeded.userId);

    // A prior run that completed successfully and was published — a
    // legitimate, non-crashed edition — whose real spend ($1.50) is well
    // above this file's $0.40 soft cap. This must NEVER be inherited by a
    // later reprocess: only `status = 'failed'` runs seed the budget.
    const publishedSpend = 1.5;
    const [publishedRun] = await db
      .insert(processingRuns)
      .values({ documentId: seeded.documentId, version: 1, pipelineVersion: "v3", status: "complete", isPublished: true, aiCostUsd: publishedSpend })
      .returning({ id: processingRuns.id });
    await db.insert(aiUsageLogs).values({
      documentId: seeded.documentId,
      runId: publishedRun.id,
      task: "relationship_classification",
      stage: "classification",
      provider: "openai",
      model: FIXTURE_MODEL,
      promptTokens: FIXTURE_PROMPT_TOKENS * 6,
      completionTokens: FIXTURE_COMPLETION_TOKENS * 6,
      estimatedCostUsd: publishedSpend,
    });

    const doiD = `10.1234/${tag}-d`;
    cleanupDois.push(doiD);
    const resourceD = fixtureResource({ doi: doiD, title: "Cost Ledger Source D", url: `https://fixture.invalid/${tag}/d` });
    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "explicit_citation", queries: ["cost ledger fixture"] }],
      usedModel: false,
      promptTokens: 0,
      completionTokens: 0,
    });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));
    researchMock.runDiscovery.mockResolvedValue({ resources: [resourceD], attempts: [], laneByKey: new Map(), rounds: 1, saturationNote: null });
    classifyMock.classifyRelationship.mockResolvedValue(paidClassification());

    const [reprocessRun] = await db.insert(processingRuns).values({ documentId: seeded.documentId, version: 2, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });
    await analyzeEditionRun({ runId: reprocessRun.id, documentId: seeded.documentId, text: seeded.extractedText, pipeline: "v3" });

    const [reprocessRow] = await db
      .select({ aiCostUsd: processingRuns.aiCostUsd, degraded: processingRuns.degraded })
      .from(processingRuns)
      .where(eq(processingRuns.id, reprocessRun.id));
    // Own spend only ($0.25) — proves the $1.50 published spend was not
    // folded into this run's persisted cost either.
    expect(reprocessRow.aiCostUsd).toBeCloseTo(EXPECTED_COST_PER_CALL, 6);
    // The real proof of the seed-scope fix: if the published run's $1.50 had
    // been seeded (the pre-fix behavior, which joined on documentId alone
    // with no status filter), `overSoftCap` would already have been true
    // before this run did any work of its own, and it would report degraded
    // regardless of how little this run itself spent. Fixed, honest
    // behavior is a fresh budget that only this run's own $0.25 can trip —
    // which, against the $0.40 soft cap, it does not.
    expect(reprocessRow.degraded).toBe(false);
  });

  it("does NOT seed a reprocess's budget from a FAILED run that occurred BEFORE a later PUBLISH — a publish resets the crash episode (round-2 episode scoping)", async () => {
    const tag = crypto.randomUUID();
    const seeded = await seedDocument(tag);
    cleanupUserIds.push(seeded.userId);

    // v1: a genuine crash-loop failure, well above this file's $0.40 pinned
    // soft cap — exactly the shape the round-1 fix already seeds correctly
    // WHEN it is the most recent thing that happened to this document.
    const [failedRun] = await db
      .insert(processingRuns)
      .values({ documentId: seeded.documentId, version: 1, pipelineVersion: "v3", status: "failed", aiCostUsd: 1.5 })
      .returning({ id: processingRuns.id });
    await db.insert(aiUsageLogs).values({
      documentId: seeded.documentId,
      runId: failedRun.id,
      task: "relationship_classification",
      stage: "classification",
      provider: "openai",
      model: FIXTURE_MODEL,
      promptTokens: FIXTURE_PROMPT_TOKENS * 6,
      completionTokens: FIXTURE_COMPLETION_TOKENS * 6,
      estimatedCostUsd: 1.5,
    });

    // v2: the document recovered and published — a real edition now exists
    // AFTER the v1 crash. This is the event that must close out v1's episode.
    await db
      .insert(processingRuns)
      .values({ documentId: seeded.documentId, version: 2, pipelineVersion: "v3", status: "complete", isPublished: true });

    const doiE = `10.1234/${tag}-e`;
    cleanupDois.push(doiE);
    const resourceE = fixtureResource({ doi: doiE, title: "Cost Ledger Source E", url: `https://fixture.invalid/${tag}/e` });
    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "explicit_citation", queries: ["cost ledger fixture"] }],
      usedModel: false,
      promptTokens: 0,
      completionTokens: 0,
    });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));
    researchMock.runDiscovery.mockResolvedValue({ resources: [resourceE], attempts: [], laneByKey: new Map(), rounds: 1, saturationNote: null });
    classifyMock.classifyRelationship.mockResolvedValue(paidClassification());

    // v3: the reprocess AFTER the publish. Its version (3) is greater than
    // v1's (1) — under the pre-fix, non-episode-scoped predicate this v1
    // spend would still have counted (it IS a failed run of this document);
    // the fix's version floor (episodeStartVersion = 2, from v2's complete
    // status) is what correctly excludes it here.
    const [reprocessRun] = await db.insert(processingRuns).values({ documentId: seeded.documentId, version: 3, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });
    await analyzeEditionRun({ runId: reprocessRun.id, documentId: seeded.documentId, text: seeded.extractedText, pipeline: "v3" });

    const [reprocessRow] = await db
      .select({ aiCostUsd: processingRuns.aiCostUsd, degraded: processingRuns.degraded })
      .from(processingRuns)
      .where(eq(processingRuns.id, reprocessRun.id));
    // Own spend only ($0.25) — the $1.50 pre-publish crash spend was not
    // folded into this run's persisted cost.
    expect(reprocessRow.aiCostUsd).toBeCloseTo(EXPECTED_COST_PER_CALL, 6);
    // The decisive assertion: NOT degraded at start. If v1's $1.50 had been
    // seeded (the bug this round-2 fix closes — "failed run of this
    // document" alone, with no episode/version floor), `overSoftCap` would
    // already have been true before this run spent a cent of its own, and
    // this run would report degraded regardless of how little it itself
    // cost. A fresh, correctly-reset budget only this run's own $0.25 can
    // trip — which, against the $0.40 soft cap, it does not.
    expect(reprocessRow.degraded).toBe(false);
    // Annotations not skipped: the run's own real work — writing an
    // edition_relation for the one accepted candidate — actually happened,
    // rather than the pipeline treating itself as already out of budget and
    // bailing out of its normal per-candidate writes.
    const relations = await db.select({ id: editionRelations.id }).from(editionRelations).where(eq(editionRelations.runId, reprocessRun.id));
    expect(relations.length).toBeGreaterThan(0);
  });

  it("accumulates spend across MULTIPLE failed runs within the same still-open episode, then resets to $0 once one of them (or a later run) publishes", async () => {
    const tag = crypto.randomUUID();
    const seeded = await seedDocument(tag);
    cleanupUserIds.push(seeded.userId);

    // Two failed runs, same open episode (no complete run yet). Each is
    // individually BELOW the $0.40 soft cap on its own ($0.10), so the
    // episode-accumulation claim can only be proven if BOTH are summed:
    // seed alone ($0.20) is still under cap, but seed + this run's own real
    // $0.25 spend ($0.45) crosses it. If the fix only counted one of the two
    // failed runs, the seed ($0.10) + own spend ($0.25) would total $0.35 —
    // under cap, `degraded` would wrongly read false.
    const [failedRunOne] = await db
      .insert(processingRuns)
      .values({ documentId: seeded.documentId, version: 1, pipelineVersion: "v3", status: "failed", aiCostUsd: 0.1 })
      .returning({ id: processingRuns.id });
    const [failedRunTwo] = await db
      .insert(processingRuns)
      .values({ documentId: seeded.documentId, version: 2, pipelineVersion: "v3", status: "failed", aiCostUsd: 0.1 })
      .returning({ id: processingRuns.id });
    await db.insert(aiUsageLogs).values([
      {
        documentId: seeded.documentId,
        runId: failedRunOne.id,
        task: "relationship_classification",
        stage: "classification",
        provider: "openai",
        model: FIXTURE_MODEL,
        promptTokens: 1,
        completionTokens: 1,
        estimatedCostUsd: 0.1,
      },
      {
        documentId: seeded.documentId,
        runId: failedRunTwo.id,
        task: "relationship_classification",
        stage: "classification",
        provider: "openai",
        model: FIXTURE_MODEL,
        promptTokens: 1,
        completionTokens: 1,
        estimatedCostUsd: 0.1,
      },
    ]);

    const doiF = `10.1234/${tag}-f`;
    const doiG = `10.1234/${tag}-g`;
    cleanupDois.push(doiF, doiG);
    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "explicit_citation", queries: ["cost ledger fixture"] }],
      usedModel: false,
      promptTokens: 0,
      completionTokens: 0,
    });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));
    classifyMock.classifyRelationship.mockResolvedValue(paidClassification());

    // v3: seeds from BOTH v1 and v2 (episodeStartVersion is still 0 — no
    // complete run exists yet), so this run must come out degraded.
    researchMock.runDiscovery.mockResolvedValue({
      resources: [fixtureResource({ doi: doiF, title: "Cost Ledger Source F", url: `https://fixture.invalid/${tag}/f` })],
      attempts: [],
      laneByKey: new Map(),
      rounds: 1,
      saturationNote: null,
    });
    const [runThree] = await db.insert(processingRuns).values({ documentId: seeded.documentId, version: 3, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });
    await analyzeEditionRun({ runId: runThree.id, documentId: seeded.documentId, text: seeded.extractedText, pipeline: "v3" });

    const [runThreeRow] = await db
      .select({ aiCostUsd: processingRuns.aiCostUsd, degraded: processingRuns.degraded })
      .from(processingRuns)
      .where(eq(processingRuns.id, runThree.id));
    expect(runThreeRow.aiCostUsd).toBeCloseTo(EXPECTED_COST_PER_CALL, 6);
    expect(runThreeRow.degraded).toBe(true);

    // The publish: v3 itself is now marked complete/published, closing out
    // the v1+v2 crash episode.
    await db.update(processingRuns).set({ status: "complete", isPublished: true }).where(eq(processingRuns.id, runThree.id));

    // v5 (numbering intentionally skips v4 — irrelevant to the predicate,
    // which only compares versions, not adjacency): a reprocess after the
    // publish above. v1/v2's versions (1, 2) are both <= v3's version (3),
    // so neither counts anymore — the episode reset to $0.
    researchMock.runDiscovery.mockResolvedValue({
      resources: [fixtureResource({ doi: doiG, title: "Cost Ledger Source G", url: `https://fixture.invalid/${tag}/g` })],
      attempts: [],
      laneByKey: new Map(),
      rounds: 1,
      saturationNote: null,
    });
    const [runFive] = await db.insert(processingRuns).values({ documentId: seeded.documentId, version: 5, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });
    await analyzeEditionRun({ runId: runFive.id, documentId: seeded.documentId, text: seeded.extractedText, pipeline: "v3" });

    const [runFiveRow] = await db
      .select({ aiCostUsd: processingRuns.aiCostUsd, degraded: processingRuns.degraded })
      .from(processingRuns)
      .where(eq(processingRuns.id, runFive.id));
    expect(runFiveRow.aiCostUsd).toBeCloseTo(EXPECTED_COST_PER_CALL, 6);
    expect(runFiveRow.degraded).toBe(false);
  });
});
