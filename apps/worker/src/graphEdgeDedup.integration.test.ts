import {
  db,
  documents,
  graphEdges,
  processingRuns,
  users,
  works,
} from "@ice/db";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression for D-21-6 (`docs/audits/phase-21-visualization-audit.md`):
 * `analyzeEditionRun`'s work→bibliographic_record classification edge insert
 * (the live production edition-pipeline path, unlike the legacy `analyzeWork`)
 * had no existence guard at all, so reprocessing the same document duplicated
 * the classification `graph_edge` every run — and worse, a run that changed a
 * reference's classified category (the exact kind of fix Phase 11.7 made in
 * production) would leave the STALE, superseded edge sitting alongside the
 * new one rather than being replaced, so Visualization could show a work as
 * simultaneously e.g. both disagreeing with AND prerequisite to the same
 * reference. This mirrors the guarded pattern already proven for the concept
 * edge three lines above the bug (`concepts.integration.test.ts`), but must
 * NOT key on `edgeType` the way the citation-edge guard does (`analyze.ts`
 * `resolveCitationMetadata`) — that edge type never changes across runs,
 * while a classification's edgeType is exactly what a reclassification
 * changes, so an edgeType-scoped key would miss the very case this bug is
 * about.
 */

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
    // No real AI/provider call, even if a developer has local credentials.
    OpenAIResponsesClient: class { available = false; },
    classifyRelationship: classifyMock.classifyRelationship,
  };
});

import { analyzeEditionRun } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);

function mockClassification(category: string) {
  return {
    category,
    explanation: "Deterministic fixture.",
    confidence: 0.7,
    provider: "heuristic",
    model: "heuristic-fixture",
    promptTokens: 0,
    completionTokens: 0,
    heuristic: true,
  };
}

describe.skipIf(!hasDb)("analyzeEditionRun classification graph_edge dedup (D-21-6)", () => {
  const cleanupUserId = { value: "" };

  afterEach(async () => {
    researchMock.generateLaneQueries.mockReset();
    researchMock.runDiscovery.mockReset();
    researchMock.assessCandidate.mockReset();
    classifyMock.classifyRelationship.mockReset();
    if (cleanupUserId.value) await db.delete(users).where(eq(users.id, cleanupUserId.value));
    cleanupUserId.value = "";
  });

  it("replaces, rather than duplicates, the work→bibliographic_record classification edge when a reprocess changes the classified category", async () => {
    const [user] = await db.insert(users).values({ email: `graph-edge-dedup-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanupUserId.value = user.id;
    const [work] = await db.insert(works).values({ userId: user.id, title: "Vice and Reason", authorName: "Terence Irwin" }).returning({ id: works.id });
    const extractedText = "Vice and reason is discussed at length in this uploaded work.";
    const [document] = await db.insert(documents).values({
      userId: user.id,
      workId: work.id,
      storagePath: `fixtures/${work.id}/dedup.txt`,
      originalFilename: "dedup.txt",
      mimeType: "text/plain",
      fileSize: 80,
      processingStatus: "ready",
      extractedText,
    }).returning({ id: documents.id });

    const doi = `10.9999/${crypto.randomUUID()}`;
    const scholarlyResource = {
      provider: "crossref" as const,
      resourceType: "book" as const,
      title: "Aristotle's First Principles",
      authors: ["Terence Irwin"],
      year: 1990,
      doi,
      isbn: null,
      url: `https://fixture.invalid/aristotle-first-principles`,
      snippet: "A scholarly discussion cited throughout the uploaded work.",
      venue: null,
      popularity: null,
      raw: { fixture: true },
    };

    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "explicit_citation", queries: ["aristotle first principles"] }],
      usedModel: false,
      promptTokens: 0,
      completionTokens: 0,
    });
    researchMock.runDiscovery.mockResolvedValue({ resources: [scholarlyResource], attempts: [], laneByKey: new Map(), rounds: 1, saturationNote: null });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));

    // --- Run 1: classified as "disagreement_polemical_target" ---
    classifyMock.classifyRelationship.mockResolvedValueOnce(mockClassification("disagreement_polemical_target"));
    const [runOne] = await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });
    await analyzeEditionRun({ runId: runOne.id, documentId: document.id, text: extractedText, pipeline: "v3" });

    const edgesAfterFirstRun = await db.select().from(graphEdges).where(and(eq(graphEdges.userId, user.id), eq(graphEdges.sourceId, work.id), eq(graphEdges.targetType, "bibliographic_record")));
    expect(edgesAfterFirstRun).toHaveLength(1);
    expect(edgesAfterFirstRun[0].edgeType).toBe("disagrees_with");
    const bibId = edgesAfterFirstRun[0].targetId;

    // --- Run 2 (reprocess of the SAME document): reclassified to "prerequisite" ---
    classifyMock.classifyRelationship.mockResolvedValueOnce(mockClassification("prerequisite"));
    const [runTwo] = await db.insert(processingRuns).values({ documentId: document.id, version: 2, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });
    await analyzeEditionRun({ runId: runTwo.id, documentId: document.id, text: extractedText, pipeline: "v3" });

    const edgesAfterSecondRun = await db.select().from(graphEdges).where(and(eq(graphEdges.userId, user.id), eq(graphEdges.sourceId, work.id), eq(graphEdges.targetType, "bibliographic_record")));
    // The bug: without a guard, this would be length 2 — the stale
    // "disagrees_with" edge left alongside a new "is_prerequisite_for" one.
    expect(edgesAfterSecondRun).toHaveLength(1);
    expect(edgesAfterSecondRun[0].targetId).toBe(bibId);
    // The fix must supersede, not just skip: the surviving edge reflects the
    // LATEST run's category, not the first run's stale one.
    expect(edgesAfterSecondRun[0].edgeType).toBe("is_prerequisite_for");
  });
});
