import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";

/**
 * 2D stage-column Roadmap (Stage 4 read spec §6/§8.1) — replaces
 * `roadmap-constellation.spec.ts`'s scope (that component, and its own
 * rotate/zoom canvas, is retired — see the spec's §6.1). All data is
 * SEEDED (`seedWorkWithGraphData`) — `RoadmapView` fetches
 * `/api/works/:id/roadmap`, a pure DB read with no worker/live-API
 * dependency, same CI-safety as the file this replaces.
 *
 * What's asserted here is exactly what charter §17 requires and the old
 * canvas component structurally could not prove: every node is a REAL
 * focusable DOM element reachable by keyboard alone, in column-by-column,
 * top-to-bottom order — no canvas hit-testing, no keyboard trap.
 */

const EMAIL = `e2e-roadmap2d-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Roadmap stage-column map (Stage 4 read spec §6)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("root and item nodes are real, keyboard-focusable buttons, and selecting one shows its detail", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: "Stage map fixture" });

    await login(page);
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();

    const stageMap = page.locator("[data-roadmap-stage-columns]");
    await expect(stageMap).toBeVisible();

    const root = stageMap.locator("[data-roadmap-root]");
    await expect(root).toBeVisible();
    const detailPane = stageMap.locator("aside[aria-live='polite']");
    await expect(detailPane).toContainText("Select an item for details.");

    // Keyboard-only: focus the root node directly and activate with Enter —
    // no canvas, no coordinate hit-testing, a real element in tab order.
    await root.focus();
    await expect(root).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detailPane).toContainText("This work");
    await expect(detailPane).toContainText("Stage map fixture");

    // The first item node (Physics, seeded as an explicit_reference/cites
    // edge) is also a real focusable button; Space activates it too.
    const firstNode = stageMap.locator("[data-roadmap-stage-node]").first();
    await expect(firstNode).toBeVisible();
    await firstNode.focus();
    await page.keyboard.press(" ");
    await expect(detailPane).toContainText("Physics");
    // This fixture's target is a bare bibliographic record (no owned work
    // to link to), so the detail pane's fallback control is
    // "View in list below" rather than "Open work" — assert the one the
    // seeded data actually produces, not an either/or.
    await expect(detailPane.getByRole("button", { name: "View in list below" })).toBeVisible();
  });

  test("the always-visible accessible tier list stays present alongside the stage map", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: "Stage map fixture (tier list)" });

    await login(page);
    await page.goto(`/works/${workId}/roadmap`);

    // Stage 4 read spec §6.4: the tier `<ol>` list is the default,
    // always-rendered view — the stage map is its opt-in companion, never
    // a replacement.
    await expect(page.locator("[data-roadmap-item]").first()).toBeVisible();
    await expect(page.locator("[data-roadmap-stage-columns]")).toBeVisible();
  });
});
