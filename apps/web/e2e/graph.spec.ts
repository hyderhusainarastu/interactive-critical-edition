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

  test("renders a canonical external work with aggregated provider provenance, concepts, and sections", async ({ page }) => {
    const { workId, bibId, resourceId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();

    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toContainText("On the Soul");
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toContainText("Physics");
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toContainText("Hylomorphism");
    await expect(page.locator(`[data-graph-node="section:${sectionBlockId}"]`)).toContainText("Book II");

    // The crossref observation is provenance on the canonical Physics node,
    // rather than a second parallel source node.
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-graph-node="source:${resourceId}"]`)).toHaveCount(0);
    await expect(page.getByText(/1 references · 0 sources · 1 concepts/)).toBeVisible();
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
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();

    await page.getByLabel("Kind").selectOption("concept");
    await expect(page).toHaveURL(/[?&]type=concept/);
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toHaveCount(0);

    // Reloading from the URL alone reproduces the same filtered view —
    // proves the filter is actually IN the URL, not just component state.
    await page.reload();
    await expect(page.getByLabel("Kind")).toHaveValue("concept");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveCount(0);
  });

  test("the 3D graph is primary and its keyboard browser is a secondary disclosure", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?type=concept`);
    await expect(page.getByText("1 of 4 shown")).toBeVisible();
    await expect(page.getByLabel("Accessible relationship browser")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByText("Accessible node browser").click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByLabel("3D relationship graph")).toBeVisible();
    await expect(page.getByRole("button", { name: "3D" })).toHaveCount(0);
  });

  test("the Credibility filter persists in the URL and narrows to high-credibility references", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph`);

    await page.getByLabel("Credibility").selectOption("high");
    await expect(page).toHaveURL(/[?&]credibilityBand=high/);
    await expect(page.getByText("1 of 4 shown")).toBeVisible();
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel("Credibility")).toHaveValue("high");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
  });

  test("the Work filter scopes the global visualization to nodes associated with one work", async ({ page }) => {
    const first = await seedWorkWithGraphData(userId);
    const second = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto("/graph");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toBeVisible();

    await page.getByLabel("Associated work").selectOption(`work:${first.workId}`);
    await expect(page).toHaveURL(new RegExp(`associatedWork=work%3A${first.workId}`));
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${first.bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toHaveCount(0);
  });

  test("a table row and a graph selection share the bounded provenance inspector", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId);
    await login(page);
    await page.goto(`/works/${workId}/graph`);

    await page.getByText("Accessible node browser").click();
    await page.locator(`[data-graph-node="external:bib:${bibId}"]`).click();
    const inspector = page.getByLabel("Graph inspector");
    await expect(inspector).toContainText("Physics");
    await expect(inspector).toContainText("Open-access source text indexed");
    await expect(inspector).toContainText("License evidence: CC BY 4.0");
    await expect(inspector).toContainText("crossref · inspection depth 1");
    await expect(inspector).toContainText("Direct connections");
    await expect(inspector).toContainText("On the Soul · cites");
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveAttribute("data-selected", "true");
  });

  test("the accessible table opens the same inspector by keyboard and reduced motion pauses graph effects", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await page.getByText("Accessible node browser").click();
    const row = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    await row.getByRole("button", { name: /Physics/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Graph inspector")).toContainText("License evidence: CC BY 4.0");
    await expect(page.locator("[data-graph-canvas]")).toHaveAttribute("data-graph-effects", "paused");
  });

  test("projects provenance-backed source-to-source relationships", async ({ page }) => {
    const { workId, bibId, relatedResourceId } = await seedWorkWithGraphData(userId, { withRelatedSource: true });
    expect(relatedResourceId).toBeTruthy();
    await login(page);
    const response = await page.request.get(`/api/works/${workId}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as { nodes: { id: string; type: string }[]; links: { source: string; target: string; edgeType: string; provenance?: unknown }[] };
    expect(graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.stringContaining("external:source:"), type: "peer_reviewed_source" })]));
    expect(graph.links).toEqual(expect.arrayContaining([expect.objectContaining({
      source: expect.stringContaining("external:source:"),
      target: `external:bib:${bibId}`,
      edgeType: "review_of",
      provenance: expect.any(Object),
    })]));
  });

  test("connects two uploaded works through one shared topic and returns no dangling graph links", async ({ page }) => {
    const first = await seedWorkWithGraphData(userId, { title: "First topic work" });
    const second = await seedWorkWithGraphData(userId, { title: "Second topic work", conceptId: first.conceptId });
    await login(page);
    const response = await page.request.get("/api/graph");
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as { nodes: { id: string }[]; links: { source: string; target: string; edgeType: string }[] };
    const sharedTopic = `concept:${first.conceptId}`;
    const topicLinks = graph.links.filter((link) => link.target === sharedTopic && link.edgeType === "presupposes");
    expect(topicLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: `work:${first.workId}` }),
      expect.objectContaining({ source: `work:${second.workId}` }),
    ]));
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(graph.links.every((link) => nodeIds.has(link.source) && nodeIds.has(link.target))).toBeTruthy();
    expect(new Set(graph.links.map((link) => `${link.source}:${link.target}:${link.edgeType}`)).size).toBe(graph.links.length);
  });

  test("projects relevant public material as supplementary D/E evidence, never scholarly evidence", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { withPublicSources: true });
    await login(page);
    const response = await page.request.get(`/api/works/${workId}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as { nodes: { provider: string; authority: string; supplementary: boolean; type: string }[] };
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "youtube", authority: "D", supplementary: true, type: "online_source" }),
      expect.objectContaining({ provider: "mastodon", authority: "E", supplementary: true, type: "online_source" }),
      expect.objectContaining({ provider: "bluesky", authority: "E", supplementary: true, type: "online_source" }),
    ]));
  });

  test("fullscreen applies to the graph stage and Escape restores the control", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId);
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await page.getByRole("button", { name: "Fullscreen" }).click();
    await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Fullscreen" })).toBeVisible();
  });

  test("pinned uploaded works remain in the graph and table despite filters and survive a URL reload", async ({ page }) => {
    const first = await seedWorkWithGraphData(userId, { title: "Pinned first work" });
    const second = await seedWorkWithGraphData(userId, { title: "Pinned second work" });
    await login(page);
    await page.goto("/graph?type=concept");

    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toHaveCount(0);
    const pinned = page.getByLabel("Pinned uploaded works");
    await pinned.getByLabel("Pinned first work").check();
    await expect(page).toHaveURL(new RegExp(`pinnedWork=work%3A${first.workId}`));
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toHaveCount(0);

    await page.reload();
    await page.getByText("Accessible node browser").click();
    await expect(pinned.getByLabel("Pinned first work")).toBeChecked();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
  });
});
