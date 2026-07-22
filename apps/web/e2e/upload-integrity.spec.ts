import { expect, test } from "@playwright/test";
import { db, documents, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Manual-only: this suite deliberately exercises a real Supabase signed URL
 * and verifies Storage metadata. CI uses dummy Storage configuration and must
 * keep its deterministic upload UI fixture separate.
 */
const QUOTA_EMAIL = `e2e-upload-quota-${Date.now()}@example.com`;
const MISMATCH_EMAIL = `e2e-upload-mismatch-${Date.now()}@example.com`;
const MISSING_EMAIL = `e2e-upload-missing-${Date.now()}@example.com`;
const PASSWORD = "password123";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Signed upload integrity (Phase 19)", () => {
  test.afterAll(async () => {
    await deleteTestUser(QUOTA_EMAIL);
    await deleteTestUser(MISMATCH_EMAIL);
    await deleteTestUser(MISSING_EMAIL);
  });

  test("reserves quota for an active signed-upload staging row", async ({ page }) => {
    const userId = await createVerifiedTestUser(QUOTA_EMAIL, PASSWORD);
    const [stagingWork] = await db
      .insert(works)
      .values({ userId, title: "Reserved signed upload", workType: "primary" })
      .returning({ id: works.id });
    await db.insert(documents).values({
      userId,
      workId: stagingWork.id,
      storagePath: `${userId}/${stagingWork.id}/pending.pdf`,
      originalFilename: "pending.pdf",
      mimeType: "application/pdf",
      fileSize: 500 * 1024 * 1024,
      processingStatus: "uploaded",
    });

    await login(page, QUOTA_EMAIL);
    const response = await page.request.post("/api/works/upload/init", {
      data: { name: "one-byte.txt", type: "text/plain", size: 1 },
    });

    expect(response.status()).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("storage quota") });
  });

  test("rejects and cleans up a direct upload whose stored byte count differs from its reservation", async ({ page }) => {
    await createVerifiedTestUser(MISMATCH_EMAIL, PASSWORD);
    await login(page, MISMATCH_EMAIL);

    const init = await page.request.post("/api/works/upload/init", {
      data: { name: "mismatch.pdf", type: "application/pdf", size: 1 },
    });
    expect(init.status()).toBe(200);
    const staged = await init.json() as { workId: string; documentId: string; uploadUrl: string };

    const put = await page.request.put(staged.uploadUrl, {
      headers: { "content-type": "application/pdf" },
      data: Buffer.from("%%"),
    });
    expect(put.ok()).toBe(true);

    const complete = await page.request.post("/api/works/upload/complete", {
      data: { workId: staged.workId, documentId: staged.documentId },
    });
    expect(complete.status()).toBe(400);
    await expect(complete.json()).resolves.toMatchObject({ error: expect.stringContaining("bytes") });

    const [leftover] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, staged.documentId));
    expect(leftover).toBeUndefined();
  });

  test("releases a reservation when completion finds no uploaded object", async ({ page }) => {
    await createVerifiedTestUser(MISSING_EMAIL, PASSWORD);
    await login(page, MISSING_EMAIL);

    const init = await page.request.post("/api/works/upload/init", {
      data: { name: "missing.pdf", type: "application/pdf", size: 1 },
    });
    expect(init.status()).toBe(200);
    const staged = await init.json() as { workId: string; documentId: string };

    const complete = await page.request.post("/api/works/upload/complete", {
      data: { workId: staged.workId, documentId: staged.documentId },
    });
    expect(complete.status()).toBe(400);
    await expect(complete.json()).resolves.toMatchObject({ error: expect.stringContaining("not found in Storage") });

    const [leftover] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, staged.documentId));
    expect(leftover).toBeUndefined();
  });
});
