import { expect, test } from "@playwright/test";
import {
  bibliographicRecords,
  db,
  documents,
  editionRelations,
  graphEdges,
  learningResources,
  processingRuns,
  ragChunks,
  resourceRoles,
  researchResources,
  workIdentities,
  works,
} from "@ice/db";
import { eq, inArray } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "./helpers";

/**
 * Phase 20.6 E2E: canonical-identity display collapse across Library, the
 * Visualization graph payload, and RAG citations. All rows are seeded
 * directly (no worker, no live model call — the same CI-safety approach as
 * library.spec.ts/graph.spec.ts); what's under test is the display contract:
 * one canonical entry per work, reviews/editions attached rather than
 * merged, graph node count collapsed, and RAG citations pointing at the
 * canonical display entry.
 */

const EMAIL = `e2e-canonical-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
/** Rows with no user FK (shared catalog shape) — cleaned explicitly so this
 *  spec doesn't leak orphan identities/resources into the shared local DB. */
const seededIdentityIds: string[] = [];
const seededResourceIds: string[] = [];

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Canonical identity and duplicate collapse (Phase 20.6)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    if (seededResourceIds.length) await db.delete(learningResources).where(inArray(learningResources.id, seededResourceIds));
    if (seededIdentityIds.length) await db.delete(workIdentities).where(inArray(workIdentities.id, seededIdentityIds));
  });

  test("Library shows ONE canonical entry per work with review/edition attached, searchable, across two citing uploads", async ({ page }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    // Two uploads (cross-work duplicate reference: both cite the same book).
    const uploadIdentities: string[] = [];
    for (const title of [`First Citing Work ${suffix}`, `Second Citing Work ${suffix}`]) {
      const [work] = await db.insert(works).values({ userId, title, authorName: "Terence Irwin" }).returning({ id: works.id });
      const [identity] = await db
        .insert(workIdentities)
        .values({ workKey: `work:test:${suffix}:${title}`, canonicalTitle: title, authorSurname: "irwin", evidence: "seeded for canonical test" })
        .returning({ id: workIdentities.id });
      await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, work.id));
      uploadIdentities.push(identity.id);
      seededIdentityIds.push(identity.id);
    }

    // ONE cited canonical work, discovered as three records: the book, a
    // review of it, and a second edition.
    const [citedIdentity] = await db
      .insert(workIdentities)
      .values({ workKey: `work:test:${suffix}:cited`, canonicalTitle: `Ethics with Aristotle ${suffix}`, authorSurname: "broadie", evidence: "seeded for canonical test" })
      .returning({ id: workIdentities.id });
    seededIdentityIds.push(citedIdentity.id);
    const records = [
      { title: `Ethics with Aristotle ${suffix}`, workRole: "primary" as const, isbn: "9780195085600", resourceType: "book" },
      { title: `Review of Ethics with Aristotle ${suffix}`, workRole: "review" as const, isbn: null, resourceType: "article" },
      { title: `Ethics with Aristotle ${suffix}, 2nd edition`, workRole: "edition" as const, isbn: null, resourceType: "book" },
      { title: `Etica con Aristotele ${suffix} (Italian translation)`, workRole: "translation" as const, isbn: null, resourceType: "book" },
    ];
    const resourceIds: string[] = [];
    for (const [index, record] of records.entries()) {
      const [resource] = await db
        .insert(learningResources)
        .values({
          workIdentityId: citedIdentity.id,
          workRole: record.workRole,
          title: record.title,
          normalizedKey: `canonical:${suffix}:${index}`,
          resourceType: record.resourceType,
          provider: "crossref",
          authors: ["Sarah Broadie"],
          isbn: record.isbn,
        })
        .returning({ id: learningResources.id });
      resourceIds.push(resource.id);
      seededResourceIds.push(resource.id);
      // The primary is recommended for BOTH uploads; review/edition for the first.
      const targets = record.workRole === "primary" ? uploadIdentities : [uploadIdentities[0]];
      for (const target of targets) {
        await db.insert(resourceRoles).values({
          learningResourceId: resource.id,
          workIdentityId: target,
          relationship: "prerequisite",
          readerLevel: null,
          rationale: "Seeded canonical-identity fixture.",
          confidence: 0.8,
          createdBy: "system",
        });
      }
    }
    const [primaryId, reviewId, editionId, translationId] = resourceIds;

    await login(page);
    await page.goto("/library");
    const content = page.locator("#main-content");
    await content.getByLabel("Focus work", { exact: true }).selectOption("");

    // ONE canonical entry — the primary record — not three sibling rows.
    const head = content.locator(`[data-library-item="${primaryId}"]`);
    await expect(head).toBeVisible();
    await expect(content.locator(`[data-library-item="${reviewId}"]`)).toHaveCount(0);
    await expect(content.locator(`[data-library-item="${editionId}"]`)).toHaveCount(0);
    await expect(content.locator(`[data-library-item="${translationId}"]`)).toHaveCount(0);

    // Review, edition, and translation are ATTACHED under it, labeled by role.
    const related = head.getByLabel(`Related records for Ethics with Aristotle ${suffix}`);
    await expect(related).toBeVisible();
    await expect(related.locator(`[data-attached-record="${reviewId}"]`)).toContainText("Review");
    await expect(related.locator(`[data-attached-record="${editionId}"]`)).toContainText("Edition");
    await expect(related.locator(`[data-attached-record="${translationId}"]`)).toContainText("Translation");

    // Cross-work duplicate reference: one entry recommended for BOTH uploads.
    await expect(head.getByRole("link", { name: `First Citing Work ${suffix}` })).toBeVisible();
    await expect(head.getByRole("link", { name: `Second Citing Work ${suffix}` })).toBeVisible();

    // Searching for the ATTACHED review's title still finds the canonical entry.
    await content.getByLabel("Search library").fill(`Review of Ethics with Aristotle ${suffix}`);
    await expect(head).toBeVisible();
    await expect(content.locator(`[data-library-item="${primaryId}"]`)).toHaveCount(1);
  });

  test("graph node count collapses: one cited work resolved to two bibliographic records is ONE node, review stays attached", async ({ page }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [work] = await db.insert(works).values({ userId, title: `Graph Canonical Work ${suffix}`, authorName: "Aristotle" }).returning({ id: works.id });
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        workId: work.id,
        storagePath: `${userId}/${work.id}/canonical-graph.txt`,
        originalFilename: "canonical-graph.txt",
        mimeType: "text/plain",
        fileSize: 100,
        processingStatus: "ready",
        analysisStatus: "complete",
        extractedText: "Seeded canonical graph test.",
      })
      .returning({ id: documents.id });
    const [run] = await db
      .insert(processingRuns)
      .values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true })
      .returning({ id: processingRuns.id });

    // The canary-10 defect shape: ONE cited book, accepted twice with TWO
    // bibliographic records (the book and its second edition).
    const [bib1] = await db.insert(bibliographicRecords).values({ source: "crossref", title: "Physics", authors: "Aristotle", accessStatus: "metadata_only" }).returning({ id: bibliographicRecords.id });
    const [bib2] = await db.insert(bibliographicRecords).values({ source: "openlibrary", title: "Physics, 2nd edition", authors: "Aristotle", accessStatus: "metadata_only" }).returning({ id: bibliographicRecords.id });
    const workKey = `work:physics:aristotle:${suffix}`;
    const [primaryResource] = await db.insert(researchResources).values({
      runId: run.id, title: "Physics", provider: "crossref", resourceType: "book",
      bibRecordId: bib1.id, normalizedKey: `canonical-graph-primary-${suffix}`,
      workKey, workRole: "primary", workCanonicalTitle: "Physics", workAuthorSurname: "aristotle", workEvidence: "seeded",
    }).returning({ id: researchResources.id });
    await db.insert(researchResources).values({
      runId: run.id, title: "Physics, 2nd edition", provider: "openlibrary", resourceType: "book",
      bibRecordId: bib2.id, normalizedKey: `canonical-graph-edition-${suffix}`,
      workKey, workRole: "edition", workCanonicalTitle: "Physics", workAuthorSurname: "aristotle", workEvidence: "2nd edition",
    });
    // A review of the same work: SEPARATE node, attached by relation.
    const [reviewResource] = await db.insert(researchResources).values({
      runId: run.id, title: "Physics: a critical review", provider: "openalex", resourceType: "article",
      normalizedKey: `canonical-graph-review-${suffix}`,
      workKey, workRole: "review", workCanonicalTitle: "Physics", workAuthorSurname: "aristotle", workEvidence: "review",
    }).returning({ id: researchResources.id });
    await db.insert(editionRelations).values({
      runId: run.id, resourceId: reviewResource.id, relatedResourceId: primaryResource.id,
      relationType: "review_of", depth: 1, importance: 0.7, evidence: { provenance: "shared_work_identity", workKey }, confidence: 1,
    });
    await db.insert(graphEdges).values([
      { userId, sourceType: "work", sourceId: work.id, targetType: "bibliographic_record", targetId: bib1.id, edgeType: "cites", confidence: 0.9, evidence: { category: "explicit_reference" }, createdBy: "system" },
      { userId, sourceType: "work", sourceId: work.id, targetType: "bibliographic_record", targetId: bib2.id, edgeType: "cites", confidence: 0.9, evidence: { category: "explicit_reference" }, createdBy: "system" },
    ]);

    await login(page);
    const response = await page.request.get(`/api/works/${work.id}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as { nodes: { id: string; label: string; type: string }[]; links: { source: string; target: string; edgeType: string }[] };

    // One canonical node for the work — the second bib record's node is gone.
    // The representative is deterministic: the lexicographically smallest raw id.
    const canonicalId = `external:bib:${[bib1.id, bib2.id].sort()[0]}`;
    const physicsNodes = graph.nodes.filter((node) => node.id === `external:bib:${bib1.id}` || node.id === `external:bib:${bib2.id}`);
    expect(physicsNodes).toHaveLength(1);
    expect(physicsNodes[0].id).toBe(canonicalId);
    // Both citation edges point at the single canonical node.
    const citeLinks = graph.links.filter((link) => link.source === `work:${work.id}` && link.edgeType === "cites");
    expect(citeLinks.every((link) => link.target === canonicalId)).toBeTruthy();
    // The review is a SEPARATE node, attached via its review_of relation.
    const reviewNode = graph.nodes.find((node) => node.label === "Physics: a critical review");
    expect(reviewNode).toBeTruthy();
    expect(graph.links.some((link) => link.source === reviewNode!.id && link.target === canonicalId && link.edgeType === "review_of")).toBeTruthy();
    // No dangling links after the collapse.
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(graph.links.every((link) => nodeIds.has(link.source) && nodeIds.has(link.target))).toBeTruthy();
  });

  test("RAG citations point at the canonical display entry when two uploads share one work identity", async ({ page }) => {
    test.skip(process.env.PHASE_18_RAG_ENABLED !== "true", "requires the local-only Phase 18 RAG gate");
    const suffix = crypto.randomUUID().slice(0, 8);
    // The canonical (earliest) upload of the work.
    const [canonicalWork] = await db
      .insert(works)
      .values({ userId, title: `Canonical Upload Alpha ${suffix}`, authorName: "Terence Irwin", createdAt: new Date(Date.now() - 60_000) })
      .returning({ id: works.id });
    // The duplicate upload — seeded with a published edition so a chunk can
    // anchor to a real text block. Its chunks must CITE under the canonical
    // upload's display title, not its own.
    const seeded = await seedPublishedEdition(userId);
    const [identity] = await db
      .insert(workIdentities)
      .values({ workKey: `work:test:${suffix}:rag`, canonicalTitle: `Canonical Upload Alpha ${suffix}`, authorSurname: "irwin", evidence: "seeded for canonical RAG test" })
      .returning({ id: workIdentities.id });
    seededIdentityIds.push(identity.id);
    await db.update(works).set({ workIdentityId: identity.id }).where(inArray(works.id, [canonicalWork.id, seeded.workId]));

    const marker = `octopus${suffix}`;
    await db.insert(ragChunks).values({
      userId,
      workId: seeded.workId,
      documentId: seeded.documentId,
      processingRunId: seeded.runId,
      textBlockId: seeded.bodyBlockId,
      researchResourceContentId: null,
      sourceType: "uploaded",
      sourceKey: `text-block:${seeded.bodyBlockId}`,
      chunkIndex: 0,
      content: `The ${marker} passage discusses vicious decision and settled character states.`,
      contentHash: `canonical-rag-${suffix}`,
      anchor: { kind: "reader", href: `/works/${seeded.workId}/reader#block-${seeded.bodyBlockId}`, workId: seeded.workId, processingRunId: seeded.runId, pageIndex: 0, textBlockId: seeded.bodyBlockId, blockOrder: 1, startOffset: 0, endOffset: 80 },
    });

    await login(page);
    await page.goto("/ask-library");
    const chat = page.getByRole("region", { name: "Library-grounded Socratic chat" });
    await chat.getByLabel("Ask a question about your Library").fill(`What does the ${marker} passage say?`);
    await chat.getByRole("button", { name: "Ask" }).click();

    // The citation displays under the CANONICAL upload's title while its
    // anchor still targets the actual chunk's reader location.
    const citation = chat.getByRole("link", { name: new RegExp(`Canonical Upload Alpha ${suffix}.*page 1`, "i") });
    await expect(citation).toBeVisible();
    await expect(citation).toHaveAttribute("href", new RegExp(`/works/${seeded.workId}/reader#block-`));
  });
});
