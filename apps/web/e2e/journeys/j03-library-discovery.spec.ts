import { expect, test, type Page } from "@playwright/test";
import {
  createVerifiedTestUser,
  deleteTestUser,
  seedLibraryItemForSourceAttach,
  seedSearchableLibraryItem,
  seedWorkWithLibraryItems,
} from "../helpers";

/**
 * Stage 7 journey matrix — charter §16 journey 3:
 * "Library search/filter → distinguish uploaded from cited-only → inspect
 * credibility/provenance/access → set reading state → upload a missing
 * source."
 *
 * Fully seeded (`seedLibraryItemForSourceAttach`/`seedSearchableLibraryItem`/
 * `seedWorkWithLibraryItems`, `../helpers.ts`) — the Library page is a pure
 * DB read (`getLibrary()`), no worker/live-API dependency, same CI-safety
 * reasoning as `library.spec.ts` itself.
 */

const EMAIL = `e2e-j03-library-discovery-${Date.now()}@example.com`;
const PASSWORD = "password123";

function main(page: Page) {
  return page.locator("#main-content");
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Journey 3 — Library discovery", () => {
  let userId = "";

  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("3a — search/filter narrows results, and the distinguishing tabs/counts render", async ({ page }) => {
    await seedSearchableLibraryItem(userId, { resourceTitle: "The Structure of Scientific Revolutions" });
    await seedSearchableLibraryItem(userId, { resourceTitle: "An Essay Concerning Human Understanding" });

    await login(page);
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    const content = main(page);
    await content.getByLabel("Focus work", { exact: true }).selectOption("");

    // Reading-state tab counts (the default "To read" tab) — a per-item
    // reading-state facet, one signal of the charter's own "distinguish
    // uploaded from cited-only" alongside the Upload-affordance check below.
    await expect(page.getByRole("button", { name: /To read \(\d+\)/ })).toBeVisible();

    await content.getByLabel("Search library").fill("Scientific Revolutions");
    await expect(content.getByRole("listitem").filter({ hasText: "The Structure of Scientific Revolutions" })).toBeVisible();
    await expect(content.getByRole("listitem").filter({ hasText: "An Essay Concerning Human Understanding" })).not.toBeVisible();
  });

  test("3b — distinguishes uploaded (owned) from cited-only, inspects credibility/provenance, and offers upload for a missing source", async ({ page }) => {
    const { resourceId: unownedResourceId } = await seedLibraryItemForSourceAttach(userId, {
      resourceTitle: "Unowned Source Needing Upload",
      recommendingWorkTitle: "Recommending Work For Unowned",
    });
    await seedLibraryItemForSourceAttach(userId, {
      resourceTitle: "Already Owned Source",
      recommendingWorkTitle: "Recommending Work For Owned",
      alreadyOwned: true,
    });
    // A credibility-scored item, so the "inspect credibility" step has a
    // real band to assert on (same shape sources-tab.spec.ts's own
    // "Good credibility" assertion uses).
    await seedWorkWithLibraryItems(userId, "Credibility Inspection Work", [
      { resourceTitle: "Credibility Inspected Source", relationship: "prerequisite", credibilityScore: 0.82 },
    ]);

    await login(page);
    await page.goto("/library");
    const content = main(page);
    await content.getByLabel("Focus work", { exact: true }).selectOption("");

    // Distinguish uploaded (owned) from cited-only: only the unowned item
    // carries the "Upload this source" affordance.
    const unownedRow = content.locator("[data-library-item]").filter({ hasText: "Unowned Source Needing Upload" });
    const ownedRow = content.locator("[data-library-item]").filter({ hasText: "Already Owned Source" });
    await expect(unownedRow).toBeVisible();
    await expect(ownedRow).toBeVisible();
    const affordance = unownedRow.getByRole("link", { name: "Upload this source" });
    await expect(affordance).toBeVisible();
    const href = await affordance.getAttribute("href");
    expect(href).toContain("/upload?");
    expect(href).toContain(`learningResourceId=${unownedResourceId}`);
    await expect(ownedRow.getByRole("link", { name: "Upload this source" })).toHaveCount(0);

    // Inspect credibility/provenance for the credibility-scored item.
    const credibilityRow = content.locator("[data-library-item]").filter({ hasText: "Credibility Inspected Source" });
    await expect(credibilityRow).toBeVisible();
    await expect(credibilityRow.getByText(/credibility/i).first()).toBeVisible();

    // Set reading state on the owned item, and confirm it persists.
    const readingSelect = ownedRow.getByLabel(/Reading status of/);
    await readingSelect.selectOption("reading");
    await expect(readingSelect).toHaveValue("reading");
    await page.reload();
    await content.getByLabel("Focus work", { exact: true }).selectOption("");
    await expect(main(page).locator("[data-library-item]").filter({ hasText: "Already Owned Source" }).getByLabel(/Reading status of/)).toHaveValue("reading");

    // Upload a missing source: follow the deep link from the unowned row.
    await affordance.click();
    await page.waitForURL("**/upload?**");
    await expect(page.getByText("Uploading the source text for")).toBeVisible();
    await expect(page.getByText("“Unowned Source Needing Upload”")).toBeVisible();
  });
});
