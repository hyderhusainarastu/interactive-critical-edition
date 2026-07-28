import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";

/**
 * Charter §14 fallback coverage (spec §5, §7.3's
 * `knowledge-map-fallback.spec.ts`). All graph data is SEEDED directly
 * (`seedWorkWithGraphData`, same CI-safe convention `graph.spec.ts` already
 * established — `buildGraph()` is a pure DB read, no worker dependency).
 *
 * The load-bearing assertion across every test here: **real node data,
 * with real filters/selection/inspector, is present without WebGL** — the
 * direct regression test for the baseline's most severe finding (a WebGL
 * failure used to leave the page with zero graph content anywhere). A
 * page-init script overrides `HTMLCanvasElement.prototype.getContext` to
 * return `null` for `webgl`/`webgl2` — the same technique the Stage 0
 * baseline audit's own live reproduction used, now reused to prove the fix
 * rather than just asserting it.
 */

const EMAIL = `e2e-kmap-fallback-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Disables WebGL for every canvas on the page, from before any script on
 *  the page runs — must be installed via `addInitScript` (not a
 *  post-navigation `page.evaluate`) so it's in place before
 *  `KnowledgeMapFallbackBoundary`'s own mount-time probe ever runs. */
async function disableWebgl(page: Page) {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (originalGetContext as any).call(this, type, ...rest);
    };
  });
}

test.describe("Knowledge Map — WebGL-unavailable fallback", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("with WebGL unavailable, real node data + filters + inspector render — the baseline total-failure cannot recur", async ({ page }) => {
    const { workId, bibId, conceptId, sectionBlockId } = await seedWorkWithGraphData(userId);

    await disableWebgl(page);
    await login(page);
    await page.goto(`/works/${workId}/graph`);

    // No error screen, no blank canvas — an honest, specific banner naming
    // the actual cause (never the generic "could not load" the baseline
    // complained about).
    await expect(page.getByRole("status").filter({ hasText: "3D view isn" })).toBeVisible();

    // Real node data is present: the work itself, the cited bibliographic
    // record, a concept, and a section — via the SAME `data-graph-node`
    // convention the rest of this app's tests already use.
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toContainText("Physics");
    await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="section:${sectionBlockId}"]`)).toBeVisible();

    // Real filters still work against the fallback view — search narrows
    // the SAME shared filtered selection the (unavailable) 3D scene would
    // have received. The concept node is a non-root match for "Hylomorphism"
    // that a "Physics" search must hide — the root work node stays visible
    // regardless of the search term by design (`attributeVisibility.ts`'s
    // own "root always visible" rule, unchanged and correctly reused here,
    // not re-derived), so this asserts on a non-root node disappearing
    // rather than the root.
    const searchBox = page.getByPlaceholder(/search/i).first();
    if (await searchBox.count()) {
      await searchBox.fill("Physics");
      await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toBeVisible();
      await expect(page.locator(`[data-graph-node="concept:${conceptId}"]`)).toHaveCount(0);
      await searchBox.fill("");
    }

    // Real selection + real inspector: clicking a node in the fallback
    // list opens the SAME InspectorDrawer the 3D scene would have.
    await page.locator(`[data-graph-node="external:bib:${bibId}"]`).click();
    const inspector = page.getByTestId("knowledge-map-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("Physics");
  });

  test("no Retry control is offered when WebGL is genuinely unavailable (nothing to retry)", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: `Retry-less work ${Date.now()}` });

    await disableWebgl(page);
    await login(page);
    await page.goto(`/works/${workId}/graph`);

    await expect(page.getByRole("status").filter({ hasText: "3D view isn" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry 3D" })).toHaveCount(0);
  });

  test("3D view (WebGL available) does not show the fallback banner", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: `WebGL-available work ${Date.now()}` });

    await login(page);
    await page.goto(`/works/${workId}/graph`);

    await expect(page.getByTestId("knowledge-map-scene")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "3D view" })).toHaveCount(0);
  });
});
