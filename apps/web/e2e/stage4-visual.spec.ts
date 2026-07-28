import { expect, test } from "@playwright/test";
import { mkdirSync } from "fs";
import { join } from "path";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition, seedWorkInStatus, seedWorkWithGraphData, seedWorkWithLibraryItem } from "./helpers";
import { loginAs, markOnboarded, seedResumableWork } from "./stage4VerifyHelpers";

/**
 * Stage 4 VERIFICATION lane (round 1): unmasked screenshots + structural
 * checks (no horizontal scroll, 0 running animations under emulated
 * `reduced-motion`, light/dark both render) across every surface this lane
 * changed — Home, Reading Queue, Library, Upload, Reader, 2D Roadmap — at
 * 1440 and 375. Screenshots land in `docs/audits/stage4-read-verification/`
 * (the report cites them by filename). This is a real, committed spec —
 * not a throwaway script — so a future round can re-run the exact same
 * capture rather than re-deriving it.
 */

const SCREENSHOT_DIR = join(__dirname, "..", "..", "..", "docs", "audits", "stage4-read-verification");
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const EMAIL = `e2e-stage4-visual-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
let readyWorkId = "";
let libraryWorkId = "";
let roadmapWorkId = "";

async function checkNoHorizontalScroll(page: import("@playwright/test").Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
}

test.describe("Stage 4 visual sweep — 1440/375, light/dark, reduced motion", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
    await seedResumableWork(userId, { title: "Visual Sweep Resume Fixture" });
    await seedWorkInStatus(userId, "needs_review", { title: "Visual Sweep — needs review" });
    await seedWorkInStatus(userId, "processing", { title: "Visual Sweep — processing" });
    await seedWorkInStatus(userId, "failed", { title: "Visual Sweep — failed", processingError: "Seeded failure." });
    const edition = await seedPublishedEdition(userId);
    readyWorkId = edition.workId;
    const lib = await seedWorkWithLibraryItem(userId, { title: "Visual Sweep Library Anchor" });
    libraryWorkId = lib.workId;
    const graphed = await seedWorkWithGraphData(userId, { title: "Visual Sweep Roadmap Fixture" });
    roadmapWorkId = graphed.workId;
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  const viewports = [
    { width: 1440, height: 900, label: "1440" },
    { width: 375, height: 812, label: "375" },
  ];

  for (const viewport of viewports) {
    for (const colorScheme of ["light", "dark"] as const) {
      test(`Home / Reading Queue / Library / Upload / Roadmap at ${viewport.label} (${colorScheme})`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme });
        await loginAs(page, EMAIL, PASSWORD);

        // Home — real seeded "Continue reading" state (not the empty state,
        // captured separately below once per theme at 1440 only, to avoid
        // doubling every screenshot for a state that doesn't vary by width).
        // `.first()`: this text can transiently render twice in dev mode —
        // the already-documented D-19-36 self-healing Next.js/React
        // streaming-SSR duplicate-DOM artifact, not a new defect.
        await page.goto("/dashboard");
        await expect(page.getByText("Continue reading").first()).toBeVisible();
        await checkNoHorizontalScroll(page, `Home ${viewport.label} ${colorScheme}`);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `home-${viewport.label}-${colorScheme}.png`), fullPage: true });

        // Reading Queue (`/works`)
        await page.goto("/works");
        // `.first()`: same documented D-19-36 duplicate-DOM artifact as Home.
        await expect(page.getByText("Visual Sweep — needs review").first()).toBeVisible();
        await checkNoHorizontalScroll(page, `Reading Queue ${viewport.label} ${colorScheme}`);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `reading-queue-${viewport.label}-${colorScheme}.png`), fullPage: true });

        // Library — deep-links to `?focus=${libraryWorkId}` rather than
        // the bare default: Library's default Focus is the newest
        // UPLOADED work overall, which in this shared multi-fixture
        // account is `roadmapWorkId` (`seedWorkWithGraphData`, seeded
        // last, and seeded without `withLibraryResource` since Roadmap/
        // Sources read `graph_edge`/`research_resource`, not
        // `resource_role` — genuinely nothing for Library to show there).
        // Landing on that by default made the first screenshot attempt
        // legitimately show "No items match these filters" — not a
        // loading-race like the roadmap/library-count fixes above, but a
        // real "wrong fixture was focused" gap in this test itself,
        // caught by visually reviewing the screenshot. Deep-linking to
        // the actual Library-seeded work shows its real content instead.
        await page.goto(`/library?focus=${libraryWorkId}`);
        // `.first()`: the title legitimately renders twice by design (the
        // focus summary banner, then the item list row below it) — not
        // the D-19-36 duplicate-DOM artifact, an intentional structural
        // repeat this test only needs to confirm rendered at all.
        await expect(page.getByText("Nicomachean Ethics").first()).toBeVisible();
        await checkNoHorizontalScroll(page, `Library ${viewport.label} ${colorScheme}`);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `library-${viewport.label}-${colorScheme}.png`), fullPage: true });

        // Upload — the real file `<input>` is deliberately CSS-hidden
        // behind a visible drop-zone trigger (the same pattern
        // upload.spec.ts's own `setInputFiles` calls already rely on
        // without asserting visibility first), so check the visible
        // drop-zone text renders instead of asserting the hidden input
        // itself is visible.
        await page.goto("/upload");
        await expect(page.getByText("Drop files here, or click to choose them")).toBeVisible();
        await checkNoHorizontalScroll(page, `Upload ${viewport.label} ${colorScheme}`);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `upload-${viewport.label}-${colorScheme}.png`), fullPage: true });

        // 2D Roadmap — wait for the real stage-map content, not just the
        // static heading: data loads via an async effect, and the heading
        // assertion alone let the very first screenshot attempt capture
        // the shimmer/skeleton loading state instead of the actual roadmap
        // (caught by visually reviewing the screenshot itself, not a test
        // assertion — a reminder that "the test passed" isn't the same as
        // "the screenshot shows what it's meant to").
        await page.goto(`/works/${roadmapWorkId}/roadmap`);
        await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();
        await expect(page.locator("[data-roadmap-stage-columns]")).toBeVisible();
        await checkNoHorizontalScroll(page, `Roadmap ${viewport.label} ${colorScheme}`);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `roadmap2d-${viewport.label}-${colorScheme}.png`), fullPage: true });
      });

      test(`Reader (Interactive + Published edition) at ${viewport.label} (${colorScheme})`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.emulateMedia({ colorScheme });
        await loginAs(page, EMAIL, PASSWORD);

        await page.goto(`/works/${readyWorkId}/reader`);
        await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
        await checkNoHorizontalScroll(page, `Reader (interactive) ${viewport.label} ${colorScheme}`);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `reader-interactive-${viewport.label}-${colorScheme}.png`), fullPage: true });

        await page.getByRole("button", { name: "Published edition" }).click();
        await expect(page.getByRole("region", { name: /published edition.*original/i })).toBeVisible();
        await checkNoHorizontalScroll(page, `Reader (published) ${viewport.label} ${colorScheme}`);
        await page.screenshot({ path: join(SCREENSHOT_DIR, `reader-published-${viewport.label}-${colorScheme}.png`), fullPage: true });
      });
    }
  }

  test("Home empty state at 1440, light and dark", async ({ page }) => {
    const emptyEmail = `e2e-stage4-visual-empty-${Date.now()}@example.com`;
    const emptyUserId = await createVerifiedTestUser(emptyEmail, PASSWORD);
    await markOnboarded(emptyUserId);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme });
      await loginAs(page, emptyEmail, PASSWORD);
      await page.goto("/dashboard");
      // `.first()`: same documented D-19-36 duplicate-DOM artifact as above.
      await expect(page.getByText(/Nothing to resume yet/).first()).toBeVisible();
      await checkNoHorizontalScroll(page, `Home empty ${colorScheme}`);
      await page.screenshot({ path: join(SCREENSHOT_DIR, `home-empty-1440-${colorScheme}.png`), fullPage: true });
      await page.context().clearCookies();
    }
    await deleteTestUser(emptyEmail);
  });

  test("reduced motion: 0 running animations on Home, Reading Queue, and the 2D roadmap stage map", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loginAs(page, EMAIL, PASSWORD);

    await page.goto("/dashboard");
    expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

    await page.goto("/works");
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

    await page.goto(`/works/${roadmapWorkId}/roadmap`);
    await expect(page.locator("[data-roadmap-stage-columns]")).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});
