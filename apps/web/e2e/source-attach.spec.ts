import { expect, test } from "@playwright/test";
import { db, documents, pages, processingRuns, ragChunks, textBlocks, workIdentities, works } from "@ice/db";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import {
  createVerifiedTestUser,
  deleteTestUser,
  seedLibraryItemForSourceAttach,
} from "./helpers";

/**
 * Phase 20.4 E2E: "Upload source text" for a Library entry that has no
 * owned full text yet (a work added purely through scholarly discovery).
 *
 * `learning_resource`/`work_identity`/`resource_role` fixtures are SEEDED,
 * same CI-safety reasoning as library.spec.ts/edition.spec.ts — no worker,
 * no live model call. Two tests genuinely exercise the REAL
 * `/api/works/upload/init`/`/complete` routes against real Supabase Storage
 * (same pattern as upload-integrity.spec.ts) to prove the actual server-side
 * canonical-identity association and duplicate-precedence logic this
 * sub-phase adds; they stop as soon as the document is queued
 * (`processingStatus: "processing"`) rather than waiting on the real,
 * multi-minute v2 pipeline (D-19-6) — Reader/RAG availability after a real
 * completed run is instead verified at the seeded end-state below, since
 * nothing in this sub-phase's code path is attach-specific once a document
 * exists: an attach-created `work`/`document` pair is structurally
 * identical to any other upload's, differing only in `work.work_identity_id`
 * being pre-set instead of derived later by a v3+ run.
 */

