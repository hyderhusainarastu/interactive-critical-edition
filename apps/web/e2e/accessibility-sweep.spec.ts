import AxeBuilder from "@axe-core/playwright";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import {
  createVerifiedTestUser,
  deleteTestUser,
  seedPublishedEdition,
  seedWorkWithConcepts,
  seedWorkWithGraphData,
  seedWorkWithLibraryItems,
} from "./helpers";

/**
 * Phase 19 accessibility audit (§19.8): axe on every major authenticated
 * route. Before this file, automated axe coverage existed only for the
 * landing/privacy/terms pages (landing.spec.ts) and Writer
 * (hardening.spec.ts) — every other authenticated route had never been
 * scanned. All work data is seeded directly (no real upload/worker/live
 * API calls), matching curriculum.spec.ts/diagnostic.spec.ts/library.spec.ts's
 * own CI-safety reasoning: nothing here needs a running worker.
 *
 * Manual VoiceOver verification (the plan's other §19.8 requirement) is out
 * of scope for this agent — no macOS Accessibility API access — and is
 * recorded as an open item rather than silently skipped.
 */

const EMAIL = `e2e-a11y-sweep-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * A brief settle wait before every scan. Found via this sweep (D-19-8):
 * axe run immediately after `page.goto()` resolves caught a genuinely
 * transient state on /upload and /library — reported foreground colors
 * (`#e5e4e0`/`#e9e7e2`) matched neither this app's light- nor dark-theme
 * `--color-text`/`--color-text-muted` tokens, consistent with a CSS
 * `color` transition (`.app-control`'s `.16s ease`) caught mid-flight
 * rather than a real, stable, wrong-token bug — manually re-reading the
 * same elements' `getComputedStyle` a moment later showed the correct
 * light-theme color every time. 300ms is generous relative to the
 * longest transition/animation duration in `globals.css` (0.28s).
 */
async function scan(page: Page) {
  await page.waitForTimeout(300);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

test.describe("Accessibility sweep (Phase 19.8)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    // Onboarding itself is covered by onboarding.spec.ts; this sweep needs a
    // user who has already completed it, so /dashboard and /works/trash
    // (both gate on preferences.onboardedAt) don't redirect to /welcome.
    await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("dashboard", async ({ page }) => {
    await login(page);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("upload", async ({ page }) => {
    await login(page);
    await page.goto("/upload");
    await expect(page.getByRole("heading", { name: "Upload works" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("library", async ({ page }) => {
    await seedWorkWithLibraryItems(userId, "Library Sweep Work", [
      { resourceTitle: "Prior Analytics", relationship: "prerequisite" },
    ]);
    await login(page);
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("works list and work detail", async ({ page }) => {
    const { workId } = await seedPublishedEdition(userId);
    await login(page);
    await page.goto("/works");
    expect((await scan(page)).violations).toEqual([]);

    await page.goto(`/works/${workId}`);
    expect((await scan(page)).violations).toEqual([]);
  });

  test("reader", async ({ page }) => {
    const { workId } = await seedPublishedEdition(userId);
    await login(page);
    await page.goto(`/works/${workId}/reader`);
    expect((await scan(page)).violations).toEqual([]);
  });

  test("roadmap and per-work graph", async ({ page }) => {
    const { workId } = await seedWorkWithGraphData(userId, { title: "Roadmap Sweep Work" });
    await login(page);
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);

    await page.goto(`/works/${workId}/graph`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("curriculum", async ({ page }) => {
    const { workId } = await seedWorkWithLibraryItems(userId, "Curriculum Sweep Work", [
      { resourceTitle: "Posterior Analytics", relationship: "prerequisite" },
    ]);
    await login(page);
    await page.goto(`/works/${workId}/curriculum`);
    await expect(page.getByRole("heading", { name: "Curriculum" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("diagnostic", async ({ page }) => {
    const { workId } = await seedWorkWithConcepts(userId, { title: "Diagnostic Sweep Work" });
    await login(page);
    await page.goto(`/works/${workId}/diagnostic`);
    await expect(page.getByRole("heading", { name: "Concept check" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("global Visualization", async ({ page }) => {
    await seedWorkWithGraphData(userId, { title: "Global Graph Sweep Work" });
    await login(page);
    await page.goto("/graph");
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("trash", async ({ page }) => {
    await login(page);
    await page.goto("/works/trash");
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });

  test("Ask Library", async ({ page }) => {
    await login(page);
    await page.goto("/ask-library");
    await expect(page.getByRole("heading", { name: "Ask your Library", level: 1 })).toBeVisible();
    expect((await scan(page)).violations).toEqual([]);
  });
});
