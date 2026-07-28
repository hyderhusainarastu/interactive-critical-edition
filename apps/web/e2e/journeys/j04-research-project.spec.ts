import { expect, test } from "@playwright/test";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser } from "../helpers";
import { seedStage5Fixture, type Stage5Fixture } from "../stage5-verification-seed";

const email = `e2e-j04-research-${Date.now()}@example.com`;
const password = "password123";
let userId = "";
let fixture: Stage5Fixture;

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Charter §16 journey 4.  Paid provider dispatch is intentionally seeded: the
 * existing stage5-verification suite owns its queue/fixture assertions. */
test.describe("Journey 4 — Research project continuity", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(email, password);
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
    fixture = await seedStage5Fixture(userId, "j04");
  });
  test.afterAll(async () => deleteTestUser(email));

  test("project corpus, claim correction, chamber, monitor, and contextual map remain connected", async ({ page }) => {
    await login(page);
    await page.goto(`/research/${fixture.projectId}/corpus`);
    await expect(page.getByRole("heading", { name: "Corpus", exact: true })).toBeVisible();
    await page.goto(`/research/claims/${fixture.claimAId}`);
    // Next's streaming holder can transiently duplicate the hydrated route;
    // scope semantic assertions to the live application main landmark.
    const controls = page.locator("#main-content").locator('[data-research-correction-controls="claim"]');
    await expect(controls).toBeVisible();
    await page.goto(`/research/${fixture.projectId}/chambers`);
    await expect(page.getByRole("heading", { name: "Evidence Chambers" })).toBeVisible();
    await page.goto(`/research/${fixture.projectId}/monitors`);
    await expect(page.getByRole("heading", { name: "Monitors", exact: true })).toBeVisible();
    await page.goto(`/graph?ctxKind=debate&ctxId=${fixture.clusterId}&view=list&focus=all`);
    await expect(page.locator("#main-content")).toContainText(/Knowledge Map/i);
  });
});
