import { expect, test } from "@playwright/test";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser } from "../helpers";
import { seedStage5Fixture, type Stage5Fixture } from "../stage5-verification-seed";

const email = `e2e-j06-corrections-${Date.now()}@example.com`; const password = "password123";
let userId = ""; let fixture: Stage5Fixture;
async function login(page: import("@playwright/test").Page) { await page.goto("/login"); await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Log in" }).click(); await page.waitForURL("**/dashboard"); }

/** The exhaustive supported-action and revision-history coverage remains in
 * stage5-research-verification.spec.ts.  This guards its entry point. */
test.describe("Journey 6 — correction provenance", () => {
  test.beforeAll(async () => { userId = await createVerifiedTestUser(email, password); await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId)); fixture = await seedStage5Fixture(userId, "j06"); });
  test.afterAll(async () => deleteTestUser(email));
  test("claim and relationship correction surfaces are reachable from their contextual pages", async ({ page }) => {
    await login(page); await page.goto(`/research/claims/${fixture.claimAId}`);
    await expect(page.locator('[data-research-correction-controls="claim"]')).toBeVisible();
    await page.goto(`/research/debates/${fixture.clusterId}`);
    await expect(page.locator('[data-research-correction-controls="relationship"]')).toBeVisible();
  });
});
