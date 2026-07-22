import { expect, test } from "@playwright/test";

/**
 * Phase 19 §19.4: the landing page's Reader/Annotations showcase
 * (`ReaderShowcase`) and Roadmap showcase (`RoadmapShowcase`) in
 * apps/web/src/app/page.tsx are the plan's protected visual contract —
 * the authenticated Reader/Annotations/Roadmap surfaces must be brought
 * into parity with these depictions in Phase 22, not the other way
 * around. These screenshots are the immutable reference fixtures; a
 * failure here means the landing page changed, which the plan forbids
 * during Phases 19-23 unless the change is deliberately re-baselined
 * with owner sign-off.
 *
 * `maxDiffPixels: 40` on every assertion below (2026-07-22, CI run
 * 29960413885, commit 4552a81 — a docs-only commit that could not have
 * changed rendering): CI failed the Reader/Annotations showcase at
 * exactly "8 pixels (ratio 0.01% of all image pixels) are different"
 * on both desktop and mobile, on the original attempt AND its retry,
 * while the immediately prior run (374a97a) passed the identical spec
 * against the identical checked-in baseline. Zero rendering-relevant
 * files changed between the two commits (doc/status-tracker files
 * only), so this is sub-pixel font-rasterization jitter between the
 * baselines' generation environment (the pinned
 * mcr.microsoft.com/playwright:v1.61.1-noble Docker image) and the
 * CI job's native ubuntu-latest Playwright install, not a real content
 * regression. 40 is 5x the observed 8px flake (headroom for the same
 * class of jitter recurring on the Roadmap showcase, which has not yet
 * hit it) while staying far below any pixel count a genuine layout,
 * copy, or token change to these frozen sections would produce.
 */
test.describe("Landing page visual contract (Phase 19.4)", () => {
  test("Reader/Annotations showcase — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Annotations that show their work" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("reader-annotations-desktop.png", { maxDiffPixels: 40 });
  });

  test("Reader/Annotations showcase — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Annotations that show their work" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("reader-annotations-mobile.png", { maxDiffPixels: 40 });
  });

  test("Roadmap showcase — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "A reading order, not a pile of citations" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("roadmap-desktop.png", { maxDiffPixels: 40 });
  });

  test("Roadmap showcase — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "A reading order, not a pile of citations" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("roadmap-mobile.png", { maxDiffPixels: 40 });
  });
});
