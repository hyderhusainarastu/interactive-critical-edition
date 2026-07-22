import { db, documents, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkInStatus, seedWorkWithLibraryItem } from "./helpers";

/**
 * Phase 19 work-status interaction inventory: the "Work status" row (metadata-
 * confirm form, reprocess action, processing progress, failed-state recovery,
 * trashed-work Undo/Trash link). Every fixture here seeds `document`/
 * `processing_run` rows directly rather than driving a real upload through
 * the worker — per D-19-6, a real pipeline v2+ run is live-network-bound and
 * can cost real money, and none of these tests are about whether analysis
 * itself succeeds, only whether `WorkStatusPanel`'s controls render and
 * trigger the right request for each status. Reprocess clicks are verified
 * against a mocked `/reprocess` response (same technique `upload.spec.ts`
 * already uses for its own API calls) so the assertion is independent of
 * this deployment's `ANALYSIS_PIPELINE` configuration and never enqueues a
 * real worker job.
 */

const EMAIL = `e2e-work-status-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Work status controls (Phase 19)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("needs_review renders the metadata-confirm form prefilled from extraction, and confirming readies the work", async ({ page }) => {
    const { workId, documentId } = await seedWorkInStatus(userId, "needs_review", {
      title: "Original Upload Title",
      extractedTitle: "Detected Title From Extraction",
      extractedAuthor: "Detected Author",
    });

    await login(page);
    await page.goto(`/works/${workId}`);

    await expect(page.getByText("Confirm or correct the detected metadata")).toBeVisible();
    await expect(page.locator('input[name="title"]')).toHaveValue("Detected Title From Extraction");
    await expect(page.locator('input[name="authorName"]')).toHaveValue("Detected Author");

    await page.locator('input[name="title"]').fill("Confirmed Title");
    await page.getByRole("button", { name: "Confirm and add to library" }).click();

    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(page.getByText("Confirmed Title")).toBeVisible();

    const [row] = await db.select({ status: documents.processingStatus }).from(documents).where(eq(documents.id, documentId));
    expect(row.status).toBe("ready");
    const [workRow] = await db.select({ title: works.title }).from(works).where(eq(works.id, workId));
    expect(workRow.title).toBe("Confirmed Title");
  });

  test("processing renders the real ordered stage sequence with the current stage highlighted", async ({ page }) => {
    const { workId } = await seedWorkInStatus(userId, "processing", {
      title: "Mid-run work",
      processingRun: { pipelineVersion: "v2", stage: "research-discovery", runStatus: "running" },
    });

    await login(page);
    await page.goto(`/works/${workId}`);

    await expect(page.getByText("Processing… — this page updates automatically.")).toBeVisible();
    // V2_STAGE_SEQUENCE order (packages/config/src/stages.ts): extracting is
    // already done (checkmark), research-discovery is the active stage, and
    // the remaining three haven't started.
    const steps = page.locator("ol li");
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(0)).toContainText("Extracting text and metadata");
    await expect(steps.nth(0).locator("span[aria-hidden]")).toHaveText("✓");
    await expect(steps.nth(1)).toContainText("Discovering related sources…");
    await expect(steps.nth(2)).toContainText("Checking source relevance");
    await expect(steps.nth(2).locator("span[aria-hidden]")).toHaveText("");
  });

  test("failed shows the error and a working retry control (D-19-29: no recovery action existed before this fix)", async ({ page }) => {
    const { workId, documentId } = await seedWorkInStatus(userId, "failed", {
      title: "Failed work",
      processingError: "No extractable text found. OCR was unavailable or produced no text.",
    });

    await login(page);
    await page.goto(`/works/${workId}`);

    await expect(page.getByText("Processing failed")).toBeVisible();
    await expect(page.getByText("No extractable text found. OCR was unavailable or produced no text.")).toBeVisible();
    const retryButton = page.getByRole("button", { name: "Retry processing" });
    await expect(retryButton).toBeVisible();

    let reprocessRequested = false;
    await page.route(`**/api/works/${workId}/reprocess`, async (route) => {
      reprocessRequested = route.request().method() === "POST";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "queued", projectedVersion: 2, jobId: "mock-job-id" }),
      });
    });
    // The panel polls the real /status endpoint every 2s once it enters a
    // polling state; without this, that poll would re-fetch the real
    // (unchanged, since the reprocess response above is mocked and never
    // touches the DB) "failed" row and could flip the UI back before the
    // assertion below resolves. Pin it so the retry's own optimistic
    // transition is what's actually under test, not a timing race.
    await page.route(`**/api/works/${workId}/status`, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          title: "Failed work", authorName: null, status: "processing",
          extractedTitle: null, extractedAuthor: null, processingError: null, deletedAt: null,
          processingRun: { version: 2, pipelineVersion: "v2", stage: "extracting", structureState: "limited", runStatus: "running", published: false, note: null },
        }),
      }));

    await retryButton.click();
    await expect(page.getByText("Queued — this page updates automatically.")).toBeVisible();
    expect(reprocessRequested).toBe(true);

    // The mocked response never touched the real document row — confirms
    // this assertion exercised the client trigger, not a real pipeline run.
    const [row] = await db.select({ status: documents.processingStatus }).from(documents).where(eq(documents.id, documentId));
    expect(row.status).toBe("failed");
  });

  test("ready work's Reprocess edition button triggers the reprocess request and shows the polling state", async ({ page }) => {
    const { workId } = await seedWorkInStatus(userId, "ready", { title: "Ready work for reprocess" });

    await login(page);
    await page.goto(`/works/${workId}`);
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();

    let reprocessRequested = false;
    await page.route(`**/api/works/${workId}/reprocess`, async (route) => {
      reprocessRequested = route.request().method() === "POST";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "queued", projectedVersion: 2, jobId: "mock-job-id" }),
      });
    });
    // See the identical comment in the failed-state test above: pins the
    // panel's own status poll so it can't race the optimistic transition.
    await page.route(`**/api/works/${workId}/status`, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          title: "Ready work for reprocess", authorName: null, status: "processing",
          extractedTitle: null, extractedAuthor: null, processingError: null, deletedAt: null,
          processingRun: { version: 2, pipelineVersion: "v2", stage: "extracting", structureState: "limited", runStatus: "running", published: false, note: null },
        }),
      }));

    await page.getByRole("button", { name: "Reprocess edition" }).click();
    await expect(page.getByText("Queued — this page updates automatically.")).toBeVisible();
    expect(reprocessRequested).toBe(true);
  });

  test("a trashed work's own status panel Undo control restores it, and its Trash link navigates to /works/trash", async ({ page }) => {
    const { workId } = await seedWorkInStatus(userId, "ready", { title: "Trashed-panel work" });
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, workId));

    await login(page);
    await page.goto(`/works/${workId}`);
    await expect(page.getByText("In trash")).toBeVisible();

    const trashLink = page.getByRole("link", { name: "Trash" });
    await expect(trashLink).toHaveAttribute("href", "/works/trash");

    await page.getByRole("button", { name: "Undo move to trash" }).click();
    await expect(page.getByText("In trash")).not.toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();

    const [row] = await db.select({ deletedAt: works.deletedAt }).from(works).where(eq(works.id, workId));
    expect(row.deletedAt).toBeNull();
  });

  /**
   * Phase 19.5 user-journey item: "metadata-only work open + absence of
   * source-text attach." A Library item recommended for one of the reader's
   * own uploads (a `learning_resource`, seeded the same way `library.spec.ts`
   * does) has no `document`/`work` of its own — there is no per-resource
   * detail route at all today (only the `/library` list row itself), and
   * `LibraryRow` in `apps/web/src/app/(app)/library/LibraryView.tsx` renders
   * only a plain title (or an external link when `item.url` is set),
   * metadata, recommended-for chips back to the OWNING work, and a
   * reading-status control — no "Upload source text"/attach affordance
   * anywhere. This is expected and correct for the current phase (that
   * feature is planned for Phase 20.4); this test documents the
   * reproduction as evidence rather than treating the absence as a defect.
   */
  test("a metadata-only Library item has no source-text-upload affordance (evidence for Phase 20.4, not a defect)", async ({ page }) => {
    await seedWorkWithLibraryItem(userId, {
      title: "Owning work for metadata-only evidence",
      resourceTitle: "Metadata-only companion text",
    });
    // Sanity: the recommended resource has no document/owned work of its own —
    // only the owning work above does. `seedWorkWithLibraryItem` never creates
    // one for the resourceTitle side, confirmed by reading its implementation.
    const [ownedDocForResourceTitle] = await db
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(works, eq(works.id, documents.workId))
      .where(eq(works.title, "Metadata-only companion text"));
    expect(ownedDocForResourceTitle).toBeUndefined();

    await login(page);
    await page.goto("/library");

    const row = page.locator("[data-library-item]").filter({ hasText: "Metadata-only companion text" }).first();
    await expect(row).toBeVisible();
    // Title renders as plain text, not a link, since no url/detail route exists.
    await expect(row.getByRole("link", { name: "Metadata-only companion text" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: /upload/i })).toHaveCount(0);
    await expect(row.getByRole("link", { name: /upload/i })).toHaveCount(0);
    await expect(page.getByText(/upload source text/i)).toHaveCount(0);
  });
});
