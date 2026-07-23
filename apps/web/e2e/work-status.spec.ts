import { db, documents, findPendingExtractJobs, getQueue, processingRuns, QUEUE_EXTRACT_TEXT, works } from "@ice/db";
import { eq, sql } from "drizzle-orm";
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
    // deleteTestUser also cancels any still-queued extract-text jobs the
    // real-route reprocess tests enqueued (cancelQueuedJobsForDocuments).
    await deleteTestUser(EMAIL);
    // The stalled-recovery test starts a pg-boss instance in THIS process
    // (to guarantee the pgboss schema exists and to park a job); stop it so
    // its maintenance timers don't outlive the spec.
    const boss = await getQueue();
    await boss.stop({ graceful: false, wait: true });
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
    // This is the first point in the whole CI-safe E2E run where the
    // confirm route's happy path executes (security.spec.ts's confirm
    // check is a cross-user 404 that never reaches this code), so it's
    // also the first call to enqueueAnalyzeWork()/getQueue() — pg-boss's
    // one-time schema creation plus four sequential createQueue() calls
    // (packages/db/src/queue.ts) run synchronously inside this awaited
    // POST. Waiting on the real response (rather than a bare
    // button-click-then-assert) pins the test to the actual completing
    // network event instead of racing it.
    const confirmResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/works/${workId}/confirm`) && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Confirm and add to library" }).click();
    await confirmResponse;

    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    // "Confirmed Title" only appears once router.refresh() (fired by
    // WorkStatusPanel's handleConfirm after the POST above) completes its
    // own, separate RSC round trip and re-renders the Server Component
    // <h1> with the newly-saved work.title — WorkStatusPanel's own client
    // state only tracks status, not title, so this is never satisfied by
    // local state alone. CI observed the whole flow (POST + refresh) take
    // 6.3s/6.6s under runner load, just over the bare 5s default; this is
    // a real, reproducible network-bound latency (confirmed locally by
    // hitting the same cold-pg-boss-init confirm path against a real
    // production build), not a functional regression, so the fix is
    // headroom on the assertion that actually depends on it rather than a
    // weaker assertion.
    await expect(page.getByText("Confirmed Title")).toBeVisible({ timeout: 15_000 });

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
    // Phase 20.5: the failed state states the recovery semantics honestly —
    // the immutable original upload is retained and retry restarts from it,
    // with any published edition kept until a new run succeeds.
    await expect(page.getByText("Your original uploaded file is retained unchanged.", { exact: false })).toBeVisible();
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
   * Phase 20.5 (D-20-50): repeated Reprocess requests must enqueue ONCE.
   * Reproduced live before the fix: two sequential POSTs to the real route
   * each returned 202 with a fresh jobId and left TWO pg-boss `created` rows
   * for the same document — two duplicate paid runs. These go through the
   * REAL /reprocess route (no mocking), which is why CI's E2E step now sets
   * ANALYSIS_PIPELINE=v2 (the route 409s on the v1 default).
   */
  test("repeated reprocess requests for a ready work enqueue exactly one job (D-20-50)", async ({ page }) => {
    const { workId, documentId } = await seedWorkInStatus(userId, "ready", { title: "Duplicate-click reprocess work" });

    await login(page);
    const first = await page.request.post(`/api/works/${workId}/reprocess`);
    expect(first.status()).toBe(202);
    const firstBody = (await first.json()) as { status: string; jobId?: string; deduplicated?: boolean };
    expect(firstBody.status).toBe("queued");
    expect(firstBody.deduplicated).toBeUndefined();

    const second = await page.request.post(`/api/works/${workId}/reprocess`);
    // Either dedup outcome is correct: reuse of the queued job (202 +
    // deduplicated) or a conflict because the attempt already went active
    // (409, possible locally where a live worker shares the stack). What
    // must NEVER happen is a second fresh enqueue.
    const secondBody = (await second.json()) as { jobId?: string; deduplicated?: boolean; error?: string };
    if (second.status() === 202) {
      expect(secondBody.deduplicated).toBe(true);
      expect(secondBody.jobId).toBe(firstBody.jobId);
    } else {
      expect(second.status()).toBe(409);
    }

    const pending = await findPendingExtractJobs(documentId);
    expect(pending.length).toBeLessThanOrEqual(1);
    const [jobRows] = await db.execute(sql`
      select count(*)::int as count from pgboss.job
      where name = 'extract-text' and data ->> 'documentId' = ${documentId}
    `);
    expect((jobRows as { count: number }).count).toBe(1);
  });

  /**
   * Phase 20.5: stale-active-job recovery through the real route + UI. A
   * worker that dies mid-job leaves the pg-boss row `active` and the run
   * without heartbeats; previously that was unrecoverable until the 60-minute
   * expiration window elapsed (then retried into a duplicate run). The status
   * endpoint now reports the stall, the panel offers Retry, and the route
   * cancels the orphaned row and enqueues a fresh attempt.
   */
  test("a stalled processing work surfaces recovery, and Retry recovers the orphaned active job (real route)", async ({ page }) => {
    const { workId, documentId } = await seedWorkInStatus(userId, "processing", {
      title: "Stalled mid-run work",
      processingRun: { pipelineVersion: "v2", stage: "research-discovery", runStatus: "running" },
    });
    // The heartbeat stopped 30 minutes ago — well past the 10-minute stale
    // threshold the status endpoint and planReprocess share.
    await db
      .update(processingRuns)
      .set({ updatedAt: new Date(Date.now() - 30 * 60_000) })
      .where(eq(processingRuns.documentId, documentId));
    // A real pg-boss row left `active` by the "dead" worker. Parked with a
    // far-future startAfter first so a live local worker can never fetch it
    // before the state flip (pg-boss only ever fetches created/retry rows).
    const boss = await getQueue();
    const staleJobId = await boss.send(QUEUE_EXTRACT_TEXT, { documentId }, { startAfter: 3600, expireInMinutes: 60 });
    await db.execute(sql`
      update pgboss.job set state = 'active', started_on = now() - interval '30 minutes'
      where id = ${staleJobId} and name = 'extract-text'
    `);

    await login(page);
    await page.goto(`/works/${workId}`);
    // The server-rendered initial payload omits the stall flag; the 2-second
    // status poll fills it in.
    await expect(page.getByText("Processing appears to have stalled")).toBeVisible({ timeout: 15_000 });

    const [recoverResponse] = await Promise.all([
      page.waitForResponse((response) => response.url().includes("/reprocess") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Retry processing" }).click(),
    ]);
    expect(recoverResponse.status()).toBe(202);
    const body = (await recoverResponse.json()) as { status: string; recovered?: boolean; jobId?: string };
    expect(body.status).toBe("queued");
    expect(body.recovered).toBe(true);
    await expect(page.getByText("Queued — this page updates automatically.")).toBeVisible();

    // The orphaned active row is gone — it can no longer be expire-retried
    // into a duplicate run behind the fresh attempt's back.
    const pendingIds = (await findPendingExtractJobs(documentId)).map((job) => job.id);
    expect(pendingIds).not.toContain(staleJobId);
    const [staleRow] = await db.execute(sql`select id from pgboss.job where id = ${staleJobId}`);
    expect(staleRow).toBeUndefined();
  });

  /**
   * Phase 20.4: metadata-only Library item detail page with source-text
   * upload. A Library item recommended for one of the reader's own uploads
   * (a `learning_resource`, seeded the same way `library.spec.ts` does) has
   * no `document`/`work` of its own. The item's title in the Library list
   * is a link to `/library/[resourceId]`, where the detail page offers
   * "Upload source text" for exactly this case. This test verifies the
   * affordance is both reachable and present.
   */
  test("a metadata-only Library item title links to its detail page offering source-text upload (Phase 20.4)", async ({ page }) => {
    const { resourceId } = await seedWorkWithLibraryItem(userId, {
      title: "Owning work for metadata-only affordance",
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
    // Title renders as a link to the detail page (not an external URL).
    const titleLink = row.getByRole("link", { name: "Metadata-only companion text" });
    await expect(titleLink).toHaveCount(1);
    await expect(titleLink).toHaveAttribute("href", `/library/${resourceId}`);

    // Follow the link to the detail page and verify "Upload source text" is present.
    await titleLink.click();
    await expect(page.getByRole("heading", { name: "Upload source text" })).toBeVisible();
  });
});
