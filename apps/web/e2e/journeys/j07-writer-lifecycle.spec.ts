import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "../helpers";

const email = `e2e-j07-writer-${Date.now()}@example.com`; const password = "password123";
async function login(page: import("@playwright/test").Page) { await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Log in" }).click(); await page.waitForURL("**/dashboard"); }

/** Charter §16 journey 7.  writer.spec.ts and writer-export.spec.ts own the
 * complete reorder/archive/revision/export payload checks; this is the matrix
 * entry-point check at each declared viewport. */
test.describe("Journey 7 — Writer lifecycle", () => {
  test.beforeAll(() => createVerifiedTestUser(email, password)); test.afterAll(() => deleteTestUser(email));
  test("creates a project, autosaves a draft, and exposes citation/export controls", async ({ page }) => {
    await login(page); await page.goto("/writer");
    page.once("dialog", (dialog) => dialog.accept("Journey 7 project"));
    await page.getByRole("button", { name: "New project" }).click(); await page.waitForURL("**/writer/*");
    await page.getByLabel("Draft").fill("A Stage 7 recoverable draft.");
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });
    await expect(page.getByLabel("Citation import format")).toBeVisible();
    await expect(page.getByLabel("Citation export format")).toBeVisible();
  });
});
