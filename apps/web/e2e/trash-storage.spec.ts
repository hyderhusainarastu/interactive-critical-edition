import {
  bibliographicRecords,
  db,
  deletionCleanups,
  documents,
  graphEdges,
  pages,
  processingRuns,
  ragChunks,
  textBlocks,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { getDocumentFileSize, uploadDocumentFile } from "@ice/ingestion";
import { and, eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork } from "./helpers";

/**
 * Manual-only (D-20-55..59): the Phase 20.3 permanent-deletion regressions
 * that genuinely need a reachable Supabase Storage backend, split out of
 * trash.spec.ts for the same reason upload-integrity.spec.ts is manual-only
 * — CI runs with dummy SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY values (see
 * .github/workflows/ci.yml) so that @ice/ingestion's storage client
 * constructs at import time without CI needing a real Supabase project, but
 * any actual network call against that dummy host throws
 * (`StorageUnknownError: fetch failed`). The `@ice/deletion` state machine
 * correctly and honestly reports that as `storage_failed`, not `completed`
 * — see packages/deletion/src/index.ts's doc comment — so a real Storage
 * object being genuinely removed, and a real "removing an already-missing
 * object resolves rather than throws" idempotency check, can only be proven
 * against a real, reachable Storage backend. Run manually
 * (`pnpm --filter web test:e2e trash-storage.spec.ts`) against the local
 * dev stack, which is configured with real Supabase Storage credentials
 * (see docs/PROJECT-LOG.md's D-19-4/D-19-10 notes on why a long-lived local
 * environment is not equivalent to CI, and why that cuts both ways here:
 * these tests need the very thing CI deliberately doesn't have).
 */

const EMAIL = `e2e-trash-storage-${Date.now()}@example.com`;
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

test.describe("Work trash — real-Storage regressions (Phase 20.3)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("permanent delete walks the typed-title confirmation dialog, cascades private rows, preserves the shared catalog, and leaves no Storage object", async ({ page }) => {
    const { workId, documentId } = await seedOwnedWork(userId);
    const storagePath = `${userId}/${workId}/none.txt`;

    // A real private Storage object at the document's path — "no orphaned
    // private object" must be proven against real Storage, not a placeholder.
    await uploadDocumentFile({ path: storagePath, data: Buffer.from("private bytes"), contentType: "text/plain" });
    expect(await getDocumentFileSize(storagePath)).not.toBeNull();

    // Shared canonical identity + a polymorphic graph edge + a RAG chunk.
    const [identity] = await db
      .insert(workIdentities)
      .values({ workKey: `e2e-trash-storage-${workId}`, canonicalTitle: "Owner's Private Work" })
      .returning({ id: workIdentities.id });
    await db.update(works).set({ workIdentityId: identity.id, deletedAt: new Date() }).where(eq(works.id, workId));
    const [bib] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.title, "Critique of Pure Reason"))
      .limit(1);
    await db.insert(graphEdges).values({
      userId,
      sourceType: "work",
      sourceId: workId,
      targetType: "bibliographic_record",
      targetId: bib.id,
      edgeType: "cites",
    });
    await seedRagChunkForWork({ workId, documentId, content: "Private text. Kant is referenced here." });

    await login(page);
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${workId}"]`);
    await row.getByRole("button", { name: "Delete permanently now" }).click();

    // The dialog names the work and explains irreversibility.
    const dialog = page.getByRole("dialog", { name: /Permanently delete/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Owner's Private Work");
    await expect(dialog).toContainText(/cannot be undone/i);

    // High-value work (ready document): typed-title confirmation required.
    const confirmButton = dialog.getByRole("button", { name: "Delete permanently" });
    await expect(confirmButton).toBeDisabled();
    const titleInput = dialog.getByLabel(/Type the work's title/i);
    await titleInput.fill("Wrong Title");
    await expect(confirmButton).toBeDisabled();
    await titleInput.fill("Owner's Private Work");
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(row).not.toBeVisible();

    // Private rows are gone, including rows Postgres cannot cascade.
    const [workRow] = await db.select({ id: works.id }).from(works).where(eq(works.id, workId));
    expect(workRow).toBeUndefined();
    const docRows = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, workId));
    expect(docRows).toHaveLength(0);
    const chunkRows = await db.select({ id: ragChunks.id }).from(ragChunks).where(eq(ragChunks.workId, workId));
    expect(chunkRows).toHaveLength(0);
    const edgeRows = await db
      .select({ id: graphEdges.id })
      .from(graphEdges)
      .where(and(eq(graphEdges.userId, userId), eq(graphEdges.sourceId, workId)));
    expect(edgeRows).toHaveLength(0);

    // Shared catalog rows survive — they are not user-private data.
    const [bibRow] = await db.select({ id: bibliographicRecords.id }).from(bibliographicRecords).where(eq(bibliographicRecords.id, bib.id));
    expect(bibRow).toBeDefined();
    const [identityRow] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.id, identity.id));
    expect(identityRow).toBeDefined();

    // The real Storage object is gone, and the deletion recorded a completed
    // cleanup (the audit trail the admin queue reads).
    expect(await getDocumentFileSize(storagePath)).toBeNull();
    const [cleanup] = await db.select().from(deletionCleanups).where(eq(deletionCleanups.workId, workId));
    expect(cleanup?.status).toBe("completed");
    expect(cleanup?.pendingStoragePaths).toEqual([]);
  });

  test("a persisted storage-failure cleanup recovers once the pending Storage object no longer exists", async ({ page }) => {
    // Simulates the honest partial-failure state: DB rows intact, cleanup
    // row says a Storage object could not be removed. The path points at an
    // object that was never actually uploaded, so against a real, reachable
    // Storage backend the retry's remove() call resolves (removing an
    // already-missing object is idempotent — see
    // packages/deletion/src/index.ts's `deleteStorageObject` contract) and
    // the deletion completes. This is the real-Storage counterpart of
    // trash.spec.ts's CI-safe "empty pendingStoragePaths" variant of the
    // same scenario.
    const [work] = await db
      .insert(works)
      .values({ userId, title: "Stuck Cleanup Work (real Storage)" })
      .returning({ id: works.id });
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, work.id));
    await db.insert(deletionCleanups).values({
      userId,
      workId: work.id,
      workTitle: "Stuck Cleanup Work (real Storage)",
      status: "storage_failed",
      pendingStoragePaths: [`${userId}/${work.id}/already-gone.txt`],
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
});
