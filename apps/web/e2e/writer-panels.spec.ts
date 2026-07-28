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
});
