import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 20.5 "budget stop": a (re)process run under a zero cost budget must
 * start NO paid work — every synthesis entry point is a tripwire mock that
 * fails the test if invoked — while still completing as an honestly degraded
 * run (deterministic grounded notes, degraded=true, $0 recorded). This is
 * the same `makeBudget()`/`canAfford`/`overSoftCap` machinery every
 * reprocess run re-enters (handleEditionExtraction → analyzeEditionRun), so
 * this proves reprocessing is cost-gated exactly like a first upload.
 *
 * The caps are wired through the environment BEFORE any module loads:
 * RESEARCH_LIMITS captures process.env at import time.
 */
vi.hoisted(() => {
  process.env.RESEARCH_COST_SOFT_CAP = "0";
  process.env.RESEARCH_COST_HARD_CAP = "0";
  process.env.PHASE_18_RAG_ENABLED = "false";
});

const researchMock = vi.hoisted(() => ({
  generateLaneQueries: vi.fn(),
  runDiscovery: vi.fn(),
  assessCandidate: vi.fn(),
  synthesizeNote: vi.fn(),
  synthesizeConcepts: vi.fn(),
  synthesizePassageAnnotations: vi.fn(),
}));
vi.mock("@ice/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/research")>()),
  allAdapters: () => [],
  generateLaneQueries: researchMock.generateLaneQueries,
  runDiscovery: researchMock.runDiscovery,
  assessCandidate: researchMock.assessCandidate,
  synthesizeNote: researchMock.synthesizeNote,
  synthesizeConcepts: researchMock.synthesizeConcepts,
  synthesizePassageAnnotations: researchMock.synthesizePassageAnnotations,
}));
vi.mock("@ice/ai-adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ice/ai-adapters")>();
  return {
    ...actual,
    // available=true makes the budget gate the ONLY thing standing between
    // the pipeline and a paid call — exactly what this test is about.
    OpenAIResponsesClient: class { available = true; },
    classifyRelationship: vi.fn(async () => ({
      category: "interpretive_aid",
      explanation: "Deterministic budget-stop fixture.",
      confidence: 0.8,
      provider: "heuristic",
      model: "heuristic-fixture",
      promptTokens: 0,
      completionTokens: 0,
      heuristic: true,
    })),
  };
});

import { aiUsageLogs, db, documents, generatedNotes, learningResources, processingRuns, researchResources, users, workIdentities, works } from "@ice/db";
import { eq, inArray } from "drizzle-orm";
import { analyzeEditionRun } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);
const cleanup = { userId: "", resourceIds: [] as string[], identityIds: [] as string[] };

