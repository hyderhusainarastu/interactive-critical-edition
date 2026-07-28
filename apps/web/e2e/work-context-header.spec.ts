import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedWorkInStatus, seedWorkWithGraphData } from "./helpers";

/**
 * Stage 4 read spec §3.2/§8.1: the persistent work context header
 * (`WorkContextHeader`) — seven tabs in the charter's exact order, gated on
 * real processing status with an inline "why disabled" reason. All data is
 * SEEDED directly (`seedWorkInStatus`/`seedWorkWithGraphData`), no worker/
 * live-API dependency — the header itself is a pure read of `work`/
 * `document` rows this layout's own query already covers.
 */

const EMAIL = `e2e-work-context-header-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Work context header (Stage 4 read spec §3)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("a ready work shows every tab enabled, with the current route marked current", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: "Context header fixture (ready)" });

    await login(page);
    await page.goto(`/works/${workId}`);

    const nav = page.getByRole("navigation", { name: /Context header fixture \(ready\) sections/ });
    await expect(nav).toBeVisible();

    for (const label of ["Reader", "Sources", "Roadmap", "Curriculum", "Concept Check", "Knowledge Map", "Details"]) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }

    // Details is the active route for /works/:id itself.
    await expect(nav.getByRole("link", { name: "Details" })).toHaveAttribute("aria-current", "page");

    // Navigating to the Roadmap tab moves aria-current with it.
    await nav.getByRole("link", { name: "Roadmap", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/works/${workId}/roadmap$`));
    const roadmapNav = page.getByRole("navigation", { name: /sections/ });
    await expect(roadmapNav.getByRole("link", { name: "Roadmap", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(roadmapNav.getByRole("link", { name: "Details" })).not.toHaveAttribute("aria-current", "page");
  });

  test("a needs_review work disables the processing-gated tabs with an inline reason, but keeps Details and Knowledge Map reachable", async ({ page }) => {
    const { workId } = await seedWorkInStatus(userId, "needs_review", { title: "Context header fixture (needs review)" });

    await login(page);
    await page.goto(`/works/${workId}`);

    const nav = page.getByRole("navigation", { name: /sections/ });
    for (const label of ["Reader", "Sources", "Roadmap", "Curriculum", "Concept Check"]) {
      const tab = nav.getByText(label, { exact: true });
      await expect(tab).toBeVisible();
      // Disabled tabs render as a non-link <span aria-disabled="true">, not
      // a <a>/<Link> — clicking through the UI can no longer reach them.
      await expect(page.locator('[aria-disabled="true"]', { hasText: label })).toBeVisible();
    }
    await expect(page.getByText("Available once processing finishes.").first()).toBeVisible();

    // Not gated: still real, clickable links.
    await expect(nav.getByRole("link", { name: "Details" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Knowledge Map" })).toBeVisible();
  });

  test("a failed work explains why, and a direct URL visit to the Reader route gets the same explanation instead of a silent bounce", async ({ page }) => {
    const { workId } = await seedWorkInStatus(userId, "failed", {
      title: "Context header fixture (failed)",
      processingError: "Seeded failure for e2e coverage.",
    });

    await login(page);
    await page.goto(`/works/${workId}`);
    await expect(page.getByText("Unavailable — processing failed.").first()).toBeVisible();

    // Stage 4 read spec §3.3: the reader page's own defensive guard renders
    // the same explanation inline rather than redirecting away silently.
    // Scoped to the page's own explanatory <p> (not a bare getByText): the
    // identical "Unavailable — processing failed." reason also renders once
    // per OTHER disabled subnav tab (Roadmap/Curriculum/Diagnostic/
    // Knowledge Map), so an unscoped locator is a strict-mode violation.
    await page.goto(`/works/${workId}/reader`);
    await expect(page.locator("p").filter({ hasText: "Unavailable — processing failed." })).toBeVisible();
    await expect(page.getByRole("link", { name: "View work details" })).toBeVisible();
  });

  test("the Knowledge Map tab opens in this work's own context, and every other tab stays reachable for return navigation (integration step 'focus-modes-map-tabs')", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: `Return-nav fixture ${Date.now()}` });

    await login(page);
    await page.goto(`/works/${workId}`);
    const nav = page.getByRole("navigation", { name: /sections/ });

    await nav.getByRole("link", { name: "Knowledge Map", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/works/${workId}/graph$`));

    // The tab strip survives the navigation (it's the parent layout's own
    // persistent chrome, not something this route re-renders) and marks
    // Knowledge Map current, same convention the Roadmap test above proves
    // for a different tab.
    const graphNav = page.getByRole("navigation", { name: /sections/ });
    await expect(graphNav.getByRole("link", { name: "Knowledge Map", exact: true })).toHaveAttribute("aria-current", "page");

    // The Knowledge Map itself really opened, pre-scoped to this work (the
    // `initialContext` prop `KnowledgeMapWorkspace` receives from this
    // route) — not a bare context chooser.
    await expect(page.getByTestId("knowledge-map-toolbar")).toBeVisible();

    // Return navigation: every other tab is still one click away — pick
    // Sources (a tab this test hasn't visited yet) to prove it's not just
    // Details/Roadmap that survive.
    await graphNav.getByRole("link", { name: "Sources", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/works/${workId}/sources$`));
    const sourcesNav = page.getByRole("navigation", { name: /sections/ });
    await expect(sourcesNav.getByRole("link", { name: "Sources", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sourcesNav.getByRole("link", { name: "Knowledge Map", exact: true })).not.toHaveAttribute("aria-current", "page");
  });
});
