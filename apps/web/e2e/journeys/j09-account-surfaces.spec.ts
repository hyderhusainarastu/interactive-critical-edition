import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "../helpers";

const email = `e2e-j09-account-${Date.now()}@example.com`; const password = "password123";
async function login(page: import("@playwright/test").Page) { await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Log in" }).click(); await page.waitForURL("**/dashboard"); }

test.describe("Journey 9 — account surfaces", () => {
  test.beforeAll(() => createVerifiedTestUser(email, password)); test.afterAll(() => deleteTestUser(email));
  test("profile, sharing, plan, usage and deletion confirmation remain available", async ({ page }) => {
    await login(page); await page.goto("/account/profile");
    await expect(page.getByLabel("Share my activity for research")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete my account" })).toBeVisible();
    await page.goto("/account/plan"); await expect(page.getByRole("heading", { name: "Beta (free)" })).toBeVisible();
    await page.goto("/account/usage"); await expect(page.locator("#main-content")).toContainText(/usage|activity/i);
  });
});
