import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData, seedWorkWithManyConceptNodes } from "./helpers";

/**
 * Charter §16 "Touch tap/orbit/pinch/pan" (spec §7.3), run under the
 * dedicated `mobile-chromium` Playwright project (`playwright.config.ts`
 * — `devices["Pixel 7"]`, touch-capable, no new npm dependency: `devices`
 * ships as part of the already-installed `@playwright/test` package).
 * Every test here is scoped to this file only (`testMatch`/`testIgnore` in
 * the config) — the rest of the suite assumes the default desktop
 * chromium viewport/pointer model.
 *
 * All graph data is SEEDED directly (same CI-safe convention every other
 * `knowledge-map*.spec.ts` file already uses).
 */

const EMAIL = `e2e-kmap-touch-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function waitForSceneInteractive(page: Page, timeout = 20_000) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __knowledgeMapTestHook__?: { interactive: boolean } }).__knowledgeMapTestHook__?.interactive),
    { timeout },
  );
}

async function waitForLayoutFrozen(page: Page, timeout = 15_000) {
  await page.waitForFunction(() => window.__knowledgeMapTestHook__?.isLayoutFrozen() === true, { timeout });
}

async function cameraPose(page: Page) {
  return page.evaluate(() => window.__knowledgeMapTestHook__?.getCameraPose() ?? null);
}

test.describe("Knowledge Map — touch tap, orbit, pinch, pan (mobile)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  /** Same environment-latency retry `knowledge-map.spec.ts`'s
   *  `clickNodeInScene` documents at length (real, occasionally-prolonged
   *  GPU/CPU contention on this shared sandbox machine — console-confirmed
   *  `GPU stall due to ReadPixels` messages, not a fixed frame-count race)
   *  — retrying the real tap itself, never weakening what's asserted. */
  async function tapNodeInScene(page: Page, nodeId: string, attempts = 15) {
    await waitForLayoutFrozen(page);
    const canvas = page.locator('[data-testid="knowledge-map-scene"] canvas');
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForTimeout(100);
      const pos = await page.evaluate((id) => window.__knowledgeMapTestHook__?.getNodeScreenPosition(id) ?? null, nodeId);
      if (!pos) throw new Error(`node ${nodeId} has no on-screen position to tap`);
      await canvas.tap({ position: pos });
      try {
        await expect.poll(() => page.evaluate(() => window.__knowledgeMapTestHook__?.getSelectedId()), { timeout: 800, intervals: [100] }).toBe(nodeId);
        return;
      } catch {
        if (attempt === attempts) throw new Error(`tapNodeInScene: ${nodeId} never became selected after ${attempts} attempts`);
      }
    }
  }

  test("a real tap on a node's projected position selects it and opens the mobile inspector sheet", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: `Touch tap work ${Date.now()}` });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await waitForSceneInteractive(page);

    const nodeId = `external:bib:${bibId}`;
    await tapNodeInScene(page, nodeId);

    // Mobile inspector renders as the same `data-testid`-carrying sheet,
    // per `InspectorDrawer.tsx`'s own `device === "mobile"` branch.
    await expect(page.getByTestId("knowledge-map-inspector")).toBeVisible();
  });

  test("small-fixture touch selection never promotes the hub over the requested satellite and keeps Home framing valid", async ({ page }) => {
    const { workId, bibId } = await seedWorkWithGraphData(userId, { title: `Small-fixture occlusion touch ${Date.now()}` });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await waitForSceneInteractive(page);
    await waitForLayoutFrozen(page);

    const targetId = `external:bib:${bibId}`;
    const rootId = `work:${workId}`;
    const canvas = page.locator('[data-testid="knowledge-map-scene"] canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // No helper retry: this directly guards the former depth-occlusion
    // condition where a tap at the satellite's own projected point chose
    // the nearer, oversized root hub instead.
    for (let pass = 0; pass < 2; pass += 1) {
      // The first successful tap intentionally opens the mobile inspector
      // sheet. Dismiss it before the next independent tap: otherwise that
      // correctly modal-like sheet, rather than the canvas, receives input.
      if (pass > 0) {
        await page.getByRole("button", { name: "Close inspector" }).click();
        await expect(page.getByTestId("knowledge-map-inspector")).toHaveCount(0);
      }
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await waitForLayoutFrozen(page);
      const point = await page.evaluate((id) => window.__knowledgeMapTestHook__?.getNodeScreenPosition(id) ?? null, targetId);
      expect(point).not.toBeNull();
      await canvas.tap({ position: point! });
      await expect.poll(() => page.evaluate(() => window.__knowledgeMapTestHook__?.getSelectedId() ?? null), { timeout: 1_500, intervals: [100] }).toBe(targetId);
      expect(await page.evaluate(() => window.__knowledgeMapTestHook__?.getSelectedId() ?? null)).not.toBe(rootId);

      const pose = await cameraPose(page);
      expect(pose).not.toBeNull();
      expect(Math.hypot(
        pose!.position[0] - pose!.target[0],
        pose!.position[1] - pose!.target[1],
        pose!.position[2] - pose!.target[2],
      )).toBeGreaterThan(1);
      expect(pose!.position[2] - pose!.target[2]).toBeGreaterThan(0);

      const projections = await page.evaluate(() => {
        const hook = window.__knowledgeMapTestHook__;
        return hook?.getVisibleNodeIds().map((id) => ({ id, point: hook.getNodeScreenPosition(id) })) ?? [];
      });
      for (const projection of projections) {
        expect(projection.point, `visible node ${projection.id} should remain in the Home frustum`).not.toBeNull();
        expect(projection.point!.x).toBeGreaterThanOrEqual(0);
        expect(projection.point!.x).toBeLessThanOrEqual(box!.width);
        expect(projection.point!.y).toBeGreaterThanOrEqual(0);
        expect(projection.point!.y).toBeLessThanOrEqual(box!.height);
      }
    }
  });

  /**
   * Real multi-touch dispatch via the CDP `Input.dispatchTouchEvent`
   * method (through Playwright's own `context.newCDPSession`, a real,
   * documented Playwright API — not a private/undocumented hook).
   * Deliberately NOT a JS-level `element.dispatchEvent(new TouchEvent(...))`:
   * Chromium's real touch-to-pointer-event translation happens inside the
   * browser's input-handling layer BEFORE any JS event dispatch, as a side
   * effect of a REAL injected touch — a synthetic `TouchEvent` constructed
   * and dispatched from page-side JS skips that layer entirely, so
   * `OrbitControls` (which — like most modern three.js/browser input code
   * — listens for `pointerdown`/`pointermove`/`pointerup`, not legacy
   * `touchstart`/`touchmove`/`touchend`) never sees a corresponding
   * pointer event and never reacts. Confirmed empirically while building
   * this suite: the `TouchEvent`-based version never orbited the camera at
   * all. CDP touch injection is the one mechanism that goes through the
   * real input pipeline and produces real pointer events, exactly like an
   * actual finger on an actual touchscreen would.
   */
  async function dispatchTouchSequence(page: Page, points: Array<Array<{ x: number; y: number; id: number }>>) {
    const client = await page.context().newCDPSession(page);
    for (let i = 0; i < points.length; i++) {
      const touchPoints = points[i].map((p) => ({ x: p.x, y: p.y, id: p.id }));
      const type = i === 0 ? "touchStart" : i === points.length - 1 ? "touchEnd" : "touchMove";
      await client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : touchPoints,
      });
      await page.waitForTimeout(16);
    }
    await client.detach();
  }

  test("touch drag orbits the camera; pinch changes zoom distance to target", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: `Touch orbit work ${Date.now()}` });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await waitForSceneInteractive(page);
    await waitForLayoutFrozen(page);

    const box = await page.locator('[data-testid="knowledge-map-scene"] canvas').boundingBox();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    const before = await cameraPose(page);

    // Single-finger drag (orbit): one real touch point moving across
    // several intermediate frames.
    const orbitSteps = 10;
    const orbitFrames: Array<Array<{ x: number; y: number; id: number }>> = [];
    for (let i = 0; i <= orbitSteps; i++) {
      orbitFrames.push([{ x: cx + (120 * i) / orbitSteps, y: cy + (60 * i) / orbitSteps, id: 1 }]);
    }
    await dispatchTouchSequence(page, orbitFrames);
    await page.waitForTimeout(250);

    const afterOrbit = await cameraPose(page);
    expect(afterOrbit).not.toBeNull();
    const orbited =
      Math.abs(afterOrbit!.position[0] - before!.position[0]) > 0.5 ||
      Math.abs(afterOrbit!.position[1] - before!.position[1]) > 0.5 ||
      Math.abs(afterOrbit!.position[2] - before!.position[2]) > 0.5;
    expect(orbited).toBe(true);

    // Two-finger pinch (zoom): two real touch points converging.
    const beforePinch = await cameraPose(page);
    const pinchSteps = 10;
    const pinchFrames: Array<Array<{ x: number; y: number; id: number }>> = [];
    for (let i = 0; i <= pinchSteps; i++) {
      const factor = 1 - (0.5 * i) / pinchSteps;
      pinchFrames.push([
        { x: cx - 80 * factor, y: cy, id: 1 },
        { x: cx + 80 * factor, y: cy, id: 2 },
      ]);
    }
    await dispatchTouchSequence(page, pinchFrames);
    await page.waitForTimeout(250);
    const afterPinch = await cameraPose(page);
    function dist(p: { position: readonly [number, number, number]; target: readonly [number, number, number] }) {
      return Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);
    }
    expect(dist(afterPinch!)).not.toBeCloseTo(dist(beforePinch!), 1);
  });
});

test.describe("Knowledge Map — mobile boundary counts", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  // Mobile INITIAL_NEIGHBOR_CAP boundary (11/12/13) and VISIBLE_CAP (59/60/61)
  // — `@ice/graph-display/disclosure.ts`'s `INITIAL_NEIGHBOR_CAP.mobile = 12`,
  // `VISIBLE_CAP.mobile = 60`.
  for (const count of [11, 12, 13]) {
    test(`mobile initial neighborhood at boundary ${count}`, async ({ page }) => {
      const { workId, conceptIds } = await seedWorkWithManyConceptNodes(userId, { count, title: `Mobile boundary-${count} work ${Date.now()}` });
      await login(page);
      await page.goto(`/works/${workId}/graph`);
      await waitForSceneInteractive(page);
      const ids = await page.evaluate(() => window.__knowledgeMapTestHook__?.getVisibleNodeIds() ?? []);
      const realConceptsShown = conceptIds.filter((id) => ids.includes(`concept:${id}`)).length;
      const hasAggregate = ids.some((id) => id.startsWith("aggregate:"));
      if (count <= 12) {
        expect(realConceptsShown).toBe(count);
        expect(hasAggregate).toBe(false);
      } else {
        expect(realConceptsShown).toBeGreaterThan(0);
        expect(hasAggregate).toBe(true);
      }
    });
  }

  test("mobile visible cap holds at 61 real neighbors (aggregation, not an unbounded render)", async ({ page }) => {
    const { workId } = await seedWorkWithManyConceptNodes(userId, { count: 61, title: `Mobile visible-cap work ${Date.now()}` });
    await login(page);
    await page.goto(`/works/${workId}/graph`);
    await waitForSceneInteractive(page);
    const ids = await page.evaluate(() => window.__knowledgeMapTestHook__?.getVisibleNodeIds() ?? []);
    expect(ids.length).toBeLessThan(62);
    expect(ids.some((id) => id.startsWith("aggregate:"))).toBe(true);
  });
});
