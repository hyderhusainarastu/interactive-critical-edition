import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Stage 6 layout spec §2/§9: the focused-editor layout — collapsible
 * Sources/Evidence and Citations/History panels, one-panel-at-a-time on
 * narrow (<1024px) viewports, keyboard accessible, reduced-motion
 * respected. `writer.spec.ts`/`writer-evidence.spec.ts`/`writer-export.spec.ts`
 * already cover the full functional journey (create → cite → insert →
 * autosave → restore → export) at the default (wide) viewport; this file
 * adds exactly the panel/viewport coverage that's new in this stage.
 */

const EMAIL = `e2e-writer-panels-${Date.now()}@example.com`;
const PASSWORD = "password123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function newProject(page: import("@playwright/test").Page, title: string): Promise<string> {
  await page.goto("/writer");
  page.once("dialog", (dialog) => dialog.accept(title));
  await page.getByRole("button", { name: "New project" }).click();
  await page.waitForURL("**/writer/*");
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

test.describe("Writer panel layout (Stage 6)", () => {
  test.beforeAll(async () => {
    await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("desktop (1280px): both panels open by default, collapse independently, widen the draft once both are collapsed, and persist across reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await newProject(page, "Desktop panels project");

    const sources = page.getByRole("complementary", { name: "Sources and evidence panel" });
    const citations = page.getByRole("complementary", { name: "Citations and revision history panel" });
    const sourcesToggle = page.getByRole("button", { name: "Sources and evidence" });
    const citationsToggle = page.getByRole("button", { name: "Citations and history" });
    await expect(sources).toBeVisible();
    await expect(citations).toBeVisible();
    await expect(sourcesToggle).toHaveAttribute("aria-expanded", "true");
    await expect(citationsToggle).toHaveAttribute("aria-expanded", "true");

    // Collapsing Sources leaves Citations untouched.
    await sourcesToggle.click();
    await expect(sources).toHaveCount(0);
    await expect(sourcesToggle).toHaveAttribute("aria-expanded", "false");
    await expect(citations).toBeVisible();

    // Collapsing Citations too widens the central draft (§2.5's freed-space rule).
    await expect(page.locator("[data-panels-collapsed]")).toHaveCount(0);
    await citationsToggle.click();
    await expect(citations).toHaveCount(0);
    await expect(page.locator("[data-panels-collapsed='true']")).toBeVisible();

    // Collapsed state survives a reload (localStorage persistence, §2.3).
    await page.reload();
    await expect(page.getByRole("button", { name: "Sources and evidence" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Citations and history" })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-panels-collapsed='true']")).toBeVisible();

    // Re-expanding one un-widens the draft.
    await page.getByRole("button", { name: "Sources and evidence" }).click();
    await expect(page.getByRole("complementary", { name: "Sources and evidence panel" })).toBeVisible();
    await expect(page.locator("[data-panels-collapsed]")).toHaveCount(0);
  });

  for (const width of [768, 375]) {
    test(`narrow (${width}px): neither panel renders inline; opening one presents a focus-trapped, Escape-closing sheet; opening the other closes the first`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await login(page);
      await newProject(page, `Narrow ${width} panels project`);

      await expect(page.getByRole("complementary", { name: "Sources and evidence panel" })).toHaveCount(0);
      await expect(page.getByRole("complementary", { name: "Citations and revision history panel" })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const sourcesToggle = page.getByRole("button", { name: "Sources and evidence" });
      await sourcesToggle.click();
      const sourcesSheet = page.getByRole("dialog", { name: "Sources and evidence panel" });
      await expect(sourcesSheet).toBeVisible();
      await expect(sourcesSheet).toHaveAttribute("aria-modal", "true");

      // Opening Citations closes Sources first (the shared secondary-panel
      // singleton enforces "never more than one open" — §2.1).
      const citationsToggle = page.getByRole("button", { name: "Citations and history" });
      await citationsToggle.click();
      await expect(sourcesSheet).toHaveCount(0);
      const citationsSheet = page.getByRole("dialog", { name: "Citations and revision history panel" });
      await expect(citationsSheet).toBeVisible();

      // Escape closes the open sheet and restores focus to its trigger.
      await page.keyboard.press("Escape");
      await expect(citationsSheet).toHaveCount(0);
      await expect(citationsToggle).toBeFocused();
    });
  }

  test("narrow (375px): the sheet traps Tab focus and reduced motion does not prevent it from opening", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 375, height: 800 });
    await login(page);
    await newProject(page, "Keyboard panels project");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");

    const sourcesToggle = page.getByRole("button", { name: "Sources and evidence" });
    await sourcesToggle.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Sources and evidence panel" });
    await expect(sheet).toBeVisible();

    // Focus starts on the sheet's own close button (WriterPanelSheet's
    // open-effect), and Tab-cycling never leaves the dialog.
    await expect(page.getByRole("button", { name: "Close Sources and evidence panel" })).toBeFocused();
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const focusInsideDialog = await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null);
      expect(focusInsideDialog, `focus should stay inside the dialog after ${step + 1} Tab presses`).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(sourcesToggle).toBeFocused();
  });

  test("desktop (1280px): keyboard-only pass through — toggle, tab into contents, insert a citation, and restore a revision, with focus never lost", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    await newProject(page, "Keyboard desktop panels project");

    const sourcesToggle = page.getByRole("button", { name: "Sources and evidence" });
    const citationsToggle = page.getByRole("button", { name: "Citations and history" });

    // Collapsing and reopening a wide panel via the keyboard alone never
    // drops focus off its own toggle button — there is no dialog here to
    // trap/restore focus (that's the narrow-viewport sheet's job, covered
    // above), but focus should still never be lost.
    await sourcesToggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "Sources and evidence panel" })).toHaveCount(0);
    await expect(sourcesToggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "Sources and evidence panel" })).toBeVisible();
    await expect(sourcesToggle).toBeFocused();

    // Tab from the toggle into the reopened panel's own content — with no
    // Library sources yet (the empty state renders no interactive control),
    // its first focusable control is the citation import form.
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Citation import format")).toBeFocused();
    await page.getByLabel("Citation import format").selectOption("bibtex");
    await page.getByLabel("Citation metadata").fill("@book{keyb, title={Keyboard-Only Sources}, author={Keys, K.}, year={2020}, publisher={Press}}");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Keyboard-Only Sources")).toBeVisible();

    // Same collapse/reopen-without-losing-focus check for Citations, then
    // insert and restore entirely with the keyboard.
    await citationsToggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "Citations and revision history panel" })).toHaveCount(0);
    await expect(citationsToggle).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(citationsToggle).toBeFocused();

    const draft = page.getByLabel("Draft");
    await expect(draft).toHaveValue("");
    await page.getByRole("button", { name: "Insert" }).focus();
    await page.keyboard.press("Enter");
    await expect(draft).not.toHaveValue("");

    // Restoring a revision opens a native `confirm` dialog (§6: kept native
    // and unchanged by this stage) — accepting it should return focus to
    // the Restore control that triggered it, not somewhere unpredictable.
    const restoreButton = page.getByRole("button", { name: "Restore" }).first();
    page.once("dialog", (dialog) => dialog.accept());
    await restoreButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });
    await expect(restoreButton).toBeFocused();
  });

  test("autosave failure shows 'Save failed' with a working Retry that reaches 'Saved' on a subsequent successful save", async ({ page }) => {
    await login(page);
    await newProject(page, "Autosave failure project");

    let patchCount = 0;
    await page.route("**/api/writer/projects/*/documents/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      patchCount += 1;
      if (patchCount === 1) {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulated failure" }) });
        return;
      }
      await route.continue();
    });

    const draft = page.getByLabel("Draft");
    await draft.fill("This save will fail once.");
    await expect(page.getByRole("status")).toContainText("Save failed", { timeout: 10_000 });
    const retryButton = page.getByRole("button", { name: "Retry" });
    await expect(retryButton).toBeVisible();

    await retryButton.click();
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });
    expect(patchCount).toBeGreaterThanOrEqual(2);
  });

  test("same-browser two-tab conflict: a second tab editing the same document sees 'Edited in another tab', and Reload picks up the other tab's saved content", async ({ context }) => {
    // Same `BrowserContext` (one shared browser storage partition) with two
    // separate pages/tabs — deliberately not two independent
    // `browser.newContext()`s: `BroadcastChannel` (§4.3's cross-tab signal)
    // is scoped per storage partition, not per logged-in account, so two
    // different contexts would never see each other's messages regardless
    // of which document or user is involved.
    const pageA = await context.newPage();
    await login(pageA);
    const projectId = await newProject(pageA, "Two-tab conflict project");

    const pageB = await context.newPage();
    // Tab B's own saves are made to fail deterministically, so it stays
    // "unsaved" (Editing, then Save failed) for the whole test regardless
    // of exact timing — the conflict predicate (§4.3) only surfaces while
    // THIS tab has unsaved-or-unconfirmed local edits, and racing Tab A's
    // own save timing without this would make the test flaky.
    await pageB.route("**/api/writer/projects/*/documents/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.abort();
        return;
      }
      await route.continue();
    });
    await pageB.goto(`/writer/${projectId}`);
    const draftB = pageB.getByLabel("Draft");
    await expect(draftB).toBeVisible();
    await draftB.fill("Tab B's own unsaved edit");
    await expect(pageB.getByRole("status")).toContainText("Save failed", { timeout: 10_000 });

    const draftA = pageA.getByLabel("Draft");
    await draftA.fill("Tab A's saved content");
    await expect(pageA.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });

    await expect(pageB.getByRole("status")).toContainText("Edited in another tab", { timeout: 10_000 });
    const reloadButton = pageB.getByRole("button", { name: "Reload this document" });
    await expect(reloadButton).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Keep editing here" })).toBeVisible();

    // Clear the route block before reloading, so the fresh mount's own GET
    // fetches (sources, revisions) go through normally.
    await pageB.unroute("**/api/writer/projects/*/documents/*");
    await reloadButton.click();
    await expect(draftB).toHaveValue("Tab A's saved content", { timeout: 10_000 });
    await expect(pageB.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });

    await pageA.close();
    await pageB.close();
  });

  test("cross-device conflict (409): a stale save is rejected with 'Edited elsewhere', and Reload picks up the other device's saved content", async ({ page }) => {
    // Integration pass: the server-side `expectedUpdatedAt` contract
    // (stage6-write-spec.md §4.3's flagged follow-up, now implemented).
    // Simulated with a direct API PATCH rather than a second tab/page — this
    // deliberately bypasses this page's own JS entirely, so no
    // `BroadcastChannel` message is ever posted, which is what makes this
    // test exercise the real server-side 409 path instead of the same-tab
    // signal the adjacent test above already covers.
    await login(page);
    const projectId = await newProject(page, "Cross-device conflict project");
    const documentId = await page.getByLabel("Active document").inputValue();

    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });

    const response = await page.request.patch(`/api/writer/projects/${projectId}/documents/${documentId}`, {
      data: { title: "Renamed on another device" },
    });
    expect(response.ok()).toBe(true);

    // This tab's own in-memory `expectedUpdatedAt` is now stale — its next
    // autosave must be rejected with a real 409, never silently overwrite
    // the other device's save.
    await page.getByLabel("Draft").fill("This tab's edit races the other device's save.");
    await expect(page.getByRole("status")).toContainText("Edited elsewhere", { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Reload this document" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep editing here" })).toBeVisible();

    await page.getByRole("button", { name: "Reload this document" }).click();
    await expect(page.getByLabel("Document title")).toHaveValue("Renamed on another device", { timeout: 10_000 });
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });
  });

  test("cross-device conflict (409): 'Keep editing here' adopts the other device's version so the very next autosave succeeds", async ({ page }) => {
    await login(page);
    const projectId = await newProject(page, "Cross-device keep-editing project");
    const documentId = await page.getByLabel("Active document").inputValue();
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });

    const response = await page.request.patch(`/api/writer/projects/${projectId}/documents/${documentId}`, {
      data: { title: "Renamed elsewhere first" },
    });
    expect(response.ok()).toBe(true);

    await page.getByLabel("Draft").fill("First edit races the stale expectedUpdatedAt.");
    await expect(page.getByRole("status")).toContainText("Edited elsewhere", { timeout: 10_000 });

    // "Keep editing here" must not be a dead end: the very next autosave has
    // to reach "Saved", not 409 again against the same now-stale value.
    await page.getByRole("button", { name: "Keep editing here" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });
  });
});
