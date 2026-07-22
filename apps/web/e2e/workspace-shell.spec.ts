import { expect, test } from "@playwright/test";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

const EMAIL = `e2e-workspace-shell-${Date.now()}@example.com`;
const PASSWORD = "password123";

test.describe("Phase 12 workspace foundation", () => {
  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await db
      .update(users)
      .set({
        preferences: {
          onboardedAt: new Date().toISOString(),
          workspace: {
            theme: "dark",
            fontSize: "medium",
            readingWidth: "comfortable",
            focusMode: false,
            scriptDisplay: "original",
          },
        },
      })
      .where(eq(users.id, userId));
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("offers keyboard search and persists presentation controls", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await expect(page.getByText("Navigate")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await page.getByLabel("Theme").selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  });

  test("traps focus in the command palette and returns focus to its trigger", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const trigger = page.getByRole("button", { name: "Search pages and works" });
    await trigger.focus();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Search Palimnote")).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("opens workspace preferences as a keyboard-managed dialog", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const trigger = page.getByRole("button", { name: "Workspace preferences" });
    await trigger.focus();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Workspace preferences" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close preferences" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("moves focus to the exit control when focus mode hides the shell", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    const focusMode = page.getByRole("checkbox", { name: "Focus mode" });
    await focusMode.focus();
    await page.keyboard.press("Space");

    const exit = page.getByRole("button", { name: "Exit focus mode" });
    await expect(exit).toBeVisible();
    await expect(exit).toBeFocused();
    const shellHeader = page.getByRole("banner");
    await expect(shellHeader).toHaveAttribute("inert", "");
    await page.keyboard.press("Tab");
    await expect(shellHeader.locator(":focus")).toHaveCount(0);

    await exit.click();
    await expect(page.getByRole("button", { name: "Workspace preferences" })).toBeFocused();
  });

  test("text size changes the actual reading font size and persists after a reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const bodyFontSizePx = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    const baseline = await bodyFontSizePx();

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    const [smallResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Text size").selectOption("small"),
    ]);
    expect(smallResponse.ok()).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-font-size", "small");
    const small = await bodyFontSizePx();
    expect(small).toBeLessThan(baseline);

    const [largeResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Text size").selectOption("large"),
    ]);
    expect(largeResponse.ok()).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-font-size", "large");
    const large = await bodyFontSizePx();
    expect(large).toBeGreaterThan(small);

    // Clear the client-side copy so a reload can only be reflecting what the
    // server actually persisted to the database, not localStorage.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-font-size", "large");
    expect(await bodyFontSizePx()).toBe(large);
  });

  test("reading width sets a real CSS custom property distinct per option and persists after a reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const readingMeasure = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--reading-measure").trim());

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Reading width").selectOption("compact"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("data-reading-width", "compact");
    const compact = await readingMeasure();
    expect(compact).toBe("58ch");

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Reading width").selectOption("wide"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("data-reading-width", "wide");
    const wide = await readingMeasure();
    expect(wide).toBe("88ch");
    expect(wide).not.toBe(compact);

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-reading-width", "wide");
  });

  test("the focus-mode checkbox reflects the applied preference on and off", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    const focusCheckbox = page.getByRole("checkbox", { name: "Focus mode" });
    await expect(focusCheckbox).not.toBeChecked();

    // Plain .click(), not .check(): .check() clicks AND then waits to
    // re-verify the checkbox reads checked=true, but enabling focus mode
    // unmounts this very checkbox (the panel auto-closes), so that
    // verification would wait on a detached element forever. The existing
    // D-19-20 test hit the same constraint and used a keyboard Space press
    // for the same reason.
    await focusCheckbox.click();
    // The checked state itself is then verified through persistence and
    // the exit control rather than re-reading the (now-gone) checkbox.
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();

    // Force a reload to read the persisted value from the server (clearing
    // localStorage first so this can only be proving the DB round-trip, not
    // the browser's own cached copy) — the Exit control being visible
    // immediately, pre-interaction, is the proof the "on" state survived.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();

    // Exiting sets the preference back to false; re-opening preferences has
    // to show the checkbox reflecting that — not a stale "checked" left
    // over from before the reload.
    await page.getByRole("button", { name: "Exit focus mode" }).click();
    await expect(page.getByRole("banner")).not.toHaveClass(/sr-only/);
    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await expect(page.getByRole("checkbox", { name: "Focus mode" })).not.toBeChecked();
  });

  test("logging out ends the session; a protected route then redirects to /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL("/");

    await page.goto("/dashboard");
    await page.waitForURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  });

  test("treats mobile navigation as a modal drawer and restores its trigger", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const trigger = page.getByRole("button", { name: "Open navigation" });
    await trigger.focus();
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Mobile navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
