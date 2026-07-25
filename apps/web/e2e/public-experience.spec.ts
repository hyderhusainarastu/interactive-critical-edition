import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Public editorial experience", () => {
  test("hero headline settles visibly without moving the initial viewport", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.waitForTimeout(1_500);

    const words = page.locator(".hero-title > span");
    await expect(words).toHaveCount(3);
    for (const word of await words.all()) {
      await expect(word).toBeVisible();
      await expect(word).toHaveCSS("opacity", "1");
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("policy disclosures and footer routes are explicit", async ({ page }) => {
    await page.goto("/privacy");

    await expect(page.getByRole("heading", { name: "Research data sharing is your choice" })).toBeVisible();
    await expect(page.getByText(/titles of works you upload, activity and usage patterns/i)).toBeVisible();
    await expect(page.getByText(/page-visit counts, session starts, uploads/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Account deletion and export" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Development", exact: true })).toHaveAttribute("href", "/development");
    // Workstream J (2026-07-25) replaced the old `mailto:` "Feedback" link
    // with a real in-app FeedbackTrigger button that opens FeedbackModal.
    await page.getByRole("button", { name: "Feedback", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Share feedback" })).toBeVisible();
    await page.getByRole("button", { name: "Close feedback form" }).click();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("OS and Palimnote reduced-motion settings disable scroll choreography", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.locator("html")).not.toHaveClass(/lenis/);
    const sectionMotion = await page.locator("section#reader").evaluate((element) => {
      const style = getComputedStyle(element);
      return { opacity: style.opacity, transform: style.transform };
    });
    expect(sectionMotion.opacity).toBe("1");
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(sectionMotion.transform);

    // A live preference change rebuilds the observer without hiding targets
    // that were already revealed under reduced motion.
    await page.locator("html").evaluate((element) => {
      (element as HTMLElement).dataset.motion = "full";
    });
    await expect(page.locator("section#reader")).toHaveClass(/is-visible/);
    await expect(page.locator("section#reader")).toBeVisible();

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      localStorage.setItem(
        "palimnote.workspace-preferences",
        JSON.stringify({ theme: "system", motionEnabled: false, soundEnabled: true }),
      );
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
    await expect(page.locator("html")).not.toHaveClass(/lenis/);
  });

  test("canvas wheel zoom uses a cancelable non-passive listener", async ({ page }) => {
    await page.goto("/");
    const canvas = page.locator("section#graph canvas");
    await canvas.scrollIntoViewIfNeeded();

    const prevented = await canvas.evaluate((element) => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });
});