describe.skipIf(!hasDb)("budget stop (integration)", () => {
  afterEach(async () => {
    researchMock.generateLaneQueries.mockReset();
    researchMock.runDiscovery.mockReset();
    researchMock.assessCandidate.mockReset();
    researchMock.synthesizeNote.mockReset();
    researchMock.synthesizeConcepts.mockReset();
    researchMock.synthesizePassageAnnotations.mockReset();
    if (cleanup.userId) await db.delete(users).where(eq(users.id, cleanup.userId));
    if (cleanup.resourceIds.length) await db.delete(learningResources).where(inArray(learningResources.id, cleanup.resourceIds));
    if (cleanup.identityIds.length) await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
    cleanup.userId = "";
    cleanup.resourceIds = [];
    cleanup.identityIds = [];
  });

  it("a zero cost cap stops every paid synthesis call while the run still completes degraded at $0", async () => {
    // Unique per run: a fixture title shared with another test file would
    // share a derived work_identity row, and this test's cleanup would
    // delete it out from under that file mid-flight (vitest runs files in
    // parallel against the one shared local database).
    const fixtureTag = crypto.randomUUID();
    const primaryTitle = `Budget Stop Primary ${fixtureTag}`;
    const lectureTitle = `Budget Stop Lecture ${fixtureTag}`;
    const [user] = await db.insert(users).values({ email: `budget-stop-${fixtureTag}@example.com` }).returning({ id: users.id });
    cleanup.userId = user.id;
    const [work] = await db.insert(works).values({ userId: user.id, title: primaryTitle, authorName: "Fixture Author" }).returning({ id: works.id });
    const [document] = await db.insert(documents).values({
      userId: user.id, workId: work.id, storagePath: `fixtures/${work.id}/budget.txt`, originalFilename: "budget.txt",
      mimeType: "text/plain", fileSize: 80, processingStatus: "ready", extractedText: "This fixture text names no other scholarly source.",
    }).returning({ id: documents.id });
    const [run] = await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });

    const sources = [
      { provider: "youtube" as const, resourceType: "video", title: lectureTitle, authority: "D" },
    ].map((source) => ({
      ...source,
      authors: [], year: null, doi: null, isbn: null,
      url: `https://fixture.invalid/${source.provider}/${fixtureTag}`,
      snippet: `A relevant supplementary discussion of ${primaryTitle}.`, venue: null, popularity: null, raw: { fixture: true },
    }));
    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "public_discussion", queries: [`${primaryTitle} discussion`] }],
      usedModel: false, promptTokens: 0, completionTokens: 0,
    });
    researchMock.runDiscovery.mockResolvedValue({ resources: sources, attempts: [], laneByKey: new Map(), rounds: 1, saturationNote: null });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));
    const tripwire = (name: string) => async () => {
      throw new Error(`${name} was invoked — a paid call started despite a zero budget`);
    };
    researchMock.synthesizeNote.mockImplementation(tripwire("synthesizeNote"));
    researchMock.synthesizeConcepts.mockImplementation(tripwire("synthesizeConcepts"));
    researchMock.synthesizePassageAnnotations.mockImplementation(tripwire("synthesizePassageAnnotations"));

    await analyzeEditionRun({ runId: run.id, documentId: document.id, text: "This fixture text names no other scholarly source.", pipeline: "v3" });

    expect(researchMock.synthesizeNote).not.toHaveBeenCalled();
    expect(researchMock.synthesizeConcepts).not.toHaveBeenCalled();
    expect(researchMock.synthesizePassageAnnotations).not.toHaveBeenCalled();

    const [finished] = await db
      .select({ degraded: processingRuns.degraded, aiCostUsd: processingRuns.aiCostUsd })
      .from(processingRuns)
      .where(eq(processingRuns.id, run.id));
    expect(finished.degraded).toBe(true); // honest degraded state, not a fake full run
    expect(finished.aiCostUsd).toBe(0);

    const usage = await db.select({ cost: aiUsageLogs.estimatedCostUsd }).from(aiUsageLogs).where(eq(aiUsageLogs.runId, run.id));
    expect(usage.every((row) => row.cost === 0)).toBe(true);

    // The run still records its discovered resource with a deterministic
    // grounded note — budget stop degrades, it does not destroy.
    const projected = await db.select({ id: researchResources.id }).from(researchResources).where(eq(researchResources.runId, run.id));
    expect(projected).toHaveLength(1);
    const notes = await db.select({ body: generatedNotes.body }).from(generatedNotes).where(eq(generatedNotes.runId, run.id));
    expect(notes).toHaveLength(1);
    expect(notes[0].body.length).toBeGreaterThan(0);

    // Scoped by exact fixture title — the local dev DB is shared, so a
    // provider-wide sweep could delete real data.
    const library = await db.select({ id: learningResources.id, workIdentityId: learningResources.workIdentityId }).from(learningResources).where(eq(learningResources.title, lectureTitle));
    cleanup.resourceIds = library.map((resource) => resource.id);
    const [workRow] = await db.select({ workIdentityId: works.workIdentityId }).from(works).where(eq(works.id, work.id));
    cleanup.identityIds = [...new Set([workRow?.workIdentityId, ...library.map((resource) => resource.workIdentityId)].filter((id): id is string => Boolean(id)))];
  });
});
