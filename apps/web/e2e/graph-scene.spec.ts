import { expect, test } from "@playwright/test";
import { bibliographicRecords, concepts, db, documents, graphEdges, works } from "@ice/db";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 21.4/21.5 E2E (D-21-9's server-side fixable half). WebGL scene
 * internals (node/label scaling, edge label sprites, direction cues) are
 * NOT E2E-assertable — those are covered by pure-function unit tests in
 * `apps/web/src/components/graph/graphSceneScaling.test.ts` and
 * `apps/web/src/lib/graphEdgeCategory.test.ts` (run via bare `tsx`, see
 * each file's own doc comment). What IS assertable end-to-end is the
 * `/api/works/:id/graph` payload's `category` field for the two edge_type
 * strings that never carry one in `evidence` at write time — this is the
 * ONLY part of D-21-9 fixed in `apps/web/src/lib/graph.ts` (never
 * `apps/worker/src/analyze.ts`, out of scope here).
 *
 * The fixture is a MINIMAL, deliberately hand-inserted `graph_edge` row
 * shape (not `seedWorkWithGraphData()`, which — unlike the real
 * `resolveCitation()`/concept-edge write paths in `analyze.ts` — already
 * seeds its "cites" edge WITH `evidence: { category: "explicit_reference"
 * }`, so it would not exercise this fix at all). This mirrors the REAL
 * production write shape instead: `evidence` with no `category` key.
 */

const EMAIL = `e2e-graph-scene-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** `getOwnedDocument()` (`/api/works/:id/graph`'s ownership gate) requires a
 *  real `document` row, not just a `work` row — a minimal one is enough
 *  since `buildGraph()`'s edge/concept queries never join through it. */
async function seedMinimalWork(title: string): Promise<string> {
  const [work] = await db.insert(works).values({ userId, title, authorName: "Test Author" }).returning({ id: works.id });
  await db.insert(documents).values({
    userId, workId: work.id,
    storagePath: `${userId}/${work.id}/graph-scene.txt`,
    originalFilename: "graph-scene.txt",
    mimeType: "text/plain",
    fileSize: 42,
    processingStatus: "ready",
    analysisStatus: "complete",
    extractedText: "D-21-9 fixture text.",
  });
  return work.id;
}

test.describe("Visualization scene data contract (D-21-9)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("citation and concept edges with no evidence category get one derived, never fabricated for other edge types", async ({ page }) => {
    const workId = await seedMinimalWork("D-21-9 fixture work");
    const [bib] = await db
      .insert(bibliographicRecords)
      .values({ source: "crossref", title: "D-21-9 cited work", authors: "Cited Author", year: 1999, accessStatus: "metadata_only" })
      .returning({ id: bibliographicRecords.id });
    const [concept] = await db
      .insert(concepts)
      .values({ slug: `d-21-9-concept-${workId}`, kind: "concept", label: "D-21-9 concept" })
      .returning({ id: concepts.id });

    // The REAL `resolveCitation()`/concept-edge write shape: no `category`
    // key in `evidence` at all — matches `analyze.ts:559-570` and
    // `analyze.ts:~1269-1279` exactly, not `seedWorkWithGraphData()`'s
    // already-categorized test fixture.
    await db.insert(graphEdges).values([
      {
        userId, sourceType: "work", sourceId: workId, targetType: "bibliographic_record", targetId: bib.id,
        edgeType: "cites", confidence: 0.85, evidence: { citationId: "seeded-citation", sourceType: "footnote" }, createdBy: "system",
      },
      {
        userId, sourceType: "work", sourceId: workId, targetType: "concept", targetId: concept.id,
        edgeType: "presupposes", confidence: 0.8, evidence: { role: "central", reason: "seeded, no category" }, createdBy: "system",
      },
    ]);

    await login(page);
    const response = await page.request.get(`/api/works/${workId}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as {
      links: { source: string; target: string; edgeType: string; category: string | null }[];
    };

    const citesLink = graph.links.find((link) => link.edgeType === "cites" && link.target === `external:bib:${bib.id}`);
    expect(citesLink).toBeTruthy();
    expect(citesLink!.source).toBe(`work:${workId}`);
    // D-21-9: derived, not fabricated — "cites" unambiguously means
    // explicit_reference at this write site.
    expect(citesLink!.category).toBe("explicit_reference");

    const presupposesLink = graph.links.find((link) => link.edgeType === "presupposes" && link.target === `concept:${concept.id}`);
    expect(presupposesLink).toBeTruthy();
    expect(presupposesLink!.source).toBe(`work:${workId}`);
    expect(presupposesLink!.category).toBe("prerequisite");
  });

  test("an edge type outside the two unambiguous cases stays null rather than guessing a category", async ({ page }) => {
    const workId = await seedMinimalWork("D-21-9 no-category fixture");
    const [bib] = await db
      .insert(bibliographicRecords)
      .values({ source: "crossref", title: "D-21-9 responds_to target", authors: "Target Author", year: 2001, accessStatus: "metadata_only" })
      .returning({ id: bibliographicRecords.id });

    // "responds_to" is a real edge_type enum value that is NEVER written by
    // the citation-resolution or concept-extraction paths this fix covers —
    // it must stay null, not be guessed at.
    await db.insert(graphEdges).values({
      userId, sourceType: "work", sourceId: workId, targetType: "bibliographic_record", targetId: bib.id,
      edgeType: "responds_to", confidence: 0.6, evidence: { note: "no category by design" }, createdBy: "system",
    });

    await login(page);
    const response = await page.request.get(`/api/works/${workId}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as { links: { edgeType: string; category: string | null }[] };
    const respondsToLink = graph.links.find((link) => link.edgeType === "responds_to");
    expect(respondsToLink).toBeTruthy();
    expect(respondsToLink!.category).toBeNull();
  });
});
