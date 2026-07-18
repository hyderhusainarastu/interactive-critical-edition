import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 6 E2E: a new (verified) user is routed through the onboarding step
 * on first login, can complete it, and then reaches the app normally
 * without being sent back. Needs web + Postgres (no worker).
 */
const EMAIL = `e2e-onboard-${Date.now()}@example.com`;
const PASSWORD = "password123";

test.describe("Onboarding (Phase 6)", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("new user is onboarded on first login, then reaches the library normally", async ({ page }) => {
    // Log in — a brand-new user has no onboardedAt, so the dashboard routes
    // them to /welcome.
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/welcome");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();

    // Choose an expertise level and complete → lands on upload.
    await page.getByRole("radio", { name: /New to the field/i }).check();
    await page.getByRole("button", { name: "Upload my first text" }).click();
    await page.waitForURL("**/upload");

    // Now the dashboard is reachable directly — onboarding no longer intercepts.
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: "Your library" })).toBeVisible();
  });
});
