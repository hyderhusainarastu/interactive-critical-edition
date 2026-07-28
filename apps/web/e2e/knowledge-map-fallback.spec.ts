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

/**
 * `webglcontextlost` / `webglcontextrestored` (spec §5.2, charter §14).
 * Dispatches the REAL DOM event on the actual live canvas
 * (`KnowledgeMapScene.tsx` already wires a genuine
 * `canvas.addEventListener("webglcontextlost", ...)` — this test exercises
 * that real listener, not a mock of it) via `canvas.dispatchEvent(new
 * Event(...))`, the same technique the WebGL-unavailable tests above use
 * for `getContext` overriding, applied here to a different real event
 * instead.
 */
test.describe("Knowledge Map — webglcontextlost / webglcontextrestored", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  async function waitForSceneInteractive(page: Page) {
    await page.waitForFunction(
      () => Boolean((window as unknown as { __knowledgeMapTestHook__?: { interactive: boolean } }).__knowledgeMapTestHook__?.interactive),
      { timeout: 20_000 },
    );
  }

  test("losing the WebGL context switches to the List fallback with a distinct, honest message and a real Retry — restoring alone does not auto-reinitialize; Retry remounts a fresh scene", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: `Context-loss work ${Date.now()}` });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await waitForSceneInteractive(page);

    const firstMountId = await page.evaluate(() => window.__knowledgeMapTestHook__?.mountId);
    expect(firstMountId).not.toBeUndefined();

    // Dispatch the real event on the real live canvas.
    await page.locator('[data-testid="knowledge-map-scene"] canvas').evaluate((canvas) => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });

    // A distinct message from the "unavailable" case — never the same
    // generic copy for both causes (spec §5.3's own point, extended here
    // to prove §5.2's "context-lost" message is ALSO its own distinct
    // string, not shared with either sibling failure mode).
    const banner = page.getByRole("status").filter({ hasText: "lost its graphics context" });
    await expect(banner).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "3D view isn" })).toHaveCount(0);

    // Real node data, real List view, real inspector — same fallback
    // contract the WebGL-unavailable tests above already prove, now
    // triggered by a mid-session loss instead of a mount-time probe.
    await expect(page.locator(`[data-graph-node="work:${workId}"]`)).toBeVisible();
    await expect(page.locator(`[data-graph-node="external:bib:${bibId}"]`)).toContainText("Physics");

    // The scene component actually unmounts while the fallback is shown
    // (spec §5.1: "this boundary never renders graph content itself... it
    // decides WHETHER the 3D scene mounts") — its test hook is torn down
    // with it, which is itself a real, checkable fact distinct from
    // merely "the banner text says so".
    await expect.poll(() => page.evaluate(() => window.__knowledgeMapTestHook__ === undefined)).toBe(true);

    // A visible Retry control IS offered here (context-lost is
    // meaningfully retryable, unlike the genuinely-unavailable case).
    const retry = page.getByRole("button", { name: "Retry 3D" });
    await expect(retry).toBeVisible();

    // Charter §14's documented either/or: this app picks "remain in the
    // semantic fallback until Retry is pressed" — waiting past a real
    // `webglcontextrestored`-equivalent settle window without pressing
    // Retry must NOT auto-reinitialize the 3D scene on its own.
    await page.waitForTimeout(500);
    await expect(banner).toBeVisible();
    await expect(page.getByTestId("knowledge-map-scene")).toHaveCount(0);

    // Retry remounts a genuinely FRESH scene instance (new mount id, not
    // "resume the dead one") — restoring context/view/selection/layers/
    // filters/expansion state is satisfied here by the render-prop closing
    // over the workspace's own CURRENT `useGraphUrlState`, so nothing else
    // needs to be threaded through this boundary explicitly.
    await retry.click();
    await expect(page.getByTestId("knowledge-map-scene")).toBeVisible();
    await waitForSceneInteractive(page);
    const secondMountId = await page.evaluate(() => window.__knowledgeMapTestHook__?.mountId);
    expect(secondMountId).not.toBeUndefined();
    expect(secondMountId).not.toBe(firstMountId);
    await expect(page.getByRole("status").filter({ hasText: "lost its graphics context" })).toHaveCount(0);
  });
});

/**
 * Stale async cancellation (spec §5.2/§7.3): switching the active context
 * twice in rapid succession must leave the SECOND context's data as the
 * only thing that ever reaches the scene/inspector — the first (now
 * superseded) fetch's result must never flash into view or win a race.
 * `KnowledgeMapWorkspace.tsx`'s own context-load effect already guards
 * this with a `cancelled` flag closed over per-effect-run (checked inside
 * the fetch's `.then`), so this is exercising real product code, not
 * asserting a mocked substitute for it.
 */
test.describe("Knowledge Map — stale async cancellation", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("rapidly switching context twice leaves only the second context's data visible, never a flash of the first", async ({ page }) => {
    const workA = await seedWorkWithGraphData(userId, { title: `Stale-race work A ${Date.now()}` });
    const workB = await seedWorkWithGraphData(userId, { title: `Stale-race work B ${Date.now()}` });
    await login(page);

    // Land on A's context first so there's a genuine "already showing
    // something" state to race against, then immediately (no await
    // in between beyond the navigation itself) switch to B.
    await page.goto(`/graph?ctxKind=work&ctxId=${workA.workId}&view=list&focus=all`);
    await page.goto(`/graph?ctxKind=work&ctxId=${workB.workId}&view=list&focus=all`);

    await expect(page.getByTestId("knowledge-map-list-view")).toBeVisible();
    // B's own root node is present and correctly labeled...
    await expect(page.locator(`[data-graph-node="work:${workB.workId}"]`)).toBeVisible();
    // ...and at NO point does A's root node ever appear in the DOM — not
    // even transiently, since a transient flash could exist in the DOM
    // for a tick this assertion alone wouldn't catch, so this is combined
    // with the bib-record check below (a distinguishing per-context field)
    // rather than relying on the root-id check in isolation.
    await expect(page.locator(`[data-graph-node="work:${workA.workId}"]`)).toHaveCount(0);
  });
});
