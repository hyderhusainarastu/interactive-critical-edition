import {
  credibilityAssessments,
  db,
  documents,
  editionRelations,
  graphEdges,
  learningResources,
  processingRuns,
  researchResources,
  resourceRoles,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { and, eq, inArray } from "drizzle-orm";
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
vi.mock("@ice/ai-adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ice/ai-adapters")>();
  return {
    ...actual,
    // Guarantees this integration test cannot make an AI/provider call even
    // if a developer has credentials in their local environment.
    OpenAIResponsesClient: class { available = false; },
    classifyRelationship: vi.fn(async () => ({
      category: "interpretive_aid",
      explanation: "Deterministic public-source fixture.",
      confidence: 0.8,
      provider: "heuristic",
      model: "heuristic-fixture",
      promptTokens: 0,
      completionTokens: 0,
      heuristic: true,
    })),
  };
});

import { analyzeEditionRun } from "./analyze";

const hasDb = Boolean(process.env.DATABASE_URL);
const cleanup = { userId: "", resourceIds: [] as string[], identityIds: [] as string[] };

describe.skipIf(!hasDb)("public-source worker projection", () => {
  afterEach(async () => {
    researchMock.generateLaneQueries.mockReset();
    researchMock.runDiscovery.mockReset();
    researchMock.assessCandidate.mockReset();
    if (cleanup.userId) await db.delete(users).where(eq(users.id, cleanup.userId));
    if (cleanup.resourceIds.length) await db.delete(learningResources).where(inArray(learningResources.id, cleanup.resourceIds));
    if (cleanup.identityIds.length) await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
    cleanup.userId = "";
    cleanup.resourceIds = [];
    cleanup.identityIds = [];
  });

  it("keeps one relevant YouTube, Mastodon, and Bluesky result as supplementary D/E Library and graph data", async () => {
    const [user] = await db.insert(users).values({ email: `public-projection-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanup.userId = user.id;
    const [work] = await db.insert(works).values({ userId: user.id, title: "Vice and Reason", authorName: "Terence Irwin" }).returning({ id: works.id });
    const [document] = await db.insert(documents).values({
      userId: user.id, workId: work.id, storagePath: `fixtures/${work.id}/public.txt`, originalFilename: "public.txt",
      mimeType: "text/plain", fileSize: 80, processingStatus: "ready", extractedText: "Vice and reason is discussed in this uploaded work.",
    }).returning({ id: documents.id });
    const [run] = await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v3", status: "running" }).returning({ id: processingRuns.id });

    const sources = [
      { provider: "youtube" as const, resourceType: "video", title: "Vice and Reason lecture", authority: "D" },
      { provider: "mastodon" as const, resourceType: "social_post", title: "Vice and Reason Mastodon discussion", authority: "E" },
      { provider: "bluesky" as const, resourceType: "social_post", title: "Vice and Reason Bluesky discussion", authority: "E" },
    ].map((source) => ({
      ...source,
      authors: [], year: null, doi: null, isbn: null,
      url: `https://fixture.invalid/${source.provider}/vice-reason`,
      snippet: "A relevant supplementary discussion of Vice and Reason.", venue: null, popularity: null, raw: { fixture: true },
    }));
    researchMock.generateLaneQueries.mockResolvedValue({
      lanes: [{ lane: "public_discussion", queries: ["vice and reason discussion"] }],
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

    await analyzeEditionRun({ runId: run.id, documentId: document.id, text: "Vice and reason is discussed in this uploaded work.", pipeline: "v3" });

    const projected = await db.select().from(researchResources).where(eq(researchResources.runId, run.id));
    expect(projected).toHaveLength(3);
    expect(projected.every((resource) => resource.bibRecordId === null)).toBe(true);
    const resourceIds = projected.map((resource) => resource.id);
    const credibility = await db.select().from(credibilityAssessments).where(inArray(credibilityAssessments.resourceId, resourceIds));
    expect(credibility.map((row) => [projected.find((resource) => resource.id === row.resourceId)!.provider, row.authority]).sort()).toEqual([
      ["bluesky", "E"], ["mastodon", "E"], ["youtube", "D"],
    ]);
    const graphRelations = await db.select().from(editionRelations).where(inArray(editionRelations.resourceId, resourceIds));
    expect(graphRelations).toHaveLength(3);
    expect(await db.select().from(graphEdges).where(eq(graphEdges.userId, user.id))).toHaveLength(0);

    const library = await db.select().from(learningResources).where(inArray(learningResources.provider, ["youtube", "mastodon", "bluesky"]));
    cleanup.resourceIds = library.map((resource) => resource.id);
    expect(library).toHaveLength(3);
    expect(library.every((resource) => resource.peerReviewed === false && resource.bibRecordId === null)).toBe(true);
    const roles = await db.select().from(resourceRoles).where(inArray(resourceRoles.learningResourceId, cleanup.resourceIds));
    expect(roles).toHaveLength(3);
    cleanup.identityIds = [...new Set([...library.map((resource) => resource.workIdentityId), ...roles.map((role) => role.workIdentityId)].filter((id): id is string => Boolean(id)))];
  });
});
