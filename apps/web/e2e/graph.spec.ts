import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";

/**
 * Phase 9.7/11.8/11.9 E2E: the visualization graph's node-type extension and shared
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

  test("renders work, reference, provenance-backed source, concept, and section nodes together", async ({ page }) => {
    const { workId, bibId, resourceId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();

    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toContainText("On the Soul");
    await expect(page.locator(`[data-graph-node="bib:${bibId}"]`)).toContainText("Physics");
    await expect(page.locator(`[data-graph-node="source:${resourceId}"]`)).toContainText("Physics");
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toContainText("Hylomorphism");
    await expect(page.locator(`[data-graph-node="section:${sectionBlockId}"]`)).toContainText("Book II");

    // Legend/summary reports the new concept count alongside the existing ones.
    await expect(page.getByText(/1 sources · 1 concepts/)).toBeVisible();
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

  test("the table and 3D graph are shown together from the same filtered data", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?type=concept`);
    await expect(page.getByText("1 of 5 shown")).toBeVisible();
    await expect(page.getByLabel("Accessible relationship table")).toBeVisible();
    await expect(page.getByLabel("3D relationship graph")).toBeVisible();
    await expect(page.getByRole("button", { name: "3D" })).toHaveCount(0);
  });

  test("the Credibility filter persists in the URL and narrows to high-credibility references", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph`);

    await page.getByLabel("Credibility").selectOption("high");
    await expect(page).toHaveURL(/[?&]credibilityBand=high/);
    await expect(page.getByText("2 of 5 shown")).toBeVisible();
    await expect(page.locator(`[data-graph-node="bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel("Credibility")).toHaveValue("high");
    await expect(page.locator(`[data-graph-node="bib:${bibId}"]`)).toBeVisible();
  });

  test("the Work filter scopes the global visualization to nodes associated with one work", async ({ page }) => {
    const first = await seedWorkWithGraphData(userId);
    const second = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto("/graph");
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toBeVisible();

    await page.getByLabel("Associated work").selectOption(`work:${first.workId}`);
    await expect(page).toHaveURL(new RegExp(`associatedWork=work%3A${first.workId}`));
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="bib:${first.bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toHaveCount(0);
  });

  test("a table row and a graph selection share the bounded provenance inspector", async ({ page }) => {
    const { workId, resourceId } = await seedWorkWithGraphData(userId);
    await login(page);
    await page.goto(`/works/${workId}/graph`);

    await page.locator(`[data-graph-node="source:${resourceId}"]`).click();
    const inspector = page.getByLabel("Graph inspector");
    await expect(inspector).toContainText("Physics");
    await expect(inspector).toContainText("Open-access source text indexed");
    await expect(inspector).toContainText("License evidence: CC BY 4.0");
    await expect(inspector).toContainText("crossref · inspection depth 1");
    await expect(page.locator(`[data-graph-node="source:${resourceId}"]`)).toHaveAttribute("data-selected", "true");
  });

  test("the accessible table opens the same inspector by keyboard and reduced motion pauses graph effects", async ({ page }) => {
    const { workId, resourceId } = await seedWorkWithGraphData(userId);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    const row = page.locator(`[data-graph-node="source:${resourceId}"]`);
    await row.getByRole("button", { name: /Physics/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Graph inspector")).toContainText("License evidence: CC BY 4.0");
    await expect(page.locator("[data-graph-canvas]")).toHaveAttribute("data-graph-effects", "paused");
  });

  test("projects provenance-backed source-to-source relationships", async ({ page }) => {
    const { workId, resourceId, relatedResourceId } = await seedWorkWithGraphData(userId, { withRelatedSource: true });
    expect(relatedResourceId).toBeTruthy();
    await login(page);
    const response = await page.request.get(`/api/works/${workId}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as { nodes: { id: string; type: string }[]; links: { source: string; target: string; edgeType: string; provenance?: unknown }[] };
    expect(graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: `source:${relatedResourceId}`, type: "peer_reviewed_source" })]));
    expect(graph.links).toEqual(expect.arrayContaining([expect.objectContaining({
      source: `source:${relatedResourceId}`,
      target: `source:${resourceId}`,
      edgeType: "review_of",
      provenance: expect.any(Object),
    })]));
  });

  test("pinned uploaded works remain in the graph and table despite filters and survive a URL reload", async ({ page }) => {
    const first = await seedWorkWithGraphData(userId, { title: "Pinned first work" });
    const second = await seedWorkWithGraphData(userId, { title: "Pinned second work" });
    await login(page);
    await page.goto("/graph?type=concept");

    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toHaveCount(0);
    const pinned = page.getByLabel("Pinned uploaded works");
    await pinned.getByLabel("Pinned first work").check();
    await expect(page).toHaveURL(new RegExp(`pinnedWork=work%3A${first.workId}`));
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toHaveCount(0);

    await page.reload();
    await expect(pinned.getByLabel("Pinned first work")).toBeChecked();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
  });
});
