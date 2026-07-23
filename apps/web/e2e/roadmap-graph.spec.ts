import { expect, test } from "@playwright/test";
import { bibliographicRecords, db, graphEdges } from "@ice/db";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";

/**
 * Phase 22.8 (feature plan §2.3/§2.4, §5 Feature A): the Roadmap layout mode
 * client half — mode toggle (Roadmap is the DEFAULT), the "Roadmap for"
 * root-work selection, the stage filter, the progress strip/next-up chip,
 * sequence stepping, and the accessible table's roadmap columns. All data is
 * SEEDED directly (`seedWorkWithGraphData` plus a few extra hand-inserted
 * `bibliographic_record`/`graph_edge` rows for the acceptance fixture,
 * mirroring `graph-scene.spec.ts`'s own precedent for a custom edge shape) —
 * `computeRoadmapCandidates` is a pure DB read with no worker/live-API
 * dependency, so this is CI-safe the same way `graph.spec.ts` already is.
 *
 * WebGL scene internals (fixed 3D positions, the next-up ring, stage column
 * header sprites) are NOT E2E-assertable, per the same precedent
 * `graph-scene.spec.ts` documents — those are covered by
 * `roadmapLayout.test.ts`'s pure-function unit tests instead. What IS
 * asserted here is the shared derivation both the 3D scene and the table
 * consume (`displayed` in `GraphView.tsx`) via the accessible table and the
 * "X of Y shown" counter, exactly the technique every other filter test in
 * `graph.spec.ts` already uses.
 */

