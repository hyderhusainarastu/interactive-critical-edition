import AxeBuilder from "@axe-core/playwright";
import { db, evidenceChambers, researchProjects, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser, seedDebateCluster, seedOwnedWork } from "./helpers";

/**
 * Stage 5 "projectnav-chambers" step (docs/design/stage5-research-spec.md
 * §2, §3): the persistent project subnav rendered by the new
 * `[projectId]/layout.tsx`, and the new project-level Evidence Chambers
 * view. Runs against a DEDICATED, isolated built-server instance — the
 * `research-chambers.spec.ts`/`research-corpus.spec.ts` fixed-port idiom, so
 * this worktree lane running alongside other parallel lanes on the same
 * shared local Postgres never collides. Everything here is CI-safe in
 * spirit (seeded directly against Postgres, no live model/worker call) but
 * is not wired into the CI-safe subset, the same "manual full-stack run"
 * category as the rest of the research spec files.
 */

const PORT = 3197;
const MONITORING_PORT = 3198;
const BASE_URL = `http://localhost:${PORT}`;

function main(page: Page) {
  return page.locator("#main-content");
}

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Research project sections" });
}

async function scan(page: Page) {
  // Same 300ms settle precedent as research.spec.ts/research-chambers.spec.ts
  // (D-19-8) — gives `.app-control`/`.app-panel-enter` transitions time to
  // finish before axe reads computed color/contrast.
  await page.waitForTimeout(300);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

async function waitForServerReady(base: string, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/login`);
      if (response.ok) return true;
    } catch {
      // server not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function spawnServer(port: number, extraEnv: Record<string, string> = {}) {
  const webRoot = path.resolve(__dirname, "..");
  // `next/dist/bin/next` (not the `.bin/next` shell wrapper) is spawned
  // directly since it carries its own `#!/usr/bin/env node` shebang and is
  // a real JS entry point `spawn()` can exec — the `research.spec.ts` precedent.
  return spawn(path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), ["start", "-p", String(port)], {
    cwd: webRoot,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: "ignore",
  });
}

