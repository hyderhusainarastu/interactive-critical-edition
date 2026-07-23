import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

const EMAIL = `e2e-hardening-${Date.now()}@example.com`;
const PASSWORD = "password123";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

test.describe("Phase 12 hardening", () => {
  test.beforeAll(async () => { await createVerifiedTestUser(EMAIL, PASSWORD); });
  test.afterAll(async () => { await deleteTestUser(EMAIL); });

  test("Writer remains keyboard-operable, accessible, responsive, dark, reduced-motion, and RTL-safe", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await login(page);
    await page.goto("/writer");
    // Found during the Phase 19 accessibility audit (D-19-7): every
    // assertion below this point is shell-level (header/preferences/RTL
    // layout), so with PHASE_12_WRITER_ENABLED off this test previously
    // passed against Next.js's own "not found" page instead of real Writer
    // content — a false positive that told nobody the feature was
    // disabled. Assert on Writer's own content first so a disabled or
    // broken Writer fails loudly here instead.
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await page.getByLabel("Theme").selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).not.toHaveCount(0);
    const transitionDuration = await page.locator(".app-icon-button").first().evaluate((node) => Number.parseFloat(getComputedStyle(node, "::after").transitionDuration));
    expect(transitionDuration).toBeLessThanOrEqual(0.01);
    // D-22-10: Writer's "New project" button gained the shared `.app-control`
    // hover/focus transition — same blanket reduced-motion override, checked
    // directly on the element this time (no `::after` pseudo involved).
    const newProjectTransition = await page.getByRole("button", { name: "New project" }).evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration));
    expect(newProjectTransition).toBeLessThanOrEqual(0.01);

    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(accessibility.violations).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });
});