const EMAIL = `e2e-roadmap-graph-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Inserts one additional `bibliographic_record` + `work -[cites]->` edge
 *  carrying a given relationship category — the roadmap traversal reads
 *  `evidence->>'category'`, not `edge_type`, so `cites` is reused for every
 *  category exactly like `seedWorkWithGraphData`'s own base fixture does. */
async function seedRoadmapTarget(
  workId: string,
  opts: { title: string; category?: string; year?: number },
): Promise<string> {
  const [bib] = await db
    .insert(bibliographicRecords)
    .values({ source: "crossref", title: opts.title, authors: "Aristotle", year: opts.year ?? -350, accessStatus: "metadata_only" })
    .returning({ id: bibliographicRecords.id });
  await db.insert(graphEdges).values({
    userId,
    sourceType: "work",
    sourceId: workId,
    targetType: "bibliographic_record",
    targetId: bib.id,
    edgeType: "cites",
    confidence: 0.85,
    evidence: { category: opts.category ?? "explicit_reference" },
    createdBy: "system",
  });
  return bib.id;
}

test.describe("Roadmap visualizer", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("Roadmap is the default layout on load; ?layout=explore round-trips to the force map", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId);
    await login(page);

    // No `?layout=` param at all — the server default (work-scoped -> this
    // work) and the client default (roadmap) apply with nothing written to
    // the URL, matching every other FILTER_KEYS "all" default.
    await page.goto(`/works/${workId}/graph`);
    await expect(page).not.toHaveURL(/layout=/);
    await expect(page.getByRole("button", { name: "Roadmap", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Stage")).toBeVisible();

    await page.getByRole("button", { name: "Explore" }).click();
    await expect(page).toHaveURL(/[?&]layout=explore/);
    await expect(page.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true");
    // The roadmap-only Stage filter has no meaning in explore mode.
    await expect(page.getByLabel("Stage")).toHaveCount(0);

    // Switching back to Roadmap removes the param entirely — the default is
    // never written to the URL, only the non-default value ever is.
    await page.getByRole("button", { name: "Roadmap", exact: true }).click();
    await expect(page).not.toHaveURL(/layout=/);
    await expect(page.getByLabel("Stage")).toBeVisible();

    // A reload from an explicit `?layout=explore` URL restores explore mode.
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await expect(page.getByRole("button", { name: "Explore" })).toHaveAttribute("aria-pressed", "true");
  });

  test("roadmapRoot control->state->output narrows to exactly the checked work's reached targets", async ({ page }) => {
    // Each work's own DEFAULT "Physics" reference (from `seedWorkWithGraphData`)
    // shares an identical title/author/year across every call, so it
    // deliberately COLLAPSES into one merged roadmap item across multiple
    // roots (D-22-2's duplicate collapse, reused unchanged by
    // `mergeRoadmapsAcrossRoots`) — the correct, documented behavior, but
    // not what this test is isolating. Each work instead gets its OWN
    // uniquely titled target via `seedRoadmapTarget` so per-root reachability
    // is the only thing distinguishing the two ids asserted on below.
    const first = await seedWorkWithGraphData(userId, { title: "Roadmap root A" });
    const second = await seedWorkWithGraphData(userId, { title: "Roadmap root B" });
    const firstTargetId = await seedRoadmapTarget(first.workId, { title: "Root A own reference" });
    const secondTargetId = await seedRoadmapTarget(second.workId, { title: "Root B own reference" });
    await login(page);

    await page.goto("/graph");
    await page.getByText("Accessible node browser").click();
    // Whole library (default): both works' own reached target are present.
    await expect(page.locator(`[data-graph-node="external:bib:${firstTargetId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${secondTargetId}"]`)).toBeVisible();

    const popoverButton = page.getByRole("button", { name: /Roadmap for/ });
    await expect(popoverButton).toHaveText(/whole library/i);
    await popoverButton.click();
    // Scoped to the popover itself — "Pinned uploaded works" renders a
    // checkbox with the SAME work label text, so an unscoped `getByLabel`
    // here would be ambiguous (the same collision class D-21-11 fixed
    // elsewhere on this page).
    const popover = page.locator("#roadmap-for-popover");
    await popover.getByLabel("Roadmap root B").uncheck();

    // Explicit control -> URL state: exactly one `roadmapRoot` param, for A.
    await expect(page).toHaveURL(new RegExp(`roadmapRoot=work%3A${first.workId}`));
    await expect(page).not.toHaveURL(new RegExp(`roadmapRoot=work%3A${second.workId}`));

    // Exact-id output: B's own target loses its roadmap annotation (no
    // longer reached by any selected root) and drops out of roadmap mode's
    // node subset; B's uploaded-work anchor itself stays (anchors are never
    // excluded), and A's target is unaffected.
    await expect(page.locator(`[data-graph-node="external:bib:${firstTargetId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${secondTargetId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="work:${second.workId}"]`)).toBeVisible();

    // Reload restores the same explicit selection from the URL.
    await page.reload();
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${secondTargetId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-graph-node="external:bib:${firstTargetId}"]`)).toBeVisible();
  });

  test("the Stage filter shows/hides exact ids in the shared displayed dataset and the table", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: "Column filter fixture" });
    const prereqBibId = await seedRoadmapTarget(workId, { title: "Categories", category: "prerequisite" });
    await login(page);

    await page.goto(`/works/${workId}/graph`);
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${prereqBibId}"]`)).toBeVisible();

    await page.getByLabel("Stage").selectOption("prerequisites");
    await expect(page).toHaveURL(/[?&]stage=prerequisites/);
    // Exact-id output narrows the shared dataset both views render from —
    // the visible "N of M shown" counter proves the SAME count feeds the
    // scene as the table (the two never derive it independently).
    await expect(page.locator(`[data-graph-node="external:bib:${prereqBibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveCount(0);

    // Clicking the already-active stage header in the progress strip clears
    // the filter back to "all" — the DOM stage-header buttons and the Stage
    // select drive the exact same URL/state.
    await page.getByRole("button", { name: /Prerequisites \d+\/\d+/ }).click();
    await expect(page).not.toHaveURL(/stage=/);
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${prereqBibId}"]`)).toBeVisible();
  });

  test("the accessible table shows Stage/Priority/Order/Known columns in roadmap mode", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: "Table columns fixture" });
    await login(page);

    await page.goto(`/works/${workId}/graph`);
    await page.getByText("Accessible node browser").click();

    await expect(page.getByRole("columnheader", { name: "Stage" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Priority" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Order" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Known" })).toBeVisible();

    const bibRow = page.locator(`[data-graph-node="external:bib:${bibId}"]`);
    const cells = bibRow.locator("td");
    await expect(cells.nth(3)).toHaveText("Core engagement");
    await expect(cells.nth(4)).toHaveText("Strongly recommended");
    await expect(cells.nth(5)).toHaveText("1");
    await expect(cells.nth(6)).toHaveText("No");
  });

  test("next-up targets the expected id, and the chip selects it", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: "Next-up fixture" });
    await login(page);

    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("button", { name: /Next up: Physics/ })).toBeVisible();
    await page.getByRole("button", { name: /Next up: Physics/ }).click();
    await page.getByText("Accessible node browser").click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveAttribute("data-selected", "true");
  });

  test("sequence stepping moves the selection through the reading order", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: "Sequence stepping fixture" });
    const prereqBibId = await seedRoadmapTarget(workId, { title: "Categories", category: "prerequisite" });
    await login(page);

    await page.goto(`/works/${workId}/graph`);
    await page.getByText("Accessible node browser").click();

    await page.getByRole("button", { name: "Next →" }).click();
    // Sequence 1 is the "prerequisite"-tier item (essential outranks the
    // explicit_reference item's strongly-recommended tier).
    await expect(page.locator(`[data-graph-node="external:bib:${prereqBibId}"]`)).toHaveAttribute("data-selected", "true");

    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toHaveAttribute("data-selected", "true");
    await expect(page.locator(`[data-graph-node="external:bib:${prereqBibId}"]`)).toHaveAttribute("data-selected", "false");

    await page.getByRole("button", { name: "← Previous" }).click();
    await expect(page.locator(`[data-graph-node="external:bib:${prereqBibId}"]`)).toHaveAttribute("data-selected", "true");
  });

  test("reduced motion pauses the roadmap scene's own effects/transitions", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: "Reduced motion fixture" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await expect(page.locator("[data-graph-canvas]")).toHaveAttribute("data-graph-effects", "paused");
  });

  test("acceptance: prerequisite/formative-context items place ahead of secondary literature by exact id, and no reason/basis string carries 'AI' wording", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: "On Being and Time" });
    const prereqId = await seedRoadmapTarget(workId, { title: "Categories", category: "prerequisite" });
    const formativeId = await seedRoadmapTarget(workId, { title: "Metaphysics", category: "conceptual_influence" });
    const secondaryId = await seedRoadmapTarget(workId, { title: "A Companion to Aristotle", category: "secondary_scholarly_recommendation", year: 1995 });
    const inferredId = await seedRoadmapTarget(workId, { title: "A relevant blog post", category: "ai_inferred", year: 2020 });

    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await page.getByText("Accessible node browser").click();

    const stageOf = (id: string) => page.locator(`[data-graph-node="external:bib:${id}"] td`).nth(3);
    const orderOf = (id: string) => page.locator(`[data-graph-node="external:bib:${id}"] td`).nth(5);

    await expect(stageOf(prereqId)).toHaveText("Prerequisites");
    await expect(stageOf(formativeId)).toHaveText("Formative context");
    await expect(stageOf(bibId)).toHaveText("Core engagement");
    await expect(stageOf(secondaryId)).toHaveText("Core engagement");
    await expect(stageOf(inferredId)).toHaveText("Interpretation & context");

    // Exact reading-order placement: the prerequisite is sequence 1 (ahead of
    // every formative-context/core-engagement item), the conceptual
    // influence is sequence 2 (ahead of both core-engagement items).
    await expect(orderOf(prereqId)).toHaveText("1");
    await expect(orderOf(formativeId)).toHaveText("2");

    // The inferred connection's inspector disclosure uses the owner-directed
    // display override — never the raw "ai_inferred" wording, and no "AI".
    await page.locator(`[data-graph-node="external:bib:${inferredId}"]`).click();
    const disclosure = page.locator("[data-graph-roadmap-disclosure]");
    await disclosure.locator("summary").click();
    await expect(disclosure).toContainText("Inferred connection");
    await expect(disclosure).toContainText("uncertain until you verify it by reading");

    const disclosureText = await disclosure.innerText();
    expect(disclosureText).not.toMatch(/\bAI\b/);

    // Every reason cell in the "Why" column is free of "AI" wording too.
    const whyCells = page.locator('table td:nth-child(9)');
    const whyTexts = await whyCells.allInnerTexts();
    for (const text of whyTexts) expect(text).not.toMatch(/\bAI\b/);
  });

  test("Reading thread toggle control->URL->state round-trips (22.8 verifier finding: showReadingThread was unreachable)", async ({ page }) => {
    // The polyline itself lives inside the WebGL scene and is not DOM/E2E
    // assertable (same precedent this spec's own file-header comment and
    // `graph-scene.spec.ts` document for fixed 3D positions/rings/sprites).
    // What IS assertable without WebGL introspection: the control's own
    // pressed state, the URL param it round-trips through (matching the
    // `layout`/`roadmapRoot` pattern), and `GraphView`'s own
    // `data-reading-thread` attribute on the scene's wrapping `<section>` —
    // the same boolean value passed to `KnowledgeGraph3D` as the
    // `showReadingThread` prop, mirrored onto the DOM one level up.
    const { workId } = await seedWorkWithGraphData(userId, { title: "Reading thread fixture" });
    await login(page);

    await page.goto(`/works/${workId}/graph`);
    const toggle = page.getByRole("button", { name: "Reading thread" });
    const stage = page.locator("[data-graph-stage]");

    // Off by default: absent from the URL, unpressed, scene wrapper "off".
    await expect(page).not.toHaveURL(/readingThread/);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(stage).toHaveAttribute("data-reading-thread", "off");

    // Control -> URL -> state: clicking sets the one non-default value.
    await toggle.click();
    await expect(page).toHaveURL(/[?&]readingThread=1/);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(stage).toHaveAttribute("data-reading-thread", "on");

    // Clicking again clears the param back to the honest default-absent state.
    await toggle.click();
    await expect(page).not.toHaveURL(/readingThread/);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(stage).toHaveAttribute("data-reading-thread", "off");

    // Deep link: a reload from an explicit `?readingThread=1` URL restores
    // the toggle's pressed state and the mirrored scene-wrapper attribute.
    await page.goto(`/works/${workId}/graph?readingThread=1`);
    await expect(page.getByRole("button", { name: "Reading thread" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-graph-stage]")).toHaveAttribute("data-reading-thread", "on");

    // Switching to Explore layout hides the roadmap-only toggle entirely —
    // it has no meaning there (mirrors the Stage filter's own precedent).
    await page.getByRole("button", { name: "Explore" }).click();
    await expect(page.getByRole("button", { name: "Reading thread" })).toHaveCount(0);
  });
});
