import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Phase 6 E2E: the public landing and policy pages render their key
 * content and pass an automated accessibility scan (plan §20/§23). No
 * login or worker needed — these are static public pages.
 */
test.describe("Landing & policy pages (Phase 6)", () => {
  test("landing page communicates the product and has no accessibility violations", async ({ page }) => {
    await page.goto("/");

    // Brand name is present in the header (Phase 11.1 rename).
    await expect(page.getByRole("link", { name: "Palimnote" })).toBeVisible();

    // Value proposition is legible from the page alone.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/whole conversation around them/i);
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start reading" }).first()).toBeVisible();
    // The three capability showcases are present.
    await expect(page.getByRole("heading", { name: /Annotations that show their work/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /A reading order/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /you.*re missing/i })).toBeVisible();
    // Reliability/trust messaging and policy links.
    await expect(page.getByText(/research aid/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Privacy/i })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("privacy and terms pages render", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: /Privacy & copyright/i })).toBeVisible();
    await expect(page.getByText(/never bypasses paywalls/i)).toBeVisible();

    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: /Terms of use/i })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
