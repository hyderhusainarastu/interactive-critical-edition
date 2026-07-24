import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkWithGraphData } from "./helpers";

/**
 * Lane E (graph readability/navigability program): `RoadmapConstellation`
 * (`apps/web/src/app/(app)/works/[workId]/roadmap/RoadmapConstellation.tsx`)
 * had ZERO e2e coverage before this spec — every other graph surface
 * (`graph.spec.ts`, `graph-scene.spec.ts`, `roadmap-graph.spec.ts`) covers
 * the WebGL Visualization page or its data contract, but never this
 * separate, hand-rolled 2D-canvas companion map on the Roadmap page.
 *
 * All data is SEEDED directly (`seedWorkWithGraphData`) — `RoadmapView`
 * fetches `/api/works/:id/roadmap`, a pure DB read with no worker/live-API
 * dependency, so this is CI-safe the same way `roadmap-graph.spec.ts`
 * already is. WebGL/canvas rotation/zoom internals are not e2e-assertable
 * (same documented limitation as `graph-scene.spec.ts`'s own header
 * comment); what IS assertable here is exactly what the task calls for:
 * the Map/Table toggle, and node-selection detail — proven via the ROOT
 * node specifically, since it always projects to the exact canvas center
 * regardless of the current yaw/pitch/zoom (its local coordinates are all
 * zero), making a plain `.click()` (which targets an element's bounding-box
 * center) a reliable, deterministic hit test with no coordinate math.
 */

const EMAIL = `e2e-roadmap-constellation-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Roadmap constellation (smoke)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("renders open by default, toggles map/table, and selecting the root node shows its detail", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: "Constellation smoke fixture" });

    await login(page);
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();

    const constellation = page.locator("[data-roadmap-constellation]");
    await expect(constellation).toBeVisible();
    // The default (>=1024px) viewport opens the disclosure automatically —
    // its content (the Map/Table toggle, the canvas) must actually be
    // visible, not just present in a collapsed <details>.
    const viewToggle = constellation.getByRole("group", { name: "Constellation view mode" });
    await expect(viewToggle).toBeVisible();

    const mapButton = viewToggle.getByRole("button", { name: "Map" });
    const tableButton = viewToggle.getByRole("button", { name: "Table" });
    const canvas = page.locator("[data-roadmap-canvas] canvas");
    await expect(mapButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toBeVisible();

    // MAP/TABLE TOGGLE: switching to Table swaps the canvas for the
    // accessible table (same underlying `items`, per this component's own
    // header comment) — both directions round-trip correctly.
    await tableButton.click();
    await expect(tableButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveCount(0);
    await expect(constellation.getByRole("columnheader", { name: "Tier" })).toBeVisible();
    await expect(constellation.getByRole("columnheader", { name: "Sequence" })).toBeVisible();

    await mapButton.click();
    await expect(mapButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toBeVisible();

    // NODE-SELECTION DETAIL: the root node ("this work") sits at local
    // coordinates (0,0,0), so it projects to the exact canvas center under
    // ANY rotation — a plain `.click()` (bounding-box center) reliably hits
    // it without needing to compute a rotated position.
    const detailPane = constellation.locator("aside[aria-live='polite']");
    await expect(detailPane).toContainText("Select an item for details.");
    await canvas.click();
    await expect(detailPane).toContainText("This work");
    await expect(detailPane).toContainText("Constellation smoke fixture");

    // RESET VIEW: the new control exists and doesn't error out the scene —
    // the canvas stays mounted and visible afterward.
    const resetButton = constellation.getByRole("button", { name: "Reset view" });
    await expect(resetButton).toBeVisible();
    await resetButton.click();
    await expect(canvas).toBeVisible();
  });
});
