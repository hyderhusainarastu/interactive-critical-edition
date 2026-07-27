import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Phase 6 E2E, rewritten 2026-07-23 for the campaign-derived landing page:
 * the public landing and policy pages render their key content and pass an
 * automated accessibility scan (plan §20/§23). No login or worker needed —
 * these are static public pages.
 *
 * The zero-violation axe gate is unchanged, and is the reason the ported
 * campaign stylesheet carries a contrast pass (see the header comment in
 * apps/web/src/app/site-theme.css) and the ported depictions carry
 * `role="cell"` on their table rows.
 */

const DOCUMENTATION_URL = "https://hyderhusainarastu.com/palimnote/";

/** Parses `#rrggbb` or `rgb(r, g, b)` into 0-255 channels. */
function parseColor(value: string): [number, number, number] {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!rgb) throw new Error(`Unsupported color: ${value}`);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** WCAG 2.x relative-luminance contrast ratio between two CSS colors. */
function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = parseColor(color).map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.describe("Landing & policy pages (Phase 6)", () => {
  test("landing page communicates the product and has no accessibility violations", async ({ page }) => {
    await page.goto("/");

    // Brand is present in the masthead (Phase 11.1 rename).
    await expect(page.getByRole("link", { name: "Palimnote home" }).first()).toBeVisible();

    // Value proposition is legible from the page alone.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Never Alone/i);
    await expect(page.getByRole("heading", { name: /From an uploaded text to a world you can study/i })).toBeVisible();

    // Each of the four product depictions is present and labelled.
    await expect(page.getByRole("heading", { name: /One passage\. Different kinds of knowledge/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Every source\. One remembered reason/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /See every kind of relation/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Answers that have to show where they came from/i })).toBeVisible();

    // The 3D graph is a real interactive canvas, not a static sketch.
    await expect(page.locator("section#graph canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accessible list" })).toBeVisible();

    // Reading-order and trust messaging.
    await expect(page.getByRole("heading", { name: /A reading order, not a pile of citations/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Uncertainty belongs in the interface/i })).toBeVisible();
    await expect(page.getByText(/research aid/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Privacy/i }).first()).toBeVisible();

    // The documentation CTA points off-site and opens in a new tab.
    const docs = page.getByRole("link", { name: /Read the full documentation/i });
    await expect(docs).toHaveAttribute("href", DOCUMENTATION_URL);
    await expect(docs).toHaveAttribute("target", "_blank");
    await expect(docs).toHaveAttribute("rel", /noopener/);

    const badge = page.getByRole("link", { name: /Beta v\.6/i }).first();
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("href", "/development");

    // Check the live token against the live page background independently
    // from any local style inheritance on the badge itself.
    const badgeContrast = await page.evaluate(() => {
      const token = getComputedStyle(document.documentElement).getPropertyValue("--color-beta-badge").trim();
      const background = getComputedStyle(document.querySelector(".pal-site")!).backgroundColor;
      return { token, background };
    });
    expect(contrastRatio(badgeContrast.token, badgeContrast.background)).toBeGreaterThanOrEqual(4.5);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("landing depictions are interactive", async ({ page }) => {
    await page.goto("/");

    // Library depiction: the reading-status tabs actually filter the table.
    const allRows = await page.locator("section#library .library-row").count();
    await page.getByRole("button", { name: /^Reading/ }).click();
    const readingRows = await page.locator("section#library .library-row").count();
    expect(readingRows).toBeLessThan(allRows);

    // Graph depiction: the accessible list is an equal view of the same data.
    await page.getByRole("button", { name: "Accessible list" }).click();
    await expect(page.locator("section#graph .graph-table")).toBeVisible();
    await expect(page.locator("section#graph canvas")).toHaveCount(0);
  });

  test("the theme toggle switches the landing page to dark and persists it", async ({ page }) => {
    await page.goto("/");

    // Default is light (Playwright's default colorScheme), and the toggle
    // therefore offers the dark action.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const toggle = page.getByRole("button", { name: "Switch to dark theme" });
    await toggle.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();

    // The visuals actually change, not just the attribute: the page
    // background flips from the campaign's bone paper to its dark ground.
    const background = await page
      .locator(".pal-site")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(background).toBe("rgb(16, 23, 30)");

    // Dark mode must clear the same accessibility bar as light mode.
    const darkResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(darkResults.violations).toEqual([]);

    // The choice is written to the shared workspace-preference key, so it
    // carries into the signed-in app rather than being a second mechanism.
    const stored = await page.evaluate(() => window.localStorage.getItem("palimnote.workspace-preferences"));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!).theme).toBe("dark");

    // And it survives a reload, applied before paint by PreferenceBootstrap.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("the public sound toggle persists its accessible muted state", async ({ page }) => {
    await page.goto("/");

    // Sound defaults on for a fresh visitor. This test verifies the setting,
    // not WebAudio output (which browsers intentionally gate by gesture).
    const toggle = page.getByRole("button", { name: "Mute interface sounds" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(page.getByRole("button", { name: "Enable interface sounds" })).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    const muted = page.getByRole("button", { name: "Enable interface sounds" });
    await expect(muted).toHaveAttribute("aria-pressed", "false");

    await muted.click();
    await expect(page.getByRole("button", { name: "Mute interface sounds" })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByRole("button", { name: "Mute interface sounds" })).toHaveAttribute("aria-pressed", "true");
  });

  test("privacy and terms pages render", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: /Privacy & copyright/i })).toBeVisible();
    await expect(page.getByText(/never bypasses paywalls/i)).toBeVisible();

    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: /Terms of use/i })).toBeVisible();

    await page.goto("/development");
    await expect(page.getByRole("heading", { level: 1, name: /A reader built in layers/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /A more expressive scholarly workspace/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Refinement in the open/i })).toBeVisible();
    await expect(page.getByText("In progress", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Development versions" })).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
