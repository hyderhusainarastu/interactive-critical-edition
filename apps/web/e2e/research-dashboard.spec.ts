import AxeBuilder from "@axe-core/playwright";
import { claimRelationships, db, debateClusters, researchClaims, researchJobRequests, researchProjects, users, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 29.3 reverse-direction lane, Item 2: the zero-LLM dashboard research
 * insight module (`apps/web/src/components/dashboard/ResearchInsightModule.tsx`,
 * `apps/web/src/lib/researchDashboard.ts`). CI-safe — everything here is
 * seeded directly against Postgres, no worker process, no live model call.
 *
 * `#main-content`-scoped locators throughout — the same D-19-36
 * streaming-SSR precedent `research.spec.ts`/`curriculum.spec.ts` already
 * follow (see `docs/PROJECT-LOG.md`).
 */
function main(page: Page) {
  return page.locator("#main-content");
}

const EMAIL = `e2e-research-dashboard-${Date.now()}@example.com`;
const EMPTY_EMAIL = `e2e-research-dashboard-empty-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
let emptyUserId = "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function markOnboarded(id: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, id));
}

/** Same 300ms settle precedent as `research.spec.ts`/`accessibility-sweep.spec.ts`
 *  (D-19-8) — gives `.app-control`/`.app-mount` transitions time to finish
 *  before axe reads computed color/contrast. */
async function scan(page: Page) {
  await page.waitForTimeout(300);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

/**
 * One row of every kind `getResearchInsightCounts` reads, sized so exactly
 * one of each shows up in the rendered module: 1 active project, 1 claim
 * awaiting review, 1 fresh contradiction, 1 active debate cluster, 1
 * running job, 1 failed job.
 */
async function seedResearchInsightFixture(ownerId: string) {
  // A per-call nonce keeps every dedup/idempotency key unique across the
  // multiple times this file calls this helper for the SAME user (the
  // running/failed job idempotency key is partial-uniqued on (userId,
  // idempotencyKey) while in-flight, so reusing a literal string across
  // calls would 23505 on the second seed).
  const tag = crypto.randomUUID();
  const [work] = await db.insert(works).values({ userId: ownerId, title: `Dashboard fixture work ${tag}` }).returning({ id: works.id });
  const [project] = await db.insert(researchProjects).values({ userId: ownerId, title: `Dashboard fixture project ${tag}` }).returning({ id: researchProjects.id });

  const claimBase = {
    userId: ownerId,
    workId: work.id,
    anchorState: "unanchored" as const,
    claimNature: "interpretive" as const,
    confidence: "medium" as const,
    section: "Book VII",
    sourceScope: "sampled" as const,
    supportingExcerpt: "a supporting excerpt",
    promptVersion: "test-v1",
  };
  const [reviewClaim] = await db
    .insert(researchClaims)
    .values({ ...claimBase, claimText: "A claim awaiting review.", contentHash: `e2e-dashboard-review-${tag}` })
    .returning({ id: researchClaims.id });
  const [claimA] = await db
    .insert(researchClaims)
    .values({ ...claimBase, claimText: "Relationship endpoint A.", contentHash: `e2e-dashboard-a-${tag}`, verificationStatus: "user_verified" })
    .returning({ id: researchClaims.id });
  const [claimB] = await db
    .insert(researchClaims)
    .values({ ...claimBase, claimText: "Relationship endpoint B.", contentHash: `e2e-dashboard-b-${tag}`, verificationStatus: "user_verified" })
    .returning({ id: researchClaims.id });

  const [lo, hi] = [claimA.id, claimB.id].sort();
  await db.insert(claimRelationships).values({
    userId: ownerId,
    projectId: project.id,
    claimLoId: lo,
    claimHiId: hi,
    valence: "contradiction",
    category: "theoretical",
    judgeBranch: "humanities",
    strongerSide: "neither",
    explanation: "test explanation",
    resolution: "test resolution",
    engagement: "none_detected",
    basisHash: `e2e-dashboard-relationship-${tag}`,
    promptVersion: "test-v1",
  });

  await db.insert(debateClusters).values({ userId: ownerId, projectId: project.id, name: `Fixture cluster ${tag}`, memberHash: `e2e-dashboard-cluster-${tag}`, status: "active" });

  await db.insert(researchJobRequests).values([
    { userId: ownerId, jobType: "detect_relationships", scope: { projectId: project.id }, idempotencyKey: `e2e-dashboard-running-${tag}`, status: "running" },
    { userId: ownerId, jobType: "detect_relationships", scope: { projectId: project.id }, idempotencyKey: `e2e-dashboard-failed-${tag}`, status: "failed" },
  ]);

  return { workId: work.id, projectId: project.id, reviewClaimId: reviewClaim.id };
}

test.describe("Dashboard research insight module (Phase 29.3)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
    emptyUserId = await createVerifiedTestUser(EMPTY_EMAIL, PASSWORD);
    await markOnboarded(emptyUserId);
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    await deleteTestUser(EMPTY_EMAIL);
  });

  test("renders the seeded counts and links to /research", async ({ page }) => {
    await seedResearchInsightFixture(userId);
    await login(page, EMAIL);

    const insightModule = main(page).locator("[data-research-insight-module]");
    await expect(insightModule).toBeVisible();
    await expect(insightModule.getByRole("heading", { name: "Research activity" })).toBeVisible();
    await expect(insightModule.getByText("Active projects")).toBeVisible();
    await expect(insightModule.getByText("Claims awaiting review")).toBeVisible();
    await expect(insightModule.getByText("New contradictions (7d)")).toBeVisible();
    await expect(insightModule.getByText("Active debates")).toBeVisible();
    await expect(insightModule.getByText("Jobs running")).toBeVisible();
    await expect(insightModule.getByText("Jobs failed")).toBeVisible();
    await expect(insightModule.getByText("New monitor findings")).toBeVisible();

    // Every count seeded above is exactly 1, except "New monitor findings"
    // (Phase 29.1), which this fixture never seeds and so is always 0.
    const values = await insightModule.locator("[data-stat-value]").allTextContents();
    expect(values).toEqual(["1", "1", "1", "1", "1", "1", "0"]);

    await expect(insightModule.getByRole("link", { name: "Open Research →" })).toHaveAttribute("href", "/research");
  });

  test("is absent for an account with zero research activity", async ({ page }) => {
    await login(page, EMPTY_EMAIL);
    await expect(main(page).locator("[data-research-insight-module]")).toHaveCount(0);
  });

  test("is absent when PHASE_25_RESEARCH_ENABLED is off, even with real seeded activity", async ({ page }) => {
    await seedResearchInsightFixture(userId);

    const port = 3112;
    const webRoot = path.resolve(__dirname, "..");
    let server: ChildProcess | undefined;
    try {
      // Same second-built-server pattern as `research.spec.ts`'s flag-off
      // test: an explicitly-set env entry beats the `.env.local` value the
      // app later loads.
      server = spawn(path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), ["start", "-p", String(port)], {
        cwd: webRoot,
        env: { ...process.env, PORT: String(port), PHASE_25_RESEARCH_ENABLED: "false" },
        stdio: "ignore",
      });
      const base = `http://localhost:${port}`;
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
      expect(ready, "second server (flag off) never became ready").toBe(true);

      await page.goto(`${base}/login`);
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/dashboard");
      await expect(main(page).locator("[data-research-insight-module]")).toHaveCount(0);
    } finally {
      server?.kill("SIGTERM");
    }
  });

  test("axe: zero wcag2a/wcag2aa violations with the module visible, light and dark", async ({ page }) => {
    await seedResearchInsightFixture(userId);
    await login(page, EMAIL);
    await expect(main(page).locator("[data-research-insight-module]")).toBeVisible();

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto("/dashboard");
      await expect(main(page).locator("[data-research-insight-module]")).toBeVisible();
      expect((await scan(page)).violations, `/dashboard (${colorScheme})`).toEqual([]);
    }
  });
});
