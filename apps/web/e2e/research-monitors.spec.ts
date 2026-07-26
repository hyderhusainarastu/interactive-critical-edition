import AxeBuilder from "@axe-core/playwright";
import { db, researchMonitorHits, researchMonitors, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 29.1: scheduled research monitoring web surfaces (`/research/monitors`
 * and `/research/[projectId]/monitors`), CRUD API, hits feed, and dismiss.
 * CI-safe — seeded directly against Postgres (no worker process, no live
 * provider call; the `research-hypotheses.spec.ts` precedent), with monitor
 * creation/cadence-update/delete driven through the real UI. "Add to corpus"
 * is deliberately NOT exercised here: unlike every other action on this page,
 * it makes a real network round-trip to a scholarly provider to re-resolve
 * the hit (`addMonitorHitToCorpus`'s own doc comment on why — the hit row
 * itself retains no externalId to import from directly), which a CI-safe,
 * no-live-API spec cannot mock through a Next.js server route. Run on its
 * own dedicated port (3175) per this lane's own port assignment.
 */

function main(page: Page) {
  return page.locator("#main-content");
}

const PORT = 3175;
const EMAIL = `e2e-monitors-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page, base = "") {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function markOnboarded(id: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, id));
}

async function scan(page: Page) {
  await page.waitForTimeout(300);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

async function createProjectViaApi(page: Page, title: string): Promise<string> {
  const response = await page.request.post("/api/research/projects", { data: { title } });
  const body = await response.json();
  return body.project.id as string;
}

async function seedMonitor(ownerId: string, overrides: { monitorType?: "topic" | "citation_alert" | "author_follow"; query?: string; cadence?: "daily" | "weekly" | "paused"; projectId?: string } = {}) {
  const [monitor] = await db
    .insert(researchMonitors)
    .values({
      userId: ownerId,
      projectId: overrides.projectId ?? null,
      monitorType: overrides.monitorType ?? "topic",
      query: overrides.query ?? "phenomenology of care",
      cadence: overrides.cadence ?? "daily",
    })
    .returning({ id: researchMonitors.id });
  return monitor.id;
}

async function seedHit(monitorId: string, overrides: { title?: string; dismissedAt?: Date } = {}) {
  const [hit] = await db
    .insert(researchMonitorHits)
    .values({
      monitorId,
      dedupKey: `title:${(overrides.title ?? "a discovered paper").toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID()}`,
      title: overrides.title ?? "A Discovered Paper",
      authors: ["Some Author"],
      year: 2025,
      venue: "Journal of Testing",
      url: "https://example.com/paper",
      provider: "semanticscholar",
      dismissedAt: overrides.dismissedAt ?? null,
    })
    .returning({ id: researchMonitorHits.id });
  return hit.id;
}

test.describe("Research monitoring (Phase 29.1)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("global monitors page: create, update cadence, and delete a monitor via the real UI", async ({ page }) => {
    await login(page);
    await page.goto("/research/monitors");
    await expect(main(page).getByRole("heading", { name: "Research monitors" })).toBeVisible();

    await main(page).getByLabel("Query").fill("care ethics and moral perception");
    await main(page).getByRole("button", { name: "Create monitor" }).click();
    const monitorItem = main(page).locator("li", { hasText: "care ethics and moral perception" });
    await expect(monitorItem).toBeVisible();

    await monitorItem.getByLabel(/Cadence for/).selectOption("weekly");
    await expect(monitorItem.getByLabel(/Cadence for/)).toHaveValue("weekly");

    await monitorItem.getByRole("button", { name: "Delete" }).click();
    await expect(main(page).locator("li", { hasText: "care ethics and moral perception" })).toHaveCount(0);
  });

  test("project-scoped monitors page: a monitor created here is scoped to the project", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Monitors scoping project");

    await page.goto(`/research/${projectId}/monitors`);
    await expect(main(page).getByRole("heading", { name: "Monitors", exact: true })).toBeVisible();

    await main(page).getByLabel("Monitor type").selectOption("author_follow");
    await main(page).getByLabel("Query").fill("Jane Scholar");
    await main(page).getByRole("button", { name: "Create monitor" }).click();
    await expect(main(page).locator("li", { hasText: "Jane Scholar" })).toBeVisible();

    // The same monitor must NOT leak into the global, unscoped view under a
    // different project's own listing (only asserting it appears on the
    // scoped page here; the global page's own listing is covered above).
    const otherProjectId = await createProjectViaApi(page, "A different project");
    await page.goto(`/research/${otherProjectId}/monitors`);
    await expect(main(page).locator("li", { hasText: "Jane Scholar" })).toHaveCount(0);
  });

  test("hits render on the global monitors page, grouped by their source monitor", async ({ page }) => {
    await login(page);
    const monitorId = await seedMonitor(userId, { query: "virtue and akrasia" });
    await seedHit(monitorId, { title: "A New Paper on Akrasia" });

    await page.goto("/research/monitors");
    await expect(main(page).getByText("A New Paper on Akrasia")).toBeVisible();
    await expect(main(page).getByText(/From monitor: virtue and akrasia/)).toBeVisible();
  });

  test("dismissing a hit removes it from the feed", async ({ page }) => {
    await login(page);
    const monitorId = await seedMonitor(userId, { query: "dismiss test monitor" });
    await seedHit(monitorId, { title: "A Hit To Dismiss" });

    await page.goto("/research/monitors");
    const hitItem = main(page).locator("li", { hasText: "A Hit To Dismiss" });
    await expect(hitItem).toBeVisible();
    await hitItem.getByRole("button", { name: "Dismiss" }).click();
    await expect(main(page).locator("li", { hasText: "A Hit To Dismiss" })).toHaveCount(0);
  });

  test("an already-dismissed hit does not appear on page load", async ({ page }) => {
    await login(page);
    const monitorId = await seedMonitor(userId, { query: "already dismissed monitor" });
    await seedHit(monitorId, { title: "Already Dismissed Hit", dismissedAt: new Date() });

    await page.goto("/research/monitors");
    await expect(main(page).getByText("Already Dismissed Hit")).toHaveCount(0);
  });

  test("an empty account shows honest empty states for both monitors and hits", async ({ page, request }) => {
    const emptyEmail = `e2e-monitors-empty-${Date.now()}@example.com`;
    const emptyUserId = await createVerifiedTestUser(emptyEmail, PASSWORD);
    await markOnboarded(emptyUserId);
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(emptyEmail);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/dashboard");

      await page.goto("/research/monitors");
      await expect(main(page).getByText(/No monitors yet/)).toBeVisible();
      await expect(main(page).getByText(/No new findings yet/)).toBeVisible();
    } finally {
      await deleteTestUser(emptyEmail);
      void request; // unused in this branch, kept for signature symmetry with other tests
    }
  });

  test("cost figures are never rendered on the monitors page (Workstream F precedent)", async ({ page }) => {
    await login(page);
    const monitorId = await seedMonitor(userId, { query: "no cost figures monitor" });
    await seedHit(monitorId, { title: "No Cost Figures Hit" });

    await page.goto("/research/monitors");
    const bodyText = (await main(page).innerText()).toLowerCase();
    expect(bodyText).not.toMatch(/\$\d/);
    expect(bodyText).not.toContain("estimated cost");
    expect(bodyText).not.toContain("actual cost");
  });

  test("the monitors page and its API are 404 while PHASE_25_MONITORING_ENABLED is off (even with PHASE_25_RESEARCH_ENABLED on)", async ({ page, request }) => {
    const webRoot = path.resolve(__dirname, "..");
    let server: ChildProcess | undefined;
    try {
      server = spawn(path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), ["start", "-p", String(PORT)], {
        cwd: webRoot,
        env: { ...process.env, PORT: String(PORT), PHASE_25_RESEARCH_ENABLED: "true", PHASE_25_MONITORING_ENABLED: "false" },
        stdio: "ignore",
      });
      const base = `http://localhost:${PORT}`;
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline && !ready) {
        try {
          const response = await fetch(`${base}/login`);
          if (response.ok) ready = true;
        } catch {
          // server not accepting connections yet
        }
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(ready, "second server (monitoring flag off) never became ready").toBe(true);

      const apiResponse = await request.get(`${base}/api/research/monitors`);
      expect(apiResponse.status()).toBe(404);

      await login(page, base);
      await page.goto(`${base}/research/monitors`);
      await expect(main(page).getByText("That page is not here.")).toBeVisible();
      await expect(main(page).getByRole("heading", { name: "Research monitors" })).toHaveCount(0);
    } finally {
      server?.kill("SIGTERM");
    }
  });

  test("axe: zero wcag2a/wcag2aa violations on the global monitors page, light and dark", async ({ page }) => {
    await login(page);
    const monitorId = await seedMonitor(userId, { query: "axe monitor" });
    await seedHit(monitorId, { title: "Axe Coverage Hit" });

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/research/monitors");
      await expect(main(page).getByRole("heading", { name: "Research monitors" })).toBeVisible();
      expect((await scan(page)).violations, `/research/monitors (${colorScheme})`).toEqual([]);
    }
  });

  test("axe: zero wcag2a/wcag2aa violations on the project-scoped monitors page, light and dark", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Axe project monitors");
    await seedMonitor(userId, { query: "axe project monitor", projectId });

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`/research/${projectId}/monitors`);
      await expect(main(page).getByRole("heading", { name: "Monitors", exact: true })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/monitors (${colorScheme})`).toEqual([]);
    }
  });

  // Every `research_monitor*` row this file inserts directly cascades from
  // `deleteTestUser(EMAIL)` in `afterAll` via `research_monitor.user_id`'s FK.
});
