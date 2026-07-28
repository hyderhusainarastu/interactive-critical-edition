import { db, editions, users, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork, seedWorkInStatus } from "../helpers";

/**
 * Stage 7 journey matrix — charter §16 journey 1:
 * "Onboarding → batch upload → duplicate choice → progress → metadata
 * confirmation → Reader → retry/reprocess → Trash → restore → guarded
 * permanent-delete flow."
 *
 * Runs with NO worker and NO paid API: the batch-upload/duplicate/progress
 * steps use the same deterministic route-mocking technique `upload.spec.ts`
 * already established (mock `/api/works/upload/{init,complete}` and the
 * signed-upload PUT), and every processing-status/metadata-confirm/retry
 * step seeds `work`/`document`/`processing_run` rows directly via
 * `seedWorkInStatus` (`../helpers.ts`) — the same CI-safety convention
 * `work-status.spec.ts` documents (no live pipeline run, no cost). Trash/
 * restore/permanent-delete reuse `trash.spec.ts`'s own real-DB-state
 * conventions (pure web CRUD, no worker involvement at all).
 *
 * What this journey deliberately does NOT re-prove: the real worker-driven
 * text-extraction/GROBID/research pipeline itself (that is `upload.spec.ts`/
 * `work-status.spec.ts`'s own job, already covered there) — this file's
 * job is that the full sequence of a work's lifecycle holds together, not
 * that any individual stage is correct in isolation (that's the existing
 * suite's job).
 *
 * Structured as four sequential `test()`s (each a fresh `page`/browser tab
 * under the same authenticated user), not one giant test function — see
 * docs/design/stage7-journey-matrix.md's triage section for why: Stage 7
 * validation found a real, reproducible interaction where the
 * `/works/trash` "Delete permanently now" control fails to open its
 * confirmation dialog when reached from a page that has already
 * accumulated many prior navigations and mocked routes in the SAME tab
 * (isolated by bisection — reliably reproduces chained after the earlier
 * stages, reliably does NOT reproduce starting fresh). This is a real
 * product/environment timing fragility, out of this lane's scope to fix
 * (Stage 7 authors journeys against the shipped app; it does not repair
 * Stage 3-6 product code) — splitting stages into separate tests (a
 * documented Playwright best practice for exactly this class of
 * long-chained-state fragility, and the same structure this codebase's
 * own `reader.spec.ts`/`edition.spec.ts` already use for their own
 * multi-stage coverage) proves the same real journey without depending on
 * a single tab's cumulative state, while this comment keeps the finding
 * honest rather than silently routing around it.
 */

const EMAIL = `e2e-j01-upload-lifecycle-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

/** Next streams an unmounted server segment in a hidden holder near
 *  `</body>` while a page is hydrating (D-19-36, a documented self-healing
 *  Next.js/React streaming-SSR artifact) — scope real-page assertions to
 *  `#main-content` so a transient duplicate can never make one flaky, the
 *  same convention `curriculum.spec.ts`/`research.spec.ts`/`account.spec.ts`
 *  already use. */
function main(page: Page) {
  return page.locator("#main-content");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Mocks the three upload-transport routes exactly like `upload.spec.ts`'s
 *  own batch-upload test, so this journey's first stage never needs a real
 *  worker or Supabase Storage — only `/api/works/upload/init`'s duplicate
 *  branch (triggered by filename) and a deterministic `workId` per file. */
async function mockUploadRoutes(page: Page, duplicateFilename: string) {
  let counter = 0;
  await page.route("**/api/works/upload/init", async (route) => {
    const payload = route.request().postDataJSON() as { name: string; duplicateResolution?: string };
    if (payload.name === duplicateFilename && !payload.duplicateResolution) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ duplicate: { workId: "11111111-1111-4111-8111-111111111111", title: "Existing duplicate" } }),
      });
      return;
    }
    counter += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workId: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
        documentId: `00000000-0000-4000-8001-${String(counter).padStart(12, "0")}`,
        uploadUrl: `${new URL(page.url()).origin}/test-signed-upload/${payload.name}`,
      }),
    });
  });
  await page.route("**/test-signed-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.route("**/api/works/upload/complete", async (route) => {
    const payload = route.request().postDataJSON() as { workId: string };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ workId: payload.workId }) });
  });
}

