import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedDebateCluster, seedPublishedEdition, seedWorkWithGraphData } from "./helpers";

/**
 * A11y-proxy / cross-browser smoke findings (stage7-prep/a11y-proxy.md and
 * crossbrowser-smoke.md, finding #4): "Minified React error #418" fired
 * exactly 4 times per full smoke run, identically in both Firefox and
 * WebKit — a real, deterministic hydration mismatch, not a browser quirk.
 * Reproduced locally in dev mode (unminified): `RootLayout`'s `<html>`
 * carries none of `PreferenceBootstrap`'s pre-hydration attributes
 * server-side (`data-theme`/`data-theme-preference`/`data-font-size`/
 * `data-reading-width`/`data-focus-mode`/`data-script-display`/
 * `data-motion`), but that inline `<head>` script sets them directly on
 * `document.documentElement` — the very node the App Router hydrates —
 * before React reconciles it, guaranteeing a mismatch on every load. Fixed
 * by adding `suppressHydrationWarning` to `<html>` in
 * `apps/web/src/app/layout.tsx` (the same, standard fix `next-themes` and
 * React's own hydration docs name for exactly this "deliberate pre-
 * hydration script" pattern).
 *
 * This test walks the same ~10-step path the two prep lanes' smoke runs
 * did (login, dashboard, works list, reader, graph chooser, work graph
 * context, 3D/List view, research project, writer) and asserts zero
 * hydration-mismatch console errors/pageerrors across the whole walk — not
 * just that the app still functions, since a hydration error can log
 * without breaking any assertion a functional test would catch.
 */

const EMAIL = `e2e-hydration-smoke-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
let readerWorkId = "";
let graphWorkId = "";
let researchProjectId = "";

function isHydrationError(text: string): boolean {
  return /hydrat|error #418|Minified React error #418/i.test(text);
}

test.beforeAll(async () => {
  userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
  const edition = await seedPublishedEdition(userId);
  readerWorkId = edition.workId;
  const graph = await seedWorkWithGraphData(userId, { title: `Hydration smoke graph work ${Date.now()}` });
  graphWorkId = graph.workId;
  const debate = await seedDebateCluster(userId, readerWorkId);
  researchProjectId = debate.projectId;
});

test.afterAll(async () => {
  await deleteTestUser(EMAIL);
});

test("zero hydration-mismatch errors across a full login-to-writer smoke walk", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && isHydrationError(msg.text())) hydrationErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    if (isHydrationError(err.message)) hydrationErrors.push(err.message);
  });

  // 1. Login
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");

  // 2. Dashboard
  await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();

  // 3. Works list
  await page.goto("/works");
  await expect(page.getByRole("heading", { name: "Reading Queue" })).toBeVisible();

  // 4. Reader renders
  await page.goto(`/works/${readerWorkId}/reader`);
  await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();

  // 5. /graph context chooser
  await page.goto("/graph");
  await expect(page.getByTestId("knowledge-map-context-chooser")).toBeVisible();

  // 6. Open a work's graph context (3D canvas or fallback)
  await page.goto(`/works/${graphWorkId}/graph`);
  await expect(page.getByTestId("knowledge-map-scene").or(page.getByTestId("knowledge-map-list-view"))).toBeVisible({ timeout: 20_000 });

  // 7. List view renders data
  const listButton = page.getByRole("button", { name: "List", exact: true });
  if (await listButton.isVisible().catch(() => false)) await listButton.click();
  await expect(page.getByTestId("knowledge-map-list-view")).toBeVisible();

  // 8. Research project
  await page.goto(`/research/${researchProjectId}`);
  // `.first()`: unrelated to hydration — a duplicate-DOM streaming-SSR
  // artifact already documented (docs/PROJECT-LOG.md D-19-36) can leave two
  // identical `<h1>`s briefly; not this test's concern.
  await expect(page.locator("h1").first()).toBeVisible();

  // 9. Writer
  await page.goto("/writer");
  await expect(page.locator("main")).toBeVisible();

  expect(hydrationErrors, `hydration-mismatch console/page errors: ${JSON.stringify(hydrationErrors)}`).toEqual([]);
});
