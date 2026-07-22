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
 */
test.describe("Landing page visual contract (Phase 19.4)", () => {
  test("Reader/Annotations showcase — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Annotations that show their work" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("reader-annotations-desktop.png");
  });

  test("Reader/Annotations showcase — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Annotations that show their work" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("reader-annotations-mobile.png");
  });

  test("Roadmap showcase — desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "A reading order, not a pile of citations" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("roadmap-desktop.png");
  });

  test("Roadmap showcase — mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "A reading order, not a pile of citations" }) });
    await expect(section).toBeVisible();
    await expect(section).toHaveScreenshot("roadmap-mobile.png");
  });
});