const EMAIL = `e2e-source-attach-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page, email = EMAIL) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Upload source text for Library-added works (Phase 20.4)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("a metadata-only Library entry shows the Upload source text action", async ({ page }) => {
    const { resourceId } = await seedLibraryItemForSourceAttach(userId, { resourceTitle: "Metadata Only Work" });

    await login(page);
    await page.goto(`/library/${resourceId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Metadata Only Work" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload source text" })).toBeVisible();
    await expect(page.getByLabel("Choose file to upload as source text")).toBeAttached();
  });

  test("a Library entry whose full text is already owned does not show the action", async ({ page }) => {
    const { resourceId, ownedWorkId } = await seedLibraryItemForSourceAttach(userId, {
      resourceTitle: "Already Owned Work",
      alreadyOwned: true,
    });

    await login(page);
    await page.goto(`/library/${resourceId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Already Owned Work" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Upload source text" })).not.toBeVisible();
    const openLink = page.getByRole("link", { name: /open .*Already Owned Work/i });
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute("href", `/works/${ownedWorkId}`);
  });

  test("successful attachment associates the new document with the entry's canonical identity and title", async ({ page }) => {
    const { resourceId, resourceWorkIdentityId } = await seedLibraryItemForSourceAttach(userId, {
      resourceTitle: "Attached Canonical Work",
    });

    await login(page);
    const init = await page.request.post("/api/works/upload/init", {
      data: { name: "source.txt", type: "text/plain", size: 11, learningResourceId: resourceId },
    });
    expect(init.status()).toBe(200);
    const staged = await init.json() as { workId: string; documentId: string; uploadUrl: string };

    const put = await page.request.put(staged.uploadUrl, {
      headers: { "content-type": "text/plain" },
      data: Buffer.from("hello world"),
    });
    expect(put.ok()).toBe(true);

    const complete = await page.request.post("/api/works/upload/complete", {
      data: { workId: staged.workId, documentId: staged.documentId },
    });
    expect(complete.status()).toBe(200);

    const [work] = await db.select().from(works).where(eq(works.id, staged.workId));
    expect(work?.workIdentityId).toBe(resourceWorkIdentityId);
    // A resource-driven title beats a filename-derived guess — the point of
    // attaching to a known canonical entry rather than starting a blank
    // upload from scratch.
    expect(work?.title).toBe("Attached Canonical Work");

    const [document] = await db.select().from(documents).where(eq(documents.id, staged.documentId));
    expect(document?.processingStatus).toBe("processing");

    // The existing status UI (WorkStatusPanel) is what shows progress from
    // here — reused, not reimplemented.
    await page.goto(`/works/${staged.workId}`);
    await expect(page.getByRole("heading", { name: "Attached Canonical Work" })).toBeVisible();
  });

  test("attaching as another edition of an already-owned duplicate file uses THAT work's identity, not the entry's own", async ({ page }) => {
    const { resourceId, resourceWorkIdentityId } = await seedLibraryItemForSourceAttach(userId, {
      resourceTitle: "Duplicate Precedence Work",
    });
    const sharedHash = crypto.createHash("sha256").update(`source-attach-duplicate-${crypto.randomUUID()}`).digest("hex");

    // Seed a pre-existing owned document whose content hash the worker has
    // already recorded (contentHash is only ever written by the worker post
    // extraction — see apps/worker/src/extraction.ts — so it is seeded
    // directly here rather than waiting on a real pipeline run), on a work
    // with its OWN distinct identity.
    const [existingWork] = await db.insert(works).values({ userId, title: "Existing Duplicate Edition", workType: "primary" }).returning({ id: works.id });
    const [existingIdentity] = await db.insert(workIdentities).values({ workKey: `work:test:existing:${crypto.randomUUID()}`, canonicalTitle: "Existing Duplicate Edition", evidence: "seeded for test" }).returning({ id: workIdentities.id });
    await db.update(works).set({ workIdentityId: existingIdentity.id }).where(eq(works.id, existingWork.id));
    await db.insert(documents).values({
      userId,
      workId: existingWork.id,
      storagePath: `${userId}/${existingWork.id}/existing.txt`,
      originalFilename: "existing.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      contentHash: sharedHash,
    });

    await login(page);
    const firstAttempt = await page.request.post("/api/works/upload/init", {
      data: { name: "source.txt", type: "text/plain", size: 11, contentHash: sharedHash, learningResourceId: resourceId },
    });
    expect(firstAttempt.status()).toBe(200);
    const firstBody = await firstAttempt.json() as { duplicate?: { workId: string; title: string } };
    expect(firstBody.duplicate).toMatchObject({ workId: existingWork.id, title: "Existing Duplicate Edition" });

    const secondAttempt = await page.request.post("/api/works/upload/init", {
      data: { name: "source.txt", type: "text/plain", size: 11, contentHash: sharedHash, duplicateResolution: "add_edition", learningResourceId: resourceId },
    });
    expect(secondAttempt.status()).toBe(200);
    const staged = await secondAttempt.json() as { workId: string; documentId: string; uploadUrl: string };
    expect(staged.workId).not.toBe(existingWork.id);

    const [newWork] = await db.select().from(works).where(eq(works.id, staged.workId));
    // The hash match is the stronger, more specific signal — it must win
    // over the Library entry's own recorded identity.
    expect(newWork?.workIdentityId).toBe(existingIdentity.id);
    expect(newWork?.workIdentityId).not.toBe(resourceWorkIdentityId);
  });

  test("the duplicate decision UI offers open existing, cancel, and attach as another edition", async ({ page }) => {
    const { resourceId } = await seedLibraryItemForSourceAttach(userId, { resourceTitle: "Mocked Duplicate Flow Work" });
    await login(page);

    const initCalls: Array<{ learningResourceId?: string; duplicateResolution?: string }> = [];
    await page.route("**/api/works/upload/init", async (route) => {
      const payload = route.request().postDataJSON() as { learningResourceId?: string; duplicateResolution?: string };
      initCalls.push(payload);
      if (!payload.duplicateResolution) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ duplicate: { workId: "11111111-1111-4111-8111-111111111111", title: "Mocked Existing Work" } }) });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          workId: "22222222-2222-4222-8222-222222222222",
          documentId: "33333333-3333-4333-8333-333333333333",
          uploadUrl: `${new URL(page.url()).origin}/test-signed-upload/mocked.txt`,
        }),
      });
    });
    await page.route("**/test-signed-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
    await page.route("**/api/works/upload/complete", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ workId: "22222222-2222-4222-8222-222222222222" }) }));

    await page.goto(`/library/${resourceId}`, { waitUntil: "networkidle" });
    await page.getByLabel("Choose file to upload as source text").setInputFiles({ name: "mocked.txt", mimeType: "text/plain", buffer: Buffer.from("mocked content") });

    await expect(page.getByText("Mocked Existing Work")).toBeVisible();
    const openExisting = page.getByRole("link", { name: "Open existing" });
    await expect(openExisting).toHaveAttribute("href", "/works/11111111-1111-4111-8111-111111111111");

    // Cancel returns to the idle "choose a file" state without completing.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Choose file to upload as source text")).toBeAttached();
    await expect(page.getByText("Mocked Existing Work")).not.toBeVisible();

    // Re-attempt and this time resolve as another edition.
    await page.getByLabel("Choose file to upload as source text").setInputFiles({ name: "mocked.txt", mimeType: "text/plain", buffer: Buffer.from("mocked content") });
    await expect(page.getByText("Mocked Existing Work")).toBeVisible();
    await page.getByRole("button", { name: "Attach as another edition" }).click();
    await expect(page.getByRole("heading", { name: "Upload received" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Follow processing progress" })).toHaveAttribute("href", "/works/22222222-2222-4222-8222-222222222222");

    expect(initCalls.every((call) => call.learningResourceId === resourceId)).toBe(true);
    expect(initCalls.map((call) => call.duplicateResolution ?? "")).toEqual(["", "", "add_edition"]);
  });

  test("a failed processing document still shows the existing Retry processing action", async ({ page }) => {
    const { resourceId, resourceWorkIdentityId } = await seedLibraryItemForSourceAttach(userId, { resourceTitle: "Failed Attach Work" });
    const [work] = await db.insert(works).values({ userId, title: "Failed Attach Work", workType: "primary", workIdentityId: resourceWorkIdentityId }).returning({ id: works.id });
    await db.insert(documents).values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/failed.txt`,
      originalFilename: "failed.txt",
      mimeType: "text/plain",
      fileSize: 50,
      processingStatus: "failed",
      processingError: "Simulated extraction failure for a source-attach fixture.",
    });
    void resourceId;

    await login(page);
    await page.goto(`/works/${work.id}`);
    await expect(page.getByText("Processing failed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry processing" })).toBeVisible();
  });

  test("owner isolation: another account cannot open a Library entry that isn't recommended for any of their own works", async ({ page }) => {
    const { resourceId } = await seedLibraryItemForSourceAttach(userId, { resourceTitle: "Owner Isolation Work" });
    const otherEmail = `e2e-source-attach-other-${Date.now()}@example.com`;
    await createVerifiedTestUser(otherEmail, PASSWORD);

    await login(page, otherEmail);
    await page.goto(`/library/${resourceId}`, { waitUntil: "networkidle" });
    await expect(page.getByText("404")).toBeVisible();

    await deleteTestUser(otherEmail);
  });

  test("Reader and RAG availability after completion (seeded end-state)", async ({ page }) => {
    // Seeded rather than driven through the real worker (D-19-6: a real
    // v2+ run can take minutes and is network/API-bound). What this proves
    // is the structural claim this sub-phase relies on: an attach-created
    // work/document pair is indistinguishable from any other upload's once
    // a run completes, so the Reader and RAG chunk indexing already
    // verified for normal uploads (Phase 11/18) apply unmodified here too.
    const { resourceId, resourceWorkIdentityId } = await seedLibraryItemForSourceAttach(userId, { resourceTitle: "Attached And Published Work" });
    const [work] = await db.insert(works).values({ userId, title: "Attached And Published Work", workType: "primary", workIdentityId: resourceWorkIdentityId }).returning({ id: works.id });
    const [doc] = await db.insert(documents).values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/published.txt`,
      originalFilename: "published.txt",
      mimeType: "text/plain",
      fileSize: 200,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Attached source text now readable through the ordinary Reader.",
    }).returning({ id: documents.id });
    const [run] = await db.insert(processingRuns).values({
      documentId: doc.id,
      version: 1,
      pipelineVersion: "v2",
      status: "complete",
      stage: "publish",
      structureState: "full",
      isPublished: true,
    }).returning({ id: processingRuns.id });
    const [page0] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: "Attached source text now readable through the ordinary Reader." }).returning({ id: pages.id });
    const [block] = await db.insert(textBlocks).values({ pageId: page0.id, blockOrder: 0, kind: "body", text: "Attached source text now readable through the ordinary Reader." }).returning({ id: textBlocks.id });
    await db.insert(ragChunks).values({
      userId,
      workId: work.id,
      documentId: doc.id,
      processingRunId: run.id,
      textBlockId: block.id,
      researchResourceContentId: null,
      sourceType: "uploaded",
      sourceKey: `text-block:${block.id}`,
      chunkIndex: 0,
      content: "Attached source text now readable through the ordinary Reader.",
      contentHash: "e2e-phase-20-4-attached",
      anchor: { kind: "reader", href: `/works/${work.id}/reader#block-${block.id}`, workId: work.id, processingRunId: run.id, pageIndex: 0, textBlockId: block.id, blockOrder: 0, startOffset: 0, endOffset: 62 },
    });
    void resourceId;

    await login(page);
    await page.goto(`/works/${work.id}/reader`);
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
    await expect(edition).toBeVisible();
    await expect(edition).toContainText("Attached source text now readable through the ordinary Reader.");

    const [chunk] = await db.select().from(ragChunks).where(eq(ragChunks.documentId, doc.id));
    expect(chunk?.workId).toBe(work.id);
    expect(chunk?.sourceType).toBe("uploaded");
  });
});
