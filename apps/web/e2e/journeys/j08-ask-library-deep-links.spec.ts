import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "../helpers";

const email = `e2e-j08-ask-${Date.now()}@example.com`; const password = "password123"; let userId = ""; let workId = "";
async function login(page: import("@playwright/test").Page) { await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Log in" }).click(); await page.waitForURL("**/dashboard"); }

test.describe("Journey 8 — Ask Library direct/deep-link continuity", () => {
  test.beforeAll(async () => { userId = await createVerifiedTestUser(email, password); ({ workId } = await seedPublishedEdition(userId)); }); test.afterAll(() => deleteTestUser(email));
  test("direct Ask Library mounts one page controller and Reader mounts one contextual controller", async ({ page }) => {
    await login(page); await page.goto("/ask-library?mode=socratic");
    await expect(page.getByRole("region", { name: "Library-grounded Socratic chat" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: /^Ask Library/ })).toHaveCount(0);
    await page.goto(`/works/${workId}/reader`); await page.getByRole("button", { name: "Ask Library", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Ask Library — Reader panel" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: /^Ask Library/ })).toHaveCount(1);
  });
});
