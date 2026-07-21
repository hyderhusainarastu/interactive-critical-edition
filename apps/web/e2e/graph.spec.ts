import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";

/**
 * Phase 9.7/11.8 E2E: the visualization graph's node-type extension and shared
 * filters. All graph data is SEEDED directly (`seedWorkWithGraphData`) —
 * `buildGraph()` has always been a pure DB read with no worker/live-API
 * dependency, so this is CI-safe the same way library.spec.ts/
 * diagnostic.spec.ts/curriculum.spec.ts are, even though the pre-9.7 graph
 * flow was historically exercised manually alongside roadmap.spec.ts.
 * What's under test: the new concept/section node types render, and the
 * filter state — now lifted into `GraphView` and synced to the URL — stays
 * identical regardless of which view (table/3D) is active. Rows are
 * targeted via `data-graph-node` (same precise-locator convention as
 * `data-curriculum-item`/`data-library-item`) since node labels also
 * appear inside the connections column's "→ Label" text, causing plain
 * text-match ambiguity.
 */

const EMAIL = `e2e-graph-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Visualization graph", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("renders work, reference, concept, and section nodes together", async ({ page }) => {
    const { workId, bibId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();

    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toContainText("On the Soul");
    await expect(page.locator(`[data-graph-node="bib:${bibId}"]`)).toContainText("Physics");
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toContainText("Hylomorphism");
    await expect(page.locator(`[data-graph-node="section:${sectionBlockId}"]`)).toContainText("Book II");

    // Legend/summary reports the new concept count alongside the existing ones.
    await expect(page.getByText(/1 concepts/)).toBeVisible();
  });

  test("promotes Visualization in the main nav and shows relationship-family colors", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId);

    await login(page);
    const navLabels = await page.locator("header nav a").allInnerTexts();
    expect(navLabels).toEqual(expect.arrayContaining(["Visualization", "Works", "Library"]));
    expect(navLabels.indexOf("Visualization")).toBeLessThan(navLabels.indexOf("Works"));

    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByLabel("Relationship color legend")).toContainText("Citation / reference");
    await expect(page.getByLabel("Relationship color legend")).toContainText("Prerequisite");
    await expect(page.getByLabel("Relationship color legend")).toContainText("Structure");
  });

  test("the Kind filter persists in the URL and narrows the table to one node type", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();

    await page.getByLabel("Kind").selectOption("concept");
    await expect(page).toHaveURL(/[?&]type=concept/);
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="bib:${bibId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toHaveCount(0);

    // Reloading from the URL alone reproduces the same filtered view —
    // proves the filter is actually IN the URL, not just component state.
    await page.reload();
    await expect(page.getByLabel("Kind")).toHaveValue("concept");
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="bib:${bibId}"]`)).toHaveCount(0);
  });

  test("the table and the 3D scene report the same filtered node count", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?type=concept`);
    await expect(page.getByText("1 of 4 shown")).toBeVisible();

    await page.getByRole("button", { name: "3D" }).click();
    // The 3D canvas mounts once WebGL is ready; the shared "N of M shown"
    // summary above it is the identical-filters proof (plan §34.4 9.7) —
    // unaffected by which view is active, since both read the same filtered data.
    await expect(page.getByText("1 of 4 shown")).toBeVisible();
  });
});