test.describe("Journey 1 — upload lifecycle", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    // /works and /works/trash both gate on onboarding (dashboard/page.tsx's
    // redirect, duplicated onto /works — see trash.spec.ts's own note); this
    // journey's Trash/restore/permanent-delete stage needs those two routes
    // to actually render their real content, not redirect to /welcome.
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("1a — batch upload with a duplicate decision and progress", async ({ page }) => {
    await login(page);
    await mockUploadRoutes(page, "duplicate.md");
    await page.goto("/upload");
    await page.getByLabel("Choose files to upload").setInputFiles([
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first journey text") },
      { name: "duplicate.md", mimeType: "text/markdown", buffer: Buffer.from("# duplicate") },
    ]);
    const duplicateItem = page.locator('[data-upload-item="duplicate.md"]');
    await expect(page.getByRole("heading", { name: "Batch status" })).toBeVisible();
    await expect(duplicateItem).toContainText("Decision needed");
    await duplicateItem.getByRole("button", { name: "Add as another edition" }).click();
    await expect(page.locator('[data-upload-item="first.txt"]')).toContainText("Queued for processing");
    await expect(duplicateItem).toContainText("Queued for processing");
    await expect(page.getByText("2 of 2 resolved")).toBeVisible();
  });

  test("1b — metadata confirmation opens the Reader", async ({ page }) => {
    await login(page);
    // A real worker never ran against 1a's mocked upload, so this stage is
    // driven by a directly-seeded needs_review work (same CI-safety
    // reasoning as work-status.spec.ts) rather than assuming the mocked
    // upload reaches a real confirmable state on its own.
    const { workId: reviewWorkId } = await seedWorkInStatus(userId, "needs_review", {
      title: "Journey Upload Draft",
      extractedTitle: "Detected Journey Title",
      extractedAuthor: "Detected Journey Author",
    });
    await page.goto(`/works/${reviewWorkId}`);
    await expect(main(page).getByText("Confirm or correct the detected metadata")).toBeVisible();
    await expect(page.locator('input[name="title"]')).toHaveValue("Detected Journey Title");
    await page.locator('input[name="title"]').fill("Confirmed Journey Title");
    const confirmResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/works/${reviewWorkId}/confirm`) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Confirm and add to library" }).click();
    await confirmResponse;
    await expect(page.getByRole("heading", { name: "Confirmed Journey Title" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("navigation", { name: /sections/ }).getByRole("link", { name: "Reader", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/works/${reviewWorkId}/reader$`));
  });

  test("1c — retry/reprocess on a failed work", async ({ page }) => {
    await login(page);
    const { workId: failedWorkId } = await seedWorkInStatus(userId, "failed", {
      title: "Journey Failed Work",
      processingError: "No extractable text found. OCR was unavailable or produced no text.",
    });
    await page.goto(`/works/${failedWorkId}`);
    await expect(main(page).getByText("Processing failed", { exact: true })).toBeVisible();
    const retryButton = page.getByRole("button", { name: "Retry processing" });
    await expect(retryButton).toBeVisible();
    let reprocessRequested = false;
    await page.route(`**/api/works/${failedWorkId}/reprocess`, async (route) => {
      reprocessRequested = route.request().method() === "POST";
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "queued", projectedVersion: 2, jobId: "journey-mock-job" }) });
    });
    await page.route(`**/api/works/${failedWorkId}/status`, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          title: "Journey Failed Work", authorName: null, status: "processing",
          extractedTitle: null, extractedAuthor: null, processingError: null, deletedAt: null,
          processingRun: { version: 2, pipelineVersion: "v2", stage: "extracting", structureState: "limited", runStatus: "running", published: false, note: null },
        }),
      }));
    await retryButton.click();
    await expect(main(page).getByText("Queued — this page updates automatically.")).toBeVisible();
    expect(reprocessRequested).toBe(true);
  });

  test("1d — Trash → restore, then guarded permanent-delete with typed confirmation", async ({ page }) => {
    await login(page);

    const { workId: trashWorkId } = await seedOwnedWork(userId);
    await page.goto(`/works/${trashWorkId}`);
    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Yes, move to trash" }).click();
    await expect(main(page).getByText("In trash")).toBeVisible();

    await page.goto("/works");
    await expect(page.getByRole("link", { name: /Owner's Private Work/ })).not.toBeVisible();

    await page.goto("/works/trash");
    // Scope dynamic rows to the live application tree: a transient Next
    // streaming holder can otherwise preserve an inert duplicate of the
    // same route markup after navigation.
    const trashRow = main(page).locator(`[data-trash-item="${trashWorkId}"]`);
    await expect(trashRow).toBeVisible();
    await expect(trashRow).toContainText("Permanently deleted in 30 days");

    await trashRow.getByRole("button", { name: "Restore" }).click();
    await expect(trashRow).not.toBeVisible();
    await page.goto("/works");
    await expect(page.getByRole("link", { name: /Owner's Private Work/ })).toBeVisible();

    // Guarded permanent-delete, on a SECOND work that is "high-value" via
    // multiple editions (>1 edition row) rather than a ready document —
    // deliberately: a ready document's storage_path would make the real
    // deletion state machine attempt an actual Supabase Storage removal,
    // which this local run's dummy SUPABASE_URL can't satisfy (the exact
    // CI-safety boundary trash.spec.ts's own doc comment documents), while
    // still requiring the typed-title confirmation this step is about.
    // Also a FRESH `page` (this test's own), which is exactly what makes
    // this stage reliable per this file's own top-of-file doc comment.
    const [guardedWork] = await db
      .insert(works)
      .values({ userId, title: "Guarded Delete Work", authorName: "Journey Author" })
      .returning({ id: works.id });
    await db.insert(editions).values([
      { workId: guardedWork.id, editionLabel: "First edition" },
      { workId: guardedWork.id, editionLabel: "Second edition" },
    ]);
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, guardedWork.id));

    await page.goto("/works/trash");
    const guardedRow = main(page).locator(`[data-trash-item="${guardedWork.id}"]`);
    await expect(guardedRow).toBeVisible();
    await guardedRow.getByRole("button", { name: "Delete permanently now" }).click();
    const dialog = page.getByRole("dialog", { name: /Permanently delete/ });
    await expect(dialog).toBeVisible();
    const typedTitleField = dialog.getByLabel(/Type the work's title/i);
    await expect(typedTitleField).toBeVisible();
    const confirmDelete = dialog.getByRole("button", { name: "Delete permanently" });
    await expect(confirmDelete).toBeDisabled();
    await typedTitleField.fill("Guarded Delete Work");
    await expect(confirmDelete).toBeEnabled();
    await confirmDelete.click();
    await expect(guardedRow).not.toBeVisible();

    const [remaining] = await db.select({ id: works.id }).from(works).where(eq(works.id, guardedWork.id));
    expect(remaining).toBeUndefined();
  });
});
