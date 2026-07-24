import { expect, test } from "@playwright/test";

/**
 * Landing-page visual contract.
 *
 * ORIGIN (Phase 19 §19.4): this spec froze the landing page's old
 * `ReaderShowcase` and `RoadmapShowcase` as the protected reference the
 * authenticated Reader/Annotations/Roadmap surfaces had to be brought into
 * parity with during Phase 22 — not the other way around. A failure meant
 * the landing page had changed, which the plan forbade during Phases 19-23
 * "unless the change is deliberately re-baselined with owner sign-off."
 *
 * RE-BASELINED 2026-07-23, with that owner sign-off: the owner directed a
 * full landing-page rebuild from their own campaign site (new hero, new
 * theme, campaign-derived Reader and Library depictions, the interactive
 * 3D graph, a new Ask Library section). The frozen sections no longer
 * exist, so the freeze is superseded rather than broken. The contract now
 * guards the two depictions the owner singled out as the ones to keep —
 * the annotated reader and the Library.
 *
 * The knowledge-graph section is deliberately NOT covered here: it renders
 * a canvas whose projection is recomputed per device pixel ratio and
 * container size, so it is not a stable screenshot subject. Its content is
 * asserted structurally in landing.spec.ts instead.
 *
 * `maxDiffPixels: 40` carried over from the original spec (2026-07-22, CI
 * run 29960413885, commit 4552a81 — a docs-only commit that could not have
 * changed rendering): CI failed at exactly "8 pixels (ratio 0.01% of all
 * image pixels) are different" on both desktop and mobile, on the original
 * attempt AND its retry, while the immediately prior run (374a97a) passed
 * the identical spec against the identical checked-in baseline. That is
 * sub-pixel font-rasterization jitter between the baselines' generation
 * environment (the pinned mcr.microsoft.com/playwright:v1.61.1-noble
 * Docker image) and the CI job's native ubuntu-latest Playwright install,
 * not a real content regression. 40 is 5x the observed flake while staying
 * far below any pixel count a genuine layout, copy, or token change to
 * these sections would produce.
 */
test.describe("Landing page visual contract", () => {
  test("Annotated reader depiction — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const section = page.locator("section#reader");
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("reader-annotations-desktop.png", { maxDiffPixels: 40 });
  });

  test("Annotated reader depiction — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const section = page.locator("section#reader");
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("reader-annotations-mobile.png", { maxDiffPixels: 40 });
  });

  test("Library depiction — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const section = page.locator("section#library");
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("library-desktop.png", { maxDiffPixels: 40 });
  });

  test("Library depiction — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const section = page.locator("section#library");
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("library-mobile.png", { maxDiffPixels: 40 });
  });
});
