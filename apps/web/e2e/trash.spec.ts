import {
  db,
  deletionCleanups,
  documents,
  pages,
  processingRuns,
  ragChunks,
  textBlocks,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork, seedWorkWithLibraryItems } from "./helpers";

/**
 * Phase 9.7 + 20.3 E2E: the 30-day work trash and the permanent-deletion
 * state machine. Pure web CRUD with no worker/AI involvement, so no
 * production canary is needed — verified here the same way Phase 3's
 * highlights/notes/bookmarks were. Covers: move to trash → the work becomes
 * inaccessible via its normal routes, disappears from `/works`, and stops
 * surfacing in RAG retrieval → appears in `/works/trash` with the correct
 * days-remaining → restore brings it back; permanent delete walks the
 * named confirmation dialog (typed-title confirmation for high-value
 * works), cascades every private row including RAG chunks and polymorphic
 * graph edges, preserves the shared catalog, records a completed cleanup,
 * and is idempotent on repeat; and a persisted partial-failure cleanup
 * state is retried to completion on the next trash visit.
 *
 * D-20-55: this CI-run spec is deliberately kept deterministic without a
 * real Supabase Storage backend — CI's dummy SUPABASE_URL (see
 * .github/workflows/ci.yml) means any real `deleteDocumentFile()` network
 * call throws (`StorageUnknownError: fetch failed`), which the honest
 * `@ice/deletion` state machine correctly reports as `storage_failed`
 * rather than `completed`. Every permanent-delete scenario here therefore
 * seeds works with either no document row at all, or a persisted cleanup
 * whose `pendingStoragePaths` is already empty, so the machine never makes
 * a real Storage call and the outcome is deterministic in any environment.
 * The two assertions that genuinely require a reachable Storage backend —
 * a real uploaded object actually being removed, and the "removing an
 * already-missing object resolves rather than errors" idempotency
 * regression — live in `trash-storage.spec.ts`, run manually against real
 * local dev Storage, following the same CI-safe/manual split already
 * established for `upload-integrity.spec.ts`. See
 * docs/PROJECT-LOG.md's D-19-4/D-19-10 notes: a long-lived local
 * environment (with a real, reachable Supabase project) is not CI.
 */

const EMAIL = `e2e-trash-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Seeds a published run + one body block + one uploaded RAG chunk for a work. */
async function seedRagChunkForWork(input: { workId: string; documentId: string; content: string }) {
  const [run] = await db
    .insert(processingRuns)
    .values({ documentId: input.documentId, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true })
    .returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, text: input.content }).returning({ id: pages.id });
  const [block] = await db
    .insert(textBlocks)
    .values({ pageId: page.id, blockOrder: 0, kind: "body", text: input.content })
    .returning({ id: textBlocks.id });
  const [chunk] = await db
    .insert(ragChunks)
    .values({
      userId,
      workId: input.workId,
      documentId: input.documentId,
      processingRunId: run.id,
      textBlockId: block.id,
      sourceType: "uploaded",
      sourceKey: `block:${block.id}`,
      chunkIndex: 0,
      content: input.content,
      contentHash: `hash-${block.id}`,
      anchor: { kind: "reader", href: `/works/${input.workId}/reader#block-${block.id}`, workId: input.workId, processingRunId: run.id, textBlockId: block.id, startOffset: 0, endOffset: input.content.length },
    })
    .returning({ id: ragChunks.id });
  return { runId: run.id, blockId: block.id, chunkId: chunk.id };
}

