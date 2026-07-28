import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkInStatus, seedWorkWithGraphData } from "./helpers";

/**
 * Sources tab (Stage 4 read spec §3.4) — one work's own resolved sources,
 * reachable as its own persistent tab without opening the Reader. Seeded
 * via `seedWorkWithGraphData(..., { withLibraryResource: true })`, the same
 * `resource_role`/`learning_resource`/`work_identity` shape
 * `/library/[resourceId]`'s own eligibility check reads — a pure DB read
 * (`getLibrary()`), no worker/live-API dependency.
 */

const EMAIL = `e2e-sources-tab-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Sources tab (Stage 4 read spec §3.4)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("lists this work's own resolved sources with credibility and a link into the Library", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, {
      title: "Sources tab fixture",
      withLibraryResource: true,
    });

    await login(page);
    await page.goto(`/works/${workId}/sources`);

    // Reachable via the tab strip, not just a direct URL.
    const nav = page.getByRole("navigation", { name: /sections/ });
    await expect(nav.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");

    await expect(page.getByRole("link", { name: "Physics" })).toBeVisible();
    // A credibility signal renders for the seeded resource (score 0.82,
    // authority A → "Good credibility" band, per CredibilityMeter).
    await expect(page.getByText(/credibility/i).first()).toBeVisible();

    await page.getByRole("link", { name: "Physics" }).click();
    await expect(page).toHaveURL(/\/library\/[^/]+$/);
  });

  test("a not-yet-ready work explains Sources isn't available yet instead of showing an empty list", async ({ page }) => {
    const { workId } = await seedWorkInStatus(userId, "processing", { title: "Sources tab fixture (processing)" });

    await login(page);
    await page.goto(`/works/${workId}/sources`);
    await expect(page.getByText("Available once processing finishes.")).toBeVisible();
  });
});
