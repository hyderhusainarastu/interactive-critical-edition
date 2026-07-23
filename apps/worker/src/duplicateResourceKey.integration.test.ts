/**
 * Regression for the "floors2" production crash (see
 * `docs/incidents/`/the crash-analysis report folded into the register as
 * D-23-xx): `analyzeEditionRun`'s main ranked-loop insert into
 * `research_resource` had no conflict guard, unlike the independent
 * citation-resolution bridge insert in the same file
 * (`buildCitationBridgeResource`/`resolveCitationMetadata`, guarded since
 * floors §2.3). Two independently-accepted candidates in the SAME run can
 * legitimately compute the identical (run_id, normalized_key) pair — e.g. a
 * primary edition and a review of it that both carry the same DOI — via
 * `deriveWorkIdentity`, with DIFFERENT `work_role`/`work_evidence`. Before
 * this fix, the second insert threw `research_resource_run_key_unique`,
 * crashing the whole job (pg-boss retried it 3x, 2 job types, for 6 total
 * crashed attempts on the real incident). This test reproduces that exact
 * collision shape against a real Postgres and asserts the run completes
 * with the honest "first-in wins, skip and log" resolution instead of
 * throwing.
 */
import {
  bibliographicRecords,
  db,
  documents,
  processingRuns,
  researchResources,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe.skipIf(!hasDb)("analyzeEditionRun duplicate research_resource key (floors2 crash regression)", () => {
  const cleanupUserId = { value: "" };

  afterEach(async () => {
    researchMock.generateLaneQueries.mockReset();
    researchMock.runDiscovery.mockReset();
    researchMock.assessCandidate.mockReset();
    classifyMock.classifyRelationship.mockReset();
    if (cleanupUserId.value) await db.delete(users).where(eq(users.id, cleanupUserId.value));
    cleanupUserId.value = "";
  });

  it("skips the colliding candidate and logs a structured warning instead of crashing the run", async () => {
    const [user] = await db.insert(users).values({ email: `dup-resource-key-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanupUserId.value = user.id;
    const [work] = await db.insert(works).values({ userId: user.id, title: "Vice and Reason", authorName: "Terence Irwin" }).returning({ id: works.id });
    const extractedText = "Vice and reason is discussed at length in this uploaded work, citing Aristotle's First Principles throughout.";
    const [document] = await db.insert(documents).values({
      userId: user.id,
      workId: work.id,
      storagePath: `fixtures/${work.id}/dup-key.txt`,
      originalFilename: "dup-key.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      extractedText,
    }).returning({ id: documents.id });

    // The exact collision shape from the incident: two independently-
    // discovered/accepted candidates share the SAME DOI (so `normalizedKey`
    // resolves to the identical `doi:...` string for both), but one is the
    // primary edition and the other is a review of it — different titles,
    // different `deriveWorkIdentity` role, same normalized key.
    const sharedDoi = `10.2307/${crypto.randomUUID().slice(0, 8)}`;
    const primaryCandidate = {
      provider: "openalex" as const,
      resourceType: "book" as const,
      title: "Aristotle's First Principles",
      authors: ["Terence Irwin"],
      year: 1990,
      doi: sharedDoi,
      isbn: null,
      url: "https://fixture.invalid/aristotle-first-principles-primary",
      snippet: "A scholarly discussion cited throughout the uploaded work.",
      venue: null,
      popularity: null,
      raw: { fixture: true },
    };
    const reviewCandidate = {
      provider: "crossref" as const,
      resourceType: "article" as const,
      // "Review:" prefix drives deriveWorkIdentity's role to "review" instead
      // of "primary" — the second half of the real collision (same DOI,
      // different work_role).
      title: "Review: Aristotle's First Principles",
      authors: ["A Reviewer"],
      year: 1991,
      doi: sharedDoi,
      isbn: null,
      url: "https://fixture.invalid/aristotle-first-principles-review",
      snippet: "A review of the same work, filed under the same DOI.",
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
    researchMock.runDiscovery.mockResolvedValue({
      resources: [primaryCandidate, reviewCandidate],
      attempts: [],
      laneByKey: new Map(),
      rounds: 1,
      saturationNote: null,
    });
    researchMock.assessCandidate.mockImplementation((source: { url: string }) => ({
      normalizedKey: source.url,
      verdict: "accepted",
      confidence: 0.9,
      reasons: ["fixture relevance"],
      signals: { titleMatch: true },
      venueReliable: false,
    }));
    classifyMock.classifyRelationship.mockResolvedValue(mockClassification("interpretive_aid"));

    const [run] = await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });

    // Before the fix: this rejects with a Postgres unique-constraint
    // violation on research_resource_run_key_unique (the exact production
    // crash). After the fix: it resolves cleanly.
    await expect(analyzeEditionRun({ runId: run.id, documentId: document.id, text: extractedText, pipeline: "v3" })).resolves.toBeUndefined();

    const rows = await db.select().from(researchResources).where(eq(researchResources.runId, run.id));
    // Exactly one row for the colliding key — the second candidate was
    // skipped, not silently merged into a second row (impossible anyway,
    // the DB constraint forbids it) and not crashed on.
    expect(rows).toHaveLength(1);
    expect(rows[0].doi).toBe(sharedDoi);
    // First-in wins: the primary candidate (processed first, since both are
    // equally-ranked "generic" candidates and Array#sort is stable) is the
    // row that survives, not the review that collided with it.
    expect(rows[0].workRole).toBe("primary");
    expect(rows[0].title).toBe(primaryCandidate.title);

    const [bibRow] = await db.select({ id: bibliographicRecords.id }).from(bibliographicRecords).where(eq(bibliographicRecords.doi, sharedDoi));
    if (bibRow) await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, bibRow.id));
  });
});
