import { db, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedLibraryItemForSourceAttach } from "./helpers";

const EMAIL = `e2e-upload-batch-${Date.now()}@example.com`;
const PASSWORD = "password123";

test.describe("Batch upload (Phase 14)", () => {
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("uploads files sequentially, pauses for a duplicate decision, and keeps later files waiting", async ({ page }) => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    const initCalls: Array<{ name: string; duplicateResolution?: string }> = [];
    await page.route("**/api/works/upload/init", async (route) => {
      const payload = route.request().postDataJSON() as { name: string; duplicateResolution?: string };
      initCalls.push(payload);
      if (payload.name === "duplicate.md" && !payload.duplicateResolution) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ duplicate: { workId: "11111111-1111-4111-8111-111111111111", title: "Existing duplicate" } }) });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          workId: `00000000-0000-4000-8000-${String(initCalls.length).padStart(12, "0")}`,
          documentId: `00000000-0000-4000-8001-${String(initCalls.length).padStart(12, "0")}`,
          uploadUrl: `${new URL(page.url()).origin}/test-signed-upload/${payload.name}`,
        }),
      });
    });
    await page.route("**/test-signed-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
    await page.route("**/api/works/upload/complete", async (route) => {
      const payload = route.request().postDataJSON() as { workId: string };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ workId: payload.workId }) });
    });

    await page.goto("/upload");
    await page.getByLabel("Choose files to upload").setInputFiles([
      { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first private text") },
      { name: "duplicate.md", mimeType: "text/markdown", buffer: Buffer.from("# duplicate") },
      { name: "last.md", mimeType: "text/markdown", buffer: Buffer.from("# last") },
    ]);

    const duplicate = page.locator('[data-upload-item="duplicate.md"]');
    await expect(page.getByRole("heading", { name: "Batch status" })).toBeVisible();
    await expect(duplicate).toContainText("Decision needed");
    await expect(page.locator('[data-upload-item="last.md"]')).toContainText("Waiting");
    expect(initCalls.map((call) => call.name)).toEqual(["first.txt", "duplicate.md"]);

    await duplicate.getByRole("button", { name: "Add as another edition" }).click();
    await expect(page.locator('[data-upload-item="first.txt"]')).toContainText("Queued for processing");
    await expect(duplicate).toContainText("Queued for processing");
    await expect(page.locator('[data-upload-item="last.md"]')).toContainText("Queued for processing");
    await expect(page.getByText("3 of 3 resolved")).toBeVisible();
    expect(initCalls.map((call) => `${call.name}:${call.duplicateResolution ?? ""}`)).toEqual([
      "first.txt:",
      "duplicate.md:",
      "duplicate.md:add_edition",
      "last.md:",
    ]);
  });

  test("records a per-file validation error and continues with the next file", async ({ page }) => {
    const errorEmail = `e2e-upload-error-${Date.now()}@example.com`;
    await createVerifiedTestUser(errorEmail, PASSWORD);
    await page.goto("/login");
    await page.getByLabel("Email").fill(errorEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    await page.route("**/api/works/upload/init", async (route) => {
      const payload = route.request().postDataJSON() as { name: string };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ workId: "00000000-0000-4000-8000-000000000001", documentId: "00000000-0000-4000-8001-000000000001", uploadUrl: `${new URL(page.url()).origin}/test-signed-upload/${payload.name}` }) });
    });
    await page.route("**/test-signed-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
    await page.route("**/api/works/upload/complete", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ workId: "00000000-0000-4000-8000-000000000001" }) }));

    await page.goto("/upload");
    await page.getByLabel("Choose files to upload").setInputFiles([
      { name: "unsupported.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("not supported yet") },
      { name: "continues.txt", mimeType: "text/plain", buffer: Buffer.from("continues privately") },
    ]);

    await expect(page.locator('[data-upload-item="unsupported.docx"]')).toContainText("Needs attention");
    await expect(page.locator('[data-upload-item="unsupported.docx"]')).toContainText("Unsupported file type");
    await expect(page.locator('[data-upload-item="continues.txt"]')).toContainText("Queued for processing");
    await deleteTestUser(errorEmail);
  });

  /**
   * Lane I live-issue fix: a Library item's "Upload this source" row
   * affordance deep-links here with `learningResourceId`/`title`/`author`
   * query params. Verifies the prefill banner renders and the carried id
   * reaches `/api/works/upload/init` — the same param that page already
   * validates and links for the Library entry detail page (Phase 20.4), so
   * no new server-side logic is exercised here, only the new wiring.
   */
  test("prefills the source-context banner and carries the deep-linked learningResourceId to /api/works/upload/init", async ({ page }) => {
    const contextEmail = `e2e-upload-context-${Date.now()}@example.com`;
    await createVerifiedTestUser(contextEmail, PASSWORD);
    await page.goto("/login");
    await page.getByLabel("Email").fill(contextEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    const initCalls: Array<{ name: string; learningResourceId?: string }> = [];
    await page.route("**/api/works/upload/init", async (route) => {
      const payload = route.request().postDataJSON() as { name: string; learningResourceId?: string };
      initCalls.push(payload);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          workId: "00000000-0000-4000-8000-000000000099",
          documentId: "00000000-0000-4000-8001-000000000099",
          uploadUrl: `${new URL(page.url()).origin}/test-signed-upload/${payload.name}`,
        }),
      });
    });
    await page.route("**/test-signed-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
    await page.route("**/api/works/upload/complete", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ workId: "00000000-0000-4000-8000-000000000099" }) }));

    const params = new URLSearchParams({ learningResourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Prefill Context Work", author: "Prefill Author" });
    await page.goto(`/upload?${params.toString()}`);
    await expect(page.getByText("Uploading the source text for")).toBeVisible();
    await expect(page.getByText("“Prefill Context Work”")).toBeVisible();
    await expect(page.getByText("by Prefill Author")).toBeVisible();

    await page.getByLabel("Choose files to upload").setInputFiles({ name: "prefilled.txt", mimeType: "text/plain", buffer: Buffer.from("prefilled context upload") });
    await expect(page.locator('[data-upload-item="prefilled.txt"]')).toContainText("Queued for processing");

    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].learningResourceId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    await deleteTestUser(contextEmail);
  });

  /**
   * Lane I live-issue fix, link-back proof: driving a real upload through
   * this deep-linked flow (real Storage PUT, real `/api/works/upload/init`
   * and `/complete`) results in the new work's `work_identity_id` actually
   * being set to the Library entry's own canonical identity — the same
   * server-side association `/api/works/upload/init`'s `learningResourceId`
   * handling already provides for the Library entry detail page's "Upload
   * source text" action (Phase 20.4); this proves it also fires correctly
   * when reached through the generic Upload page instead.
   */
  test("a real deep-linked upload links the new work to the Library entry's canonical identity", async ({ page }) => {
    const linkBackEmail = `e2e-upload-linkback-${Date.now()}@example.com`;
    const linkBackUserId = await createVerifiedTestUser(linkBackEmail, PASSWORD);
    const { resourceId, resourceWorkIdentityId } = await seedLibraryItemForSourceAttach(linkBackUserId, {
      resourceTitle: "Deep Linked Upload Work",
    });

    await page.goto("/login");
    await page.getByLabel("Email").fill(linkBackEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");

    const params = new URLSearchParams({ learningResourceId: resourceId, title: "Deep Linked Upload Work" });
    await page.goto(`/upload?${params.toString()}`);
    await expect(page.getByText("Uploading the source text for")).toBeVisible();

    await page.getByLabel("Choose files to upload").setInputFiles({
      name: "deep-link-source.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Deep-linked source text for the Lane I link-back verification."),
    });

    const item = page.locator('[data-upload-item="deep-link-source.txt"]');
    await expect(item).toContainText("Queued for processing", { timeout: 30000 });

    const openWork = item.getByRole("link", { name: "Open work" });
    const href = await openWork.getAttribute("href");
    const workId = href?.split("/works/")[1];
    expect(workId).toBeTruthy();

    const [work] = await db.select().from(works).where(eq(works.id, workId!));
    expect(work?.workIdentityId).toBe(resourceWorkIdentityId);
    // A resource-driven title beats a filename-derived guess (Phase 20.4)
    // — the whole point of carrying the Library entry through, not just
    // starting a blank upload.
    expect(work?.title).toBe("Deep Linked Upload Work");

    await deleteTestUser(linkBackEmail);
  });
});