test.describe("Work trash (Phase 9.7 + 20.3)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    // /works and /works/trash both gate on onboarding (dashboard/page.tsx's
    // redirect, duplicated onto /works per its own doc comment) — every
    // other seeded spec avoids this by never navigating to either page
    // directly, but trash.spec.ts's whole point is those two pages, so the
    // test user needs onboarding stamped rather than hitting the redirect.
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("moving a work to trash hides it from /works, blocks its routes, and lists it in the trash with 30 days remaining", async ({ page }) => {
    const { workId } = await seedOwnedWork(userId);

    await login(page);
    await page.goto(`/works/${workId}`);
    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Yes, move to trash" }).click();
    await expect(page.getByText("In trash")).toBeVisible();

    // Gone from the normal works list.
    await page.goto("/works");
    await expect(page.getByRole("link", { name: /Owner's Private Work/ })).not.toBeVisible();

    // A getOwnedDocument-gated route 404s while trashed (roadmap, in this
    // case) — the work is "gone" everywhere except its own page and Trash.
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByText("404")).toBeVisible();

    // Listed in the trash with the full 30-day window just started.
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${workId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Permanently deleted in 30 days");
  });

  test("restoring a trashed work brings it back everywhere", async ({ page }) => {
    const { workId } = await seedOwnedWork(userId);
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, workId));

    await login(page);
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${workId}"]`);
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(row).not.toBeVisible();

    await page.goto("/works");
    await expect(page.getByRole("link", { name: /Owner's Private Work/ })).toBeVisible();

    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByText("404")).not.toBeVisible();
  });

  // D-22-10 (plan §22.7): the trash list gained a one-shot `.app-reveal`
  // scroll-entrance (mirroring library.spec.ts's own "does not animate when
  // motion is reduced" pattern for the Library Focus control) — under
  // reduced motion `useScrollReveal` must never set `data-reveal-ready`, so
  // the animation never has anything to trigger from.
  test("does not animate the trash list when motion is reduced", async ({ page }) => {
    const { workId } = await seedOwnedWork(userId);
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, workId));
    await page.emulateMedia({ reducedMotion: "reduce" });

    await login(page);
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${workId}"]`);
    await expect(row).toBeVisible();
    // The trash list's reveal class was renamed to `.app-reveal-stagger`
    // (commit 919218e, "polish signed-in workspace surfaces") — the
    // `useScrollReveal` behavior under test is unchanged, only the class.
    await expect(page.locator("ul.app-reveal-stagger")).not.toHaveAttribute("data-reveal-ready", "true");
  });

  test("trashing a work removes its chunks from RAG retrieval (Phase 20.3)", async ({ page }) => {
    const [work] = await db
      .insert(works)
      .values({ userId, title: "Zymurgy Studies", authorName: "Brewer" })
      .returning({ id: works.id });
    const [doc] = await db
      .insert(documents)
      .values({
        userId,
        workId: work.id,
        storagePath: `${userId}/${work.id}/zymurgy.txt`,
        originalFilename: "zymurgy.txt",
        mimeType: "text/plain",
        fileSize: 80,
        processingStatus: "ready",
        extractedText: "Zymurgy concerns fermentation biochemistry in brewing.",
      })
      .returning({ id: documents.id });
    await seedRagChunkForWork({ workId: work.id, documentId: doc.id, content: "Zymurgy concerns fermentation biochemistry in brewing." });

    // Goes through the real Ask Library HTTP surface (SSE answer stream over
    // `retrieveOwnerRagChunks`) rather than importing the retrieval function
    // directly — its internal dynamic `import("@ice/db")` doesn't survive
    // Playwright's CJS transpilation, and the HTTP path is the behavior the
    // trash contract actually promises. No AI key is configured locally, so
    // the deterministic zero-cost fallback answers, still citing retrieval.
    await login(page);
    const created = await page.request.post("/api/rag/conversations", { data: {} });
    expect(created.status()).toBe(201);
    const conversationId = (await created.json()).conversation.id as string;

    async function ask(question: string): Promise<{ notFound: boolean }> {
      const res = await page.request.post(`/api/rag/conversations/${conversationId}`, { data: { message: question } });
      expect(res.ok()).toBe(true);
      const body = await res.text();
      const doneLine = body.split("\n").find((line, i, lines) => lines[i - 1] === "event: done" && line.startsWith("data: "));
      expect(doneLine).toBeDefined();
      return JSON.parse(doneLine!.slice("data: ".length)) as { notFound: boolean };
    }

    // Sanity: an active work's chunk is retrievable and supports an answer.
    const before = await ask("What does zymurgy concern in fermentation brewing?");
    expect(before.notFound).toBe(false);

    // Trashed: the same question must no longer be answerable from the
    // trashed work's content — Ask Library answering from a trashed work
    // would contradict the trash contract ("hidden from RAG retrieval").
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, work.id));
    const after = await ask("What does zymurgy concern in fermentation brewing?");
    expect(after.notFound).toBe(true);
  });

  // D-20-55: "permanent delete ... leaves no Storage object" moved to
  // trash-storage.spec.ts (manual-only) — it uploads a real object via
  // uploadDocumentFile() and asserts getDocumentFileSize() returns null
  // afterward, which needs a reachable Supabase Storage backend that CI's
  // dummy SUPABASE_URL does not provide.

  test("a low-value work confirms without typed-title entry", async ({ page }) => {
    // No document row at all (D-20-56): the dialog's typed-confirmation
    // threshold depends only on ready-document count and edition count,
    // both zero here exactly as they would be for a document that's merely
    // "uploaded" rather than "ready" — but a document row of any status
    // still carries a storagePath the deletion machine would try to remove
    // from Storage, which needs a real, reachable backend (see
    // trash-storage.spec.ts). Omitting the document row keeps this
    // deterministic under CI's dummy Storage config while still exercising
    // the same "not high-value" branch.
    const [work] = await db
      .insert(works)
      .values({ userId, title: "Plain Delete Work", deletedAt: new Date() })
      .returning({ id: works.id });

    await login(page);
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${work.id}"]`);
    await row.getByRole("button", { name: "Delete permanently now" }).click();

    const dialog = page.getByRole("dialog", { name: /Permanently delete/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Plain Delete Work");
    // No ready document and a single edition: no typed confirmation needed.
    await expect(dialog.getByLabel(/Type the work's title/i)).not.toBeVisible();
    const confirmButton = dialog.getByRole("button", { name: "Delete permanently" });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(row).not.toBeVisible();

    const [remaining] = await db.select({ id: works.id }).from(works).where(eq(works.id, work.id));
    expect(remaining).toBeUndefined();
  });

  test("a repeated permanent-delete request is idempotent, not an error (Phase 20.3)", async ({ page }) => {
    // Seeded inline (D-20-57) rather than via seedOwnedWork(), which
    // attaches a ready document — this test only cares about the purge
    // endpoint's idempotency, not document state, so a bare work keeps it
    // deterministic without a real Storage backend.
    const [work] = await db
      .insert(works)
      .values({ userId, title: "Idempotent Purge Work", deletedAt: new Date() })
      .returning({ id: works.id });
    const workId = work.id;

    await login(page);
    const first = await page.request.post(`/api/works/${workId}/purge`);
    expect(first.ok()).toBe(true);
    const firstBody = await first.json();
    expect(firstBody.outcome).toBe("completed");
    expect(firstBody.ok).toBe(true);

    // The work row is gone; a repeat of the same request reports the
    // already-completed deletion instead of failing.
    const second = await page.request.post(`/api/works/${workId}/purge`);
    expect(second.ok()).toBe(true);
    const secondBody = await second.json();
    expect(secondBody.outcome).toBe("completed");
    expect(secondBody.ok).toBe(true);
    expect(secondBody.alreadyCompleted).toBe(true);
  });

  test("a persisted storage-failure cleanup state is retried to completion on the next trash visit (Phase 20.3)", async ({ page }) => {
    // Simulates the honest partial-failure state converging on retry: DB
    // rows intact, cleanup row says Storage objects could not be removed,
    // but by the time this retry runs there is nothing left pending (e.g. a
    // prior run's Storage deletes actually all succeeded before a crash
    // prevented the final `completed` write). No document row and an empty
    // `pendingStoragePaths` (D-20-58) mean the retry makes zero Storage
    // calls, so this stays deterministic under CI's dummy Storage config.
    // The real "removing an already-missing object is idempotent"
    // regression — which needs a reachable Storage backend to prove
    // anything — lives in trash-storage.spec.ts.
    const [work] = await db
      .insert(works)
      .values({ userId, title: "Stuck Cleanup Work", deletedAt: new Date() })
      .returning({ id: works.id });
    await db.insert(deletionCleanups).values({
      userId,
      workId: work.id,
      workTitle: "Stuck Cleanup Work",
      status: "storage_failed",
      pendingStoragePaths: [],
      attempts: 1,
      lastError: "storage-delete: simulated outage",
    });

    await login(page);
    await page.goto("/works/trash");

    // The retry ran during the page's own data load; the work is gone.
    const row = page.locator(`[data-trash-item="${work.id}"]`);
    await expect(row).not.toBeVisible();

    await expect
      .poll(async () => {
        const [cleanup] = await db.select({ status: deletionCleanups.status }).from(deletionCleanups).where(eq(deletionCleanups.workId, work.id));
        return cleanup?.status;
      })
      .toBe("completed");
    const [remaining] = await db.select({ id: works.id }).from(works).where(eq(works.id, work.id));
    expect(remaining).toBeUndefined();
  });

  test("restoring a work with an unfinished cleanup cancels the pending deletion instead of letting a retry delete it (Phase 20.3)", async ({ page }) => {
    const [work] = await db
      .insert(works)
      .values({ userId, title: "Restored Mid-Cleanup Work", deletedAt: new Date() })
      .returning({ id: works.id });
    await db.insert(deletionCleanups).values({
      userId,
      workId: work.id,
      workTitle: "Restored Mid-Cleanup Work",
      status: "storage_failed",
      pendingStoragePaths: [`${userId}/${work.id}/stuck.txt`],
      attempts: 1,
      lastError: "storage-delete: simulated outage",
    });

    // Restore via the API directly (not via the trash page, whose load
    // would retry the cleanup first) — the row must be cancelled.
    await login(page);
    const restored = await page.request.post(`/api/works/${work.id}/restore`);
    expect(restored.ok()).toBe(true);
    const [cleanupAfterRestore] = await db.select({ id: deletionCleanups.id }).from(deletionCleanups).where(eq(deletionCleanups.workId, work.id));
    expect(cleanupAfterRestore).toBeUndefined();

    // Defense in depth: even if a stale cleanup row exists for an ACTIVE
    // work (restore raced the retry loop, or the cancel regressed), the
    // opportunistic retry must drop the row rather than delete the work.
    await db.insert(deletionCleanups).values({
      userId,
      workId: work.id,
      workTitle: "Restored Mid-Cleanup Work",
      status: "storage_failed",
      pendingStoragePaths: [],
      attempts: 1,
    });
    await page.goto("/works/trash"); // triggers retryPendingCleanups
    await expect(page.getByText("Trash", { exact: true }).first()).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await db.select({ id: deletionCleanups.id }).from(deletionCleanups).where(eq(deletionCleanups.workId, work.id));
        return row === undefined;
      })
      .toBe(true);
    const [survivor] = await db.select({ id: works.id, deletedAt: works.deletedAt }).from(works).where(eq(works.id, work.id));
    expect(survivor).toBeDefined();
    expect(survivor.deletedAt).toBeNull();
  });

  test("ready-work action links navigate and a move-to-trash confirmation can be cancelled", async ({ page }) => {
    const { workId } = await seedWorkWithLibraryItems(userId, "Ready-work controls", [
      { resourceTitle: "Ready-work source", relationship: "prerequisite" },
    ]);

    await login(page);
    await page.goto(`/works/${workId}`);
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();

    // The per-destination link row (WorkStatusPanel) that these labels used
    // to name was retired once WorkContextHeader's persistent tab strip
    // took over the same six destinations (Stage 4 spec §3.5) — repeating
    // them in both places would put the same destinations twice on one
    // screen (see WorkStatusPanel's own doc comment). Fixed 2026-07-28 to
    // navigate through that tab strip instead, with its own real labels.
    const nav = page.getByRole("navigation", { name: /sections/ });
    const destinations = [
      ["Roadmap", `/works/${workId}/roadmap`],
      ["Concept Check", `/works/${workId}/diagnostic`],
      ["Curriculum", `/works/${workId}/curriculum`],
      ["Knowledge Map", `/works/${workId}/graph`],
      ["Reader", `/works/${workId}/reader`],
    ] as const;
    for (const [label, href] of destinations) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/works/${workId}$`));
    }

    await page.getByRole("button", { name: "Move to trash" }).click();
    await expect(page.getByText("Move to trash? Restorable for 30 days.")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Move to trash" })).toBeVisible();
    await expect(page.getByText("Move to trash? Restorable for 30 days.")).not.toBeVisible();
  });
});