const EMAIL = `e2e-projectnav-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
let server: ChildProcess | undefined;

async function login(page: Page, baseUrl = BASE_URL) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function markOnboarded(id: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, id));
}

/** A project with a debate cluster (via the existing `seedDebateCluster`
 *  helper) plus one already-synthesized `evidence_chamber` on top of it —
 *  enough for the project-level Chambers list view, without needing that
 *  helper's own full credibility-chain fixture (irrelevant to a list view
 *  that never renders chamber detail). */
async function seedProjectWithChamber(ownerId: string) {
  const work = await seedOwnedWork(ownerId);
  const debate = await seedDebateCluster(ownerId, work.workId);
  const [chamber] = await db
    .insert(evidenceChambers)
    .values({
      userId: ownerId,
      projectId: debate.projectId,
      clusterId: debate.clusterId,
      question: "Is the soul separable from the body it forms?",
      sharedGround: "Both readings agree the soul actualizes the body.",
      pointOfDivergence: "One reading treats separability as literal; the other as merely conceptual.",
      possibleReconciliation: "Distinguish the intellect from the rest of the soul.",
      unresolvedQuestion: "Whether any part of the soul survives independently.",
      missingEvidence: "A shared criterion for what 'separable' means here.",
      nextAction: "Compare both readings against De Anima directly.",
      basisHash: `e2e-projectnav-chamber-basis-${debate.clusterId}`,
      promptVersion: "evidence-chamber-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: evidenceChambers.id });
  return { projectId: debate.projectId, clusterId: debate.clusterId, chamberId: chamber.id };
}

test.describe("Research project navigation and Evidence Chambers project view", () => {
  test.use({ baseURL: BASE_URL });

  test.beforeAll(async () => {
    server = spawnServer(PORT, { PHASE_25_RESEARCH_ENABLED: "true" });
    const ready = await waitForServerReady(BASE_URL);
    expect(ready, "dedicated port-3197 server never became ready").toBe(true);

    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    server?.kill("SIGTERM");
  });

  test("persistent nav renders on the project overview with the correct tabs, order, and active state", async ({ page }) => {
    const fixture = await seedProjectWithChamber(userId);
    await login(page);

    await page.goto(`/research/${fixture.projectId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();

    const projectNav = nav(page);
    await expect(projectNav).toBeVisible();
    const links = projectNav.getByRole("link");
    // Order matches charter §6 exactly; Monitors omitted (flag off on this server).
    await expect(links).toHaveText([
      "Overview",
      "Corpus",
      "Claims",
      "Debates",
      "Evidence Chambers",
      "Hypotheses",
      "Knowledge Map",
    ]);
    await expect(projectNav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    await expect(projectNav.getByRole("link", { name: "Claims" })).not.toHaveAttribute("aria-current", "page");
  });

  test("active tab tracks nested routes, and the same nav renders across project pages", async ({ page }) => {
    const fixture = await seedProjectWithChamber(userId);
    await login(page);

    await page.goto(`/research/${fixture.projectId}/debates/${fixture.clusterId}`);
    await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Debates" })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current", "page");

    await page.goto(`/research/${fixture.projectId}/corpus`);
    await expect(main(page).getByRole("heading", { name: "Corpus", exact: true })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Corpus" })).toHaveAttribute("aria-current", "page");

    await page.goto(`/research/${fixture.projectId}/hypotheses`);
    await expect(nav(page).getByRole("link", { name: "Hypotheses" })).toHaveAttribute("aria-current", "page");
  });

  test("the overview's old quick-link button row is gone, and breadcrumbs are unchanged", async ({ page }) => {
    const fixture = await seedProjectWithChamber(userId);
    await login(page);

    await page.goto(`/research/${fixture.projectId}`);
    await expect(main(page).getByRole("link", { name: "View claims" })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "View debates" })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "Hypotheses & gaps" })).toHaveCount(0);
    // The breadcrumb itself still exists, unchanged (§2.4) — project title as
    // the trailing, non-link crumb, not folded into the persistent nav.
    await expect(main(page).getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();

    await page.goto(`/research/${fixture.projectId}/chambers`);
    const breadcrumb = main(page).getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("link", { name: "Research" })).toBeVisible();
    await expect(breadcrumb.getByText("Evidence Chambers")).toBeVisible();
  });

  test("Evidence Chambers project view renders a seeded chamber linking to its permalink, and an honest empty state otherwise", async ({ page }) => {
    const fixture = await seedProjectWithChamber(userId);
    await login(page);

    await page.goto(`/research/${fixture.projectId}/chambers`);
    await expect(main(page).getByRole("heading", { name: "Evidence Chambers" })).toBeVisible();
    const link = main(page).getByRole("link", { name: "Is the soul separable from the body it forms?" });
    await expect(link).toHaveAttribute("href", `/research/chambers/${fixture.chamberId}`);

    const [emptyProject] = await db.insert(researchProjects).values({ userId, title: "No chambers yet" }).returning({ id: researchProjects.id });
    await page.goto(`/research/${emptyProject.id}/chambers`);
    await expect(main(page).getByRole("heading", { name: "Evidence Chambers" })).toBeVisible();
    await expect(main(page).getByText("No evidence chambers yet")).toBeVisible();
  });

  test("axe: zero wcag2a/wcag2aa violations on the persistent nav and the new Chambers route, light and dark", async ({ page }) => {
    const fixture = await seedProjectWithChamber(userId);
    await login(page);

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });

      await page.goto(`/research/${fixture.projectId}`);
      await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId] with persistent nav (${colorScheme})`).toEqual([]);

      await page.goto(`/research/${fixture.projectId}/chambers`);
      await expect(main(page).getByRole("heading", { name: "Evidence Chambers" })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/chambers (${colorScheme})`).toEqual([]);
    }
  });

  test("the Monitors tab is present only when PHASE_25_MONITORING_ENABLED is on, and absent (this suite's main server) when it's off", async ({ page }) => {
    // Main-server pass first: monitoring is off here (only PHASE_25_RESEARCH_ENABLED
    // is set for the dedicated port-3197 server started in beforeAll), so the
    // tab must be entirely absent — not disabled — on every project route.
    const fixture = await seedProjectWithChamber(userId);
    await login(page);
    await page.goto(`/research/${fixture.projectId}`);
    await expect(nav(page).getByRole("link", { name: "Monitors" })).toHaveCount(0);

    // A second, temporary dedicated server with monitoring explicitly on —
    // the `research.spec.ts` flag-off sub-test's own "spawn a second server
    // just for this one assertion" idiom, applied to a second flag instead.
    const monitoringBase = `http://localhost:${MONITORING_PORT}`;
    let monitoringServer: ChildProcess | undefined;
    try {
      monitoringServer = spawnServer(MONITORING_PORT, { PHASE_25_RESEARCH_ENABLED: "true", PHASE_25_MONITORING_ENABLED: "true" });
      const ready = await waitForServerReady(monitoringBase);
      expect(ready, "dedicated port-3198 (monitoring-on) server never became ready").toBe(true);

      const [project] = await db.insert(researchProjects).values({ userId, title: "Monitoring-on project" }).returning({ id: researchProjects.id });
      await login(page, monitoringBase);
      await page.goto(`${monitoringBase}/research/${project.id}`);
      await expect(nav(page).getByRole("link", { name: "Monitors" })).toBeVisible();
    } finally {
      monitoringServer?.kill("SIGTERM");
    }
  });
});
