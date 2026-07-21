import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

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
});
