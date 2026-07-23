import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";
import { db, learningResources, passageAnnotations, processingRuns, resourceRoles, workIdentities, works } from "@ice/db";
import { eq } from "drizzle-orm";

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
    await page.goto(`/works/${workId}/graph?layout=explore`);
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

    await page.goto(`/works/${workId}/graph?layout=explore`);
    await expect(page.getByLabel("Edge color legend")).toContainText("Citation / reference");
    await expect(page.getByLabel("Edge color legend")).toContainText("Prerequisite");
    await expect(page.getByLabel("Edge color legend")).toContainText("Structure");
  });

  test("the Kind filter persists in the URL and narrows the table to one node type", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();

    await page.getByLabel("Kind").selectOption("concept");
    await expect(page).toHaveURL(/[?&]type=concept/);
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveCount(0);
    // The uploaded work stays visible as the graph's anchor (D-21-10,
    // plan §21.12) — the Kind filter narrows the surrounding research web.
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();

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
    await page.goto(`/works/${workId}/graph?type=concept&layout=explore`);
    // 2 = the matching concept + the uploaded-work anchor (D-21-10).
    await expect(page.getByText("2 of 4 shown")).toBeVisible();
    await expect(page.getByLabel("Accessible graph browser")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.getByText("Accessible node browser").click();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByLabel("3D graph canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "3D" })).toHaveCount(0);
  });

  test("the Credibility filter persists in the URL and narrows to high-credibility references", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);

    await page.getByLabel("Credibility").selectOption("high");
    await expect(page).toHaveURL(/[?&]credibilityBand=high/);
    // 2 = the high-credibility reference + the uploaded-work anchor (D-21-10).
    await expect(page.getByText("2 of 4 shown")).toBeVisible();
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
    await page.goto("/graph?layout=explore");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toBeVisible();

    await page.getByLabel("Associated work").selectOption(`work:${first.workId}`);
    await expect(page).toHaveURL(new RegExp(`associatedWork=work%3A${first.workId}`));
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${first.bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toHaveCount(0);

    // Deep-linked filter state restores identically after a reload — exact
    // node IDs, not just the select's checkbox/value state (owner directive C).
    await page.reload();
    await expect(page.getByLabel("Associated work")).toHaveValue(`work:${first.workId}`);
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${first.bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toHaveCount(0);
  });

  test("the Search filter narrows by label/authors/kind, persists in the URL, and survives a reload", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();

    await page.getByLabel("Search", { exact: true }).fill("Physics");
    await expect(page).toHaveURL(/[?&]search=Physics/);
    // The bib record titled "Physics" matches; the concept and the section
    // do not. The uploaded work stays visible as the graph's anchor
    // (D-21-10) even though its own title doesn't match the search term.
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("Physics");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
  });

  test("the Reading status control narrows the table to one state and survives a reload", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    // The seeded bib record is not itself an owned work, so it renders as
    // "missing" (referenced, not acquired); the seeded concept has no
    // understanding rating, so it renders as "unread".
    await page.getByLabel("Reading status").selectOption("missing");
    await expect(page).toHaveURL(/[?&]state=missing/);
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Reading status")).toHaveValue("missing");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
  });

  test("the Authority filter narrows to one authority band and survives a reload", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    await page.getByLabel("Authority").selectOption("A");
    await expect(page).toHaveURL(/[?&]authority=A/);
    // Only the bib record carries an authority grade; the concept does not.
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Authority")).toHaveValue("A");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
  });

  test("the Provider filter narrows to one discovering provider and survives a reload", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    await page.getByLabel("Provider").selectOption("crossref");
    await expect(page).toHaveURL(/[?&]provider=crossref/);
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Provider")).toHaveValue("crossref");
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
  });

  test("Clear all filters resets every filter, stays URL-synced, and restores the unfiltered node/edge set", async ({ page }) => {
    const { workId, bibId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);

    const clearButton = page.getByRole("button", { name: "Clear all filters" });
    // Nothing to clear yet — the control is honestly disabled at the
    // all-default state rather than silently doing nothing on click.
    await expect(clearButton).toBeDisabled();

    // Stack several DIFFERENT filter fields at once (search + type + relation
    // + authority + credibility) to prove Clear all resets every one of
    // them, not just the last one touched.
    await page.getByLabel("Search", { exact: true }).fill("Physics");
    await page.getByLabel("Kind").selectOption("reference");
    await page.getByLabel("Relation").selectOption("cites");
    await page.getByLabel("Authority").selectOption("A");
    await page.getByLabel("Credibility").selectOption("high");
    await expect(page).toHaveURL(/search=Physics/);
    await expect(page).toHaveURL(/type=reference/);
    await expect(page).toHaveURL(/relation=cites/);
    await expect(page).toHaveURL(/authority=A/);
    await expect(page).toHaveURL(/credibilityBand=high/);

    await expect(clearButton).toBeEnabled();
    await clearButton.click();

    // URL-synced: every filter param is gone, none silently left behind.
    await expect(page).not.toHaveURL(/search=/);
    await expect(page).not.toHaveURL(/[?&]type=/);
    await expect(page).not.toHaveURL(/relation=/);
    await expect(page).not.toHaveURL(/authority=/);
    await expect(page).not.toHaveURL(/credibilityBand=/);

    // Every control visibly reflects the reset, and the button is disabled
    // again at the all-default state.
    await expect(page.getByLabel("Search", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Kind")).toHaveValue("all");
    await expect(page.getByLabel("Relation")).toHaveValue("all");
    await expect(page.getByLabel("Authority")).toHaveValue("all");
    await expect(page.getByLabel("Credibility")).toHaveValue("all");
    await expect(clearButton).toBeDisabled();

    // Exact node/edge set is restored — not just checkbox/select state.
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="section:${sectionBlockId}"]`)).toBeVisible();
    await expect(page.getByText("1 references · 0 sources · 1 concepts")).toBeVisible();
  });

  test("a table row and a graph selection share the bounded provenance inspector", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId);
    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);

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
    await page.goto(`/works/${workId}/graph?layout=explore`);
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
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByRole("button", { name: "Fullscreen" }).click();
    await expect(page.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Fullscreen" })).toBeVisible();
  });

  test("pinned uploaded works remain in the graph and table despite filters and survive a URL reload", async ({ page }) => {
    // Since D-21-10, uploaded works are visible by default under attribute
    // filters, so pinning's remaining visibility power is against the one
    // work-scoping filter (Associated work) — which is exactly what this
    // exercises: an unrelated work is scoped out, pinning brings it back,
    // and the pin round-trips through the URL.
    const first = await seedWorkWithGraphData(userId, { title: "Pinned first work" });
    const second = await seedWorkWithGraphData(userId, { title: "Pinned second work" });
    await login(page);
    await page.goto(`/graph?associatedWork=${encodeURIComponent(`work:${first.workId}`)}&layout=explore`);

    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toHaveCount(0);
    const pinned = page.getByLabel("Pinned uploaded works");
    await pinned.getByLabel("Pinned second work").check();
    await expect(page).toHaveURL(new RegExp(`pinnedWork=work%3A${second.workId}`));
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="work:${first.workId}"]`)).toBeVisible();

    await page.reload();
    await page.getByText("Accessible node browser").click();
    await expect(pinned.getByLabel("Pinned second work")).toBeChecked();
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toBeVisible();
  });

  test("the Relation filter hides non-matching edges between two visible nodes (D-21-1)", async ({ page }) => {
    // Two graph_edge rows of DIFFERENT edge types between the same
    // (work, bib) pair — plausible today because citation-resolution and
    // classification write independently. Filtering to one relation must
    // hide the other EDGE, not merely non-matching nodes (types.ts:219
    // previously kept every edge between two surviving endpoints).
    const { workId, bibId } = await seedWorkWithGraphData(userId, { withSecondEdgeType: true });

    await login(page);
    await page.goto(`/works/${workId}/graph?relation=cites&layout=explore`);

    // D-21-11 regression: this used to be a 4-way substring collision
    // ("Relation" matched the select's own label plus the "Relationship
    // color legend" / "3D relationship graph" / "Accessible relationship
    // browser" landmarks, forcing a `label`-locator workaround here). The
    // three landmarks are now named without the colliding substring, so
    // getByLabel("Relation") must resolve to exactly the one select.
    await expect(page.getByLabel("Relation")).toHaveCount(1);

    await page.getByText("Accessible node browser").click();
    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    await expect(bibRow).toBeVisible();
    await expect(bibRow).toContainText("cites");
    await expect(bibRow).not.toContainText("influences");

    await page.getByLabel("Relation").selectOption("influences");
    await expect(bibRow).toContainText("influences");
    await expect(bibRow).not.toContainText("cites");
  });

  test("uploaded-work anchors stay visible under non-work-exclusion filters without pinning (D-21-10)", async ({ page }) => {
    const { workId, bibId, conceptId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?type=concept&layout=explore`);
    await page.getByText("Accessible node browser").click();
    // The concept filter still honestly narrows the surrounding research web…
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveCount(0);
    // …but the uploaded work is the graph's anchor and stays visible by
    // default (plan §21.12), without requiring the user to pin it first.
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();
  });

  test("the graph payload carries the typed contract: uploaded, associatedWorkIds, destination, edge id/direction (21.1)", async ({ page }) => {
    const { workId, bibId, libraryResourceId } = await seedWorkWithGraphData(userId, { withLibraryResource: true });
    expect(libraryResourceId).toBeTruthy();

    await login(page);
    const response = await page.request.get(`/api/works/${workId}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as {
      nodes: { id: string; uploaded: boolean; associatedWorkIds: string[]; destination: string | null }[];
      links: { id: string; source: string; target: string; edgeType: string; directed: boolean; associatedWorkIds: string[] }[];
    };

    const workNode = graph.nodes.find((node) => node.id === `work:${workId}`);
    expect(workNode).toBeTruthy();
    expect(workNode!.uploaded).toBe(true);
    expect(workNode!.destination).toBe(`/works/${workId}`);
    expect(workNode!.associatedWorkIds).toContain(`work:${workId}`);

    const bibNode = graph.nodes.find((node) => node.id === `external:bib:${bibId}`);
    expect(bibNode).toBeTruthy();
    expect(bibNode!.uploaded).toBe(false);
    expect(bibNode!.destination).toBe(`/library/${libraryResourceId}`);
    expect(bibNode!.associatedWorkIds).toEqual([`work:${workId}`]);

    // Every edge carries the full contract: stable id, explicit direction,
    // and its own associated-work attribution.
    for (const link of graph.links) {
      expect(typeof link.id).toBe("string");
      expect(link.id.length).toBeGreaterThan(0);
      expect(typeof link.directed).toBe("boolean");
      expect(Array.isArray(link.associatedWorkIds)).toBeTruthy();
    }
    const cites = graph.links.find((link) => link.edgeType === "cites");
    expect(cites).toBeTruthy();
    expect(cites!.directed).toBe(true);
    expect(cites!.associatedWorkIds).toEqual([`work:${workId}`]);
  });

  test("the inspector and table offer a node's in-app destination when one exists", async ({ page }) => {
    const { workId, bibId, libraryResourceId } = await seedWorkWithGraphData(userId, { withLibraryResource: true });

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();
    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    await expect(bibRow.getByRole("link", { name: "Library entry" })).toHaveAttribute("href", `/library/${libraryResourceId}`);
    await bibRow.click();
    const inspector = page.getByLabel("Graph inspector");
    await expect(inspector.getByRole("link", { name: "View Library entry" })).toHaveAttribute("href", `/library/${libraryResourceId}`);
  });

  test("projects resource_role and passage_annotation relationships that buildGraph previously ignored (D-21-7)", async ({ page }) => {
    // Both are real, DB-invariant-backed relationship sources the plan
    // names (§21.2) that `buildGraph()` never queried before this fix —
    // seeded with relationships DISTINCT from the "cites"/"presupposes"
    // edges `seedWorkWithGraphData` already writes, so these two
    // assertions can only be explained by the new read paths, not the
    // pre-existing ones.
    const { workId, documentId, bibId, resourceId, sectionBlockId } = await seedWorkWithGraphData(userId, {
      title: "Resource-role and passage-annotation fixture",
    });

    const [identity] = await db
      .insert(workIdentities)
      .values({
        // Matches helpers.ts's `TEST_WORK_IDENTITY_KEY_PATTERN` (D-20-65) so
        // this fixture's `work_identity` row is swept on test-user teardown
        // like every other seeded one, instead of leaking into the shared
        // local Postgres.
        workKey: `work:graph-test:d-21-7-${workId}`,
        canonicalTitle: "Resource-role and passage-annotation fixture",
        authorSurname: "test",
        authors: ["Test Author"],
        evidence: "D-21-7 regression fixture",
      })
      .returning({ id: workIdentities.id });
    await db.update(works).set({ workIdentityId: identity.id }).where(eq(works.id, workId));
    const [libraryResource] = await db
      .insert(learningResources)
      .values({
        title: "Physics",
        normalizedKey: `seeded-lr-d-21-7-${workId}`,
        resourceType: "book",
        provider: "crossref",
        bibRecordId: bibId,
      })
      .returning({ id: learningResources.id });
    await db.insert(resourceRoles).values({
      learningResourceId: libraryResource.id,
      workIdentityId: identity.id,
      relationship: "prerequisite",
      readerLevel: null,
      rationale: "Read this before the primary text.",
      confidence: 0.9,
      createdBy: "system",
    });

    const [run] = await db.select({ id: processingRuns.id }).from(processingRuns).where(eq(processingRuns.documentId, documentId));
    await db.insert(passageAnnotations).values({
      runId: run.id,
      textBlockId: sectionBlockId,
      isWholeWork: false,
      quote: "Book II",
      summary: "Disputes a claim in the cited source.",
      explanation: "The source work explicitly argues against a position defended in Physics.",
      annotationType: "critique",
      relationship: "disagreement_polemical_target",
      confidence: 0.75,
      relatedResourceId: resourceId,
      createdBy: "system",
    });

    await login(page);
    const response = await page.request.get(`/api/works/${workId}/graph`);
    expect(response.ok()).toBeTruthy();
    const graph = await response.json() as {
      links: { source: string; target: string; edgeType: string; category: string | null; explanation?: string | null; evidence?: unknown }[];
    };

    const prerequisiteLink = graph.links.find((link) => link.edgeType === "is_prerequisite_for" && link.target === `external:bib:${bibId}`);
    expect(prerequisiteLink).toBeTruthy();
    expect(prerequisiteLink!.source).toBe(`work:${workId}`);
    expect(prerequisiteLink!.category).toBe("prerequisite");
    expect(prerequisiteLink!.explanation).toBe("Read this before the primary text.");

    const disagreementLink = graph.links.find((link) => link.edgeType === "disagrees_with" && link.target === `external:bib:${bibId}`);
    expect(disagreementLink).toBeTruthy();
    expect(disagreementLink!.source).toBe(`work:${workId}`);
    expect(disagreementLink!.category).toBe("disagreement_polemical_target");

    // Legend metadata: both new families (previously unexercised by any
    // other graph.spec.ts test) now appear, derived automatically from
    // `edgeFamilyFor()` — no separate legend wiring was needed.
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await expect(page.getByLabel("Edge color legend")).toContainText("Prerequisite");
    await expect(page.getByLabel("Edge color legend")).toContainText("Opposition");

    // Owner directive C: verify the pre-existing relation filter's
    // control -> URL/state -> filter function -> rendered output for these
    // two NEW edge-type values specifically (D-21-1's edge-level filtering,
    // now exercised against relation sources it was never proven against).
    await page.goto(`/works/${workId}/graph?relation=is_prerequisite_for&layout=explore`);
    await page.getByText("Accessible node browser").click();
    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    await expect(bibRow).toContainText("is prerequisite for");
    await expect(bibRow).not.toContainText("disagrees with");

    await page.getByLabel("Relation").selectOption("disagrees_with");
    await expect(bibRow).toContainText("disagrees with");
    await expect(bibRow).not.toContainText("is prerequisite for");
  });

  test("state legend displays 'Uploaded work' label (plan §20.2)", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);

    // The state legend on the graph page should include "Uploaded work" as a label
    // for the primary state (uploaded works). Use first() to avoid strict mode issues.
    await expect(page.getByText("Uploaded work").first()).toBeVisible();
  });

  // Phase 21.6 (D-21-2): selecting a node persistently focuses it — one-hop
  // neighbors stay emphasized, everything else fades — driven by SELECTION
  // state, not hover, so the effect survives the pointer moving away. The
  // default seed's own shape gives us a real "dimmed" case for free: `bib`
  // (Physics) has exactly one neighbor (`work`, via "cites"); `concept` and
  // `section` are each one hop from `work` but NOT connected to `bib` at
  // all, so selecting `bib` proves fade actually excludes something rather
  // than merely leaving everything lit.
  test("selecting a node keeps one-hop neighbors emphasized and fades the rest, persisting after the pointer moves elsewhere (D-21-2)", async ({ page }) => {
    const { workId, bibId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    const workRow = page.locator(`[data-graph-node="work:${workId}"]`);
    const conceptRow = page.locator(`[data-graph-node="concept:${conceptId}"]`);
    const sectionRow = page.locator(`[data-graph-node="section:${sectionBlockId}"]`);

    // Nothing selected yet: no focus effect is active anywhere.
    await expect(bibRow).toHaveAttribute("data-emphasis", "none");

    await bibRow.getByRole("button", { name: /Physics/ }).click();
    await expect(bibRow).toHaveAttribute("data-selected", "true");
    await expect(bibRow).toHaveAttribute("data-emphasis", "selected");
    await expect(workRow).toHaveAttribute("data-emphasis", "neighbor");
    await expect(conceptRow).toHaveAttribute("data-emphasis", "dimmed");
    await expect(sectionRow).toHaveAttribute("data-emphasis", "dimmed");

    // The dim persists once the pointer moves well away from the selection
    // — this is what actually proves the fix (D-21-2's literal defect was
    // that the old hover-driven fade vanished the instant the mouse left
    // the clicked node).
    await page.mouse.move(5, 5);
    await page.mouse.move(650, 400);
    await expect(conceptRow).toHaveAttribute("data-emphasis", "dimmed");
    await expect(sectionRow).toHaveAttribute("data-emphasis", "dimmed");
    await expect(bibRow).toHaveAttribute("data-emphasis", "selected");
  });

  test("the focus-mode toggle changes exactly which nodes are emphasized over the same shared node/edge set", async ({ page }) => {
    const { workId, bibId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    const conceptRow = page.locator(`[data-graph-node="concept:${conceptId}"]`);
    const sectionRow = page.locator(`[data-graph-node="section:${sectionBlockId}"]`);

    await bibRow.getByRole("button", { name: /Physics/ }).click();
    await expect(conceptRow).toHaveAttribute("data-emphasis", "dimmed");

    // Default mode is "Focus selected" — assert it's marked pressed.
    await expect(page.getByRole("button", { name: "Focus selected" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Expand one hop" }).click();
    await expect(page).toHaveURL(/focusMode=expand/);
    await expect(page.getByRole("button", { name: "Expand one hop" })).toHaveAttribute("aria-pressed", "true");
    // Two hops from bib reaches concept/section via work — nothing left dimmed.
    await expect(conceptRow).toHaveAttribute("data-emphasis", "neighbor");
    await expect(sectionRow).toHaveAttribute("data-emphasis", "neighbor");

    await page.getByRole("button", { name: "Full graph" }).click();
    await expect(page).toHaveURL(/focusMode=full/);
    // Fading is off entirely, even for the literally-selected node — but the
    // node is still marked selected, since that's a separate signal.
    await expect(bibRow).toHaveAttribute("data-emphasis", "none");
    await expect(conceptRow).toHaveAttribute("data-emphasis", "none");
    await expect(bibRow).toHaveAttribute("data-selected", "true");

    // Same exact node/edge SET throughout — the mode only changes emphasis,
    // it never forks the underlying filtered data.
    await expect(page.getByText("1 references · 0 sources · 1 concepts")).toBeVisible();

    // Reload restores the exact same mode from the URL.
    await page.reload();
    await expect(page.getByRole("button", { name: "Full graph" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Escape clears focus and restores keyboard focus; a visible Clear focus control does the same (D-21-2)", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    const bibButton = bibRow.getByRole("button", { name: /Physics/ });

    // "Clear focus" is honestly disabled when there is nothing to clear.
    const clearFocusButton = page.getByRole("button", { name: "Clear focus" });
    await expect(clearFocusButton).toBeDisabled();

    await bibButton.click();
    await expect(bibRow).toHaveAttribute("data-selected", "true");
    await expect(page).toHaveURL(new RegExp(`selected=external%3Abib%3A${bibId}`));
    await expect(clearFocusButton).toBeEnabled();

    await page.keyboard.press("Escape");
    await expect(bibRow).toHaveAttribute("data-selected", "false");
    await expect(bibRow).toHaveAttribute("data-emphasis", "none");
    await expect(page).not.toHaveURL(/selected=/);
    // Selection never moved focus to a transient overlay, so clearing it
    // leaves keyboard focus exactly where it already was.
    await expect(bibButton).toBeFocused();
    await expect(clearFocusButton).toBeDisabled();

    // The visible control does the same thing.
    await bibButton.click();
    await expect(bibRow).toHaveAttribute("data-selected", "true");
    await clearFocusButton.click();
    await expect(bibRow).toHaveAttribute("data-selected", "false");
    await expect(page).not.toHaveURL(/selected=/);
  });

  test("Escape while typing in the Search filter edits the field, not the graph selection", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    const bibButton = bibRow.getByRole("button", { name: /Physics/ });

    await bibButton.click();
    await expect(bibRow).toHaveAttribute("data-selected", "true");
    await expect(page).toHaveURL(new RegExp(`selected=external%3Abib%3A${bibId}`));

    const searchInput = page.getByRole("textbox", { name: "Search" });
    await searchInput.fill("Phys");
    await searchInput.press("Escape");

    // The input's own Escape semantics win — the graph selection survives.
    await expect(bibRow).toHaveAttribute("data-selected", "true");
    await expect(page).toHaveURL(new RegExp(`selected=external%3Abib%3A${bibId}`));
  });

  test("prev/next-connected-node keyboard navigation moves selection by exact node id in both directions (D-21-2)", async ({ page }) => {
    const { workId, bibId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await page.getByText("Accessible node browser").click();

    const workRow = page.locator(`[data-graph-node="work:${workId}"]`);
    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    const conceptRow = page.locator(`[data-graph-node="concept:${conceptId}"]`);
    const sectionRow = page.locator(`[data-graph-node="section:${sectionBlockId}"]`);

    // `work`'s three neighbors sorted by label: "Book II…" < "Hylomorphism"
    // < "Physics" — the deterministic order `connectedNodeIds` defines.
    await workRow.getByRole("button", { name: /On the Soul/ }).click();
    await expect(workRow).toHaveAttribute("data-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(sectionRow).toHaveAttribute("data-selected", "true");
    await expect(page).toHaveURL(new RegExp(`selected=section%3A${sectionBlockId}`));

    await page.keyboard.press("ArrowDown");
    await expect(conceptRow).toHaveAttribute("data-selected", "true");

    await page.keyboard.press("ArrowDown");
    await expect(bibRow).toHaveAttribute("data-selected", "true");

    // Wraps back to the first neighbor in the order.
    await page.keyboard.press("ArrowDown");
    await expect(sectionRow).toHaveAttribute("data-selected", "true");

    // Re-select work and walk backward: "previous" starts at the LAST
    // neighbor in the order (the opposite end from "next"'s first pick).
    await workRow.getByRole("button", { name: /On the Soul/ }).click();
    await page.keyboard.press("ArrowUp");
    await expect(bibRow).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(conceptRow).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(sectionRow).toHaveAttribute("data-selected", "true");
  });

  test("selecting a node does not clear active filters, and clearing filters does not clear a selection", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId);

    await login(page);
    await page.goto(`/works/${workId}/graph?layout=explore`);

    await page.getByLabel("Kind").selectOption("reference");
    await expect(page).toHaveURL(/type=reference/);

    await page.getByText("Accessible node browser").click();
    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    await bibRow.getByRole("button", { name: /Physics/ }).click();
    await expect(page).toHaveURL(/type=reference/);
    await expect(page).toHaveURL(/selected=/);
    await expect(bibRow).toHaveAttribute("data-selected", "true");

    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page).not.toHaveURL(/type=/);
    // The selection survived the filter reset — it's an orthogonal concern.
    await expect(page).toHaveURL(/selected=/);
    await expect(bibRow).toHaveAttribute("data-selected", "true");
  });
});
