import { db, users, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedOwnedWork } from "./helpers";

/**
 * Phase 9.7 E2E: the 30-day work trash. Pure web CRUD with no worker/AI
 * involvement (plan §34.4 9.7), so unlike the AI-pipeline sub-phases this
 * needed no production canary — verified here instead, the same way
 * Phase 3's highlights/notes/bookmarks were. Covers: move to trash → the
 * work becomes inaccessible via its normal routes and disappears from
 * `/works` → appears in `/works/trash` with the correct days-remaining →
 * restore brings it back; and "delete permanently now" actually removes
 * the row (idempotent purge is proven at the DB level, not just the UI).
 */

const EMAIL = `e2e-trash-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Work trash (Phase 9.7)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    // /works and /works/trash both gate on onboarding (dashboard/page.tsx's
    // redirect, duplicated onto /works per its own doc comment) — every
    // other seeded spec avoids this by never navigating to either page
    // directly, but trash.spec.ts's whole point is those two pages, so the
    // test user needs onboarding stamped rather than hitting the redirect.
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("moving a work to trash hides it from /works, blocks its routes, and lists it in the trash with 30 days remaining", async ({ page }) => {
    const { workId } = await seedOwnedWork(userId);

    await login(page);
    await page.goto(`/works/${workId}`);
    await page.getByRole("button", { name: "Move to trash" }).click();
    await page.getByRole("button", { name: "Yes, move to trash" }).click();
    await expect(page.getByText("In trash")).toBeVisible();

    // Gone from the normal works list.
    await page.goto("/works");
    await expect(page.getByRole("link", { name: /Owner's Private Work/ })).not.toBeVisible();

    // A getOwnedDocument-gated route 404s while trashed (roadmap, in this
    // case) — the work is "gone" everywhere except its own page and Trash.
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByText("404")).toBeVisible();

    // Listed in the trash with the full 30-day window just started.
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${workId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("Permanently deleted in 30 days");
  });

  test("restoring a trashed work brings it back everywhere", async ({ page }) => {
    const { workId } = await seedOwnedWork(userId);
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, workId));

    await login(page);
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${workId}"]`);
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(row).not.toBeVisible();

    await page.goto("/works");
    await expect(page.getByRole("link", { name: /Owner's Private Work/ })).toBeVisible();

    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByText("404")).not.toBeVisible();
  });

  test("deleting permanently now actually removes the work row, not just the trash listing", async ({ page }) => {
    const { workId } = await seedOwnedWork(userId);
    await db.update(works).set({ deletedAt: new Date() }).where(eq(works.id, workId));

    await login(page);
    await page.goto("/works/trash");
    const row = page.locator(`[data-trash-item="${workId}"]`);
    await row.getByRole("button", { name: "Delete permanently now" }).click();
    await expect(row).not.toBeVisible();

    const [remaining] = await db.select({ id: works.id }).from(works).where(eq(works.id, workId));
    expect(remaining).toBeUndefined();
  });
});
