import AxeBuilder from "@axe-core/playwright";
import { db, researchCorpusItems, researchJobRequests, researchProjectMembers, users } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { auditTouchTargets, createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 30 fix lane: `/research/[projectId]/corpus` — the previously
 * unbuilt half of Phase 28's corpus-import surface (28.1 built
 * projects/claims, 28.2 built the worker/service side only). Own dedicated
 * server on PORT 3195 per this lane's own port assignment, the
 * `research-corrections.spec.ts`/`research-chambers.spec.ts` precedent of a
 * fixed, distinctive port so parallel worktree lanes sharing the same local
 * Postgres never collide.
 *
 * The provider search itself is intercepted at the Playwright page-route
 * level (`page.route("**\/api/research/corpus/search", ...)`) so this spec
 * makes ZERO live calls to Semantic Scholar/OpenAlex/arXiv — the browser
 * never even reaches the real Next.js route handler for that request, so
 * the real `searchCorpusCandidates` fan-out never executes. The "Import"
 * dispatch, by contrast, IS exercised for real against
 * `/api/research/projects/[projectId]/jobs` (a plain DB write + a pg-boss
 * enqueue no worker needs to be running to observe — same pattern
 * `research-hypotheses.spec.ts`'s own dispatch tests use), and is verified
 * by reading the resulting `research_job_request` row back from Postgres.
 */

const PORT = 3195;
const FLAG_OFF_PORT = 3196;
const BASE_URL = `http://localhost:${PORT}`;

function main(page: Page) {
  return page.locator("#main-content");
}

async function scan(page: Page) {
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
  return spawn(path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), ["start", "-p", String(port)], {
    cwd: webRoot,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: "ignore",
  });
}

const EMAIL = `e2e-corpus-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";
let server: ChildProcess | undefined;

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function markOnboarded(id: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, id));
}

async function createProjectViaApi(page: Page, title: string): Promise<string> {
  const response = await page.request.post("/api/research/projects", { data: { title } });
  const body = await response.json();
  return body.project.id as string;
}

/** Seeds an already-imported `research_corpus_item` linked into a project as
 *  a `corpus_item` member — the shape `listCorpusItemsForProject` reads. */
async function seedCorpusItem(ownerId: string, projectId: string, overrides: { title?: string; externalId?: string } = {}) {
  const [item] = await db
    .insert(researchCorpusItems)
    .values({
      userId: ownerId,
      source: "semanticscholar",
      externalId: overrides.externalId ?? `seeded-${crypto.randomUUID()}`,
      dedupKey: `title:${(overrides.title ?? "A Seeded Corpus Item").toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID()}`,
      title: overrides.title ?? "A Seeded Corpus Item",
      authors: ["Seeded Author"],
      year: 2019,
      doi: null,
      url: "https://example.com/seeded-item",
      abstract: "A seeded abstract.",
      venue: "Journal of Seeded Testing",
      raw: {},
    })
    .returning({ id: researchCorpusItems.id });
  await db.insert(researchProjectMembers).values({ projectId, memberType: "corpus_item", corpusItemId: item.id, role: "supporting" });
  return item.id;
}

function mockSearchRoute(page: Page) {
  return page.route("**/api/research/corpus/search", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            source: "semanticscholar",
            externalId: "mock-paper-1",
            dedupKey: "doi:10.9999/mock-paper-1",
            title: "A Mocked Corpus Search Result",
            authors: ["Mock Author One", "Mock Author Two"],
            year: 2023,
            doi: "10.9999/mock-paper-1",
            url: "https://example.com/mock-paper-1",
            abstract: "A mocked abstract.",
            venue: "Journal of Mocked Testing",
          },
        ],
        attempts: [
          { provider: "semanticscholar", status: "queried", queries: ["mock query"], resultCount: 1, inspectionDepth: 1, latencyMs: 5 },
          { provider: "openalex", status: "queried", queries: ["mock query"], resultCount: 0, inspectionDepth: 1, latencyMs: 4 },
          { provider: "arxiv", status: "disabled", queries: [], resultCount: 0, inspectionDepth: 0, latencyMs: 0 },
        ],
      }),
    }),
  );
}

test.describe("Research corpus (Phase 30 fix lane)", () => {
  test.use({ baseURL: BASE_URL });

  test.beforeAll(async () => {
    server = spawnServer(PORT, { PHASE_25_RESEARCH_ENABLED: "true" });
    const ready = await waitForServerReady(BASE_URL);
    expect(ready, "dedicated port-3195 server never became ready").toBe(true);

    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    server?.kill("SIGTERM");
  });

  test("seeded corpus items render on the project's corpus page", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Corpus render project");
    await seedCorpusItem(userId, projectId, { title: "An Already-Imported Corpus Item" });

    await page.goto(`/research/${projectId}/corpus`);
    await expect(main(page).getByRole("heading", { name: "Corpus", exact: true })).toBeVisible();
    await expect(main(page).getByText("An Already-Imported Corpus Item")).toBeVisible();
    await expect(main(page).getByText(/Seeded Author/)).toBeVisible();
  });

  test("an empty project shows an honest empty state", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Corpus empty project");

    await page.goto(`/research/${projectId}/corpus`);
    await expect(main(page).getByText(/No imported references yet/)).toBeVisible();
  });

  test("search (mocked providers) renders results with honest per-provider attempt reporting, and Import dispatches a real job", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Corpus search project");
    await mockSearchRoute(page);

    await page.goto(`/research/${projectId}/corpus`);
    await main(page).getByLabel("Search query").fill("a mocked query");
    await main(page).getByRole("button", { name: "Search", exact: true }).click();

    await expect(main(page).getByText("A Mocked Corpus Search Result")).toBeVisible();
    await expect(main(page).getByText(/Mock Author One, Mock Author Two/)).toBeVisible();
    // Honest per-provider attempt reporting — including the two providers
    // that were consulted but contributed nothing, and one never consulted.
    await expect(main(page).getByText(/Semantic Scholar — queried \(1 result\)/)).toBeVisible();
    await expect(main(page).getByText(/OpenAlex — queried \(0 results\)/)).toBeVisible();
    await expect(main(page).getByText(/arXiv — disabled/)).toBeVisible();

    await main(page).getByRole("button", { name: "Import", exact: true }).click();
    await expect(main(page).getByText(/Import started/)).toBeVisible();
    await expect(main(page).getByText("Import queued")).toBeVisible();

    const [request] = await db
      .select()
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.jobType, "import_corpus")));
    expect(request).toBeTruthy();
    expect(request.status).toBe("queued");
    expect(request.scope).toEqual({ projectId, items: [{ provider: "semanticscholar", externalId: "mock-paper-1" }] });
  });

  test("a search returning zero candidates says so honestly", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Corpus zero-result project");
    await page.route("**/api/research/corpus/search", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [],
          attempts: [
            { provider: "semanticscholar", status: "queried", queries: ["nothing matches this"], resultCount: 0, inspectionDepth: 1, latencyMs: 3 },
          ],
        }),
      }),
    );

    await page.goto(`/research/${projectId}/corpus`);
    await main(page).getByLabel("Search query").fill("nothing matches this");
    await main(page).getByRole("button", { name: "Search", exact: true }).click();
    await expect(main(page).getByText(/No results from Semantic Scholar, OpenAlex, or arXiv/)).toBeVisible();
  });

  test("cost figures are never rendered on the corpus page (Workstream F precedent)", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Corpus no-cost project");
    await seedCorpusItem(userId, projectId, { title: "No Cost Figures Corpus Item" });

    await page.goto(`/research/${projectId}/corpus`);
    const bodyText = (await main(page).innerText()).toLowerCase();
    expect(bodyText).not.toMatch(/\$\d/);
    expect(bodyText).not.toContain("estimated cost");
    expect(bodyText).not.toContain("actual cost");
  });

  // D-25-10: the Phase 30 axe sweep's own touch-target scope named the
  // monitors page and the correction UI; this new page is built to the
  // 44px floor from the start (never regresses to what those needed
  // fixing for), asserted here on both the resting state and with search
  // results mounted (the "only mounts once its own toggle is clicked"
  // precedent — an "Import" button doesn't exist until a search runs).
  test("corpus page controls meet the 44x44 touch-target minimum, with and without search results mounted", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Corpus touch target project");
    await seedCorpusItem(userId, projectId, { title: "Touch Target Corpus Item" });
    await mockSearchRoute(page);

    await page.goto(`/research/${projectId}/corpus`);
    await expect(main(page).getByText("Touch Target Corpus Item")).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);

    await main(page).getByLabel("Search query").fill("touch target query");
    await main(page).getByRole("button", { name: "Search", exact: true }).click();
    await expect(main(page).getByText("A Mocked Corpus Search Result")).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
  });

  test("axe: zero wcag2a/wcag2aa violations on the corpus page, light and dark", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Corpus axe project");
    await seedCorpusItem(userId, projectId, { title: "Axe Coverage Corpus Item" });

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`/research/${projectId}/corpus`);
      await expect(main(page).getByRole("heading", { name: "Corpus", exact: true })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/corpus (${colorScheme})`).toEqual([]);
    }
  });

  test("the corpus page and its search/jobs APIs are 404 while PHASE_25_RESEARCH_ENABLED is off", async ({ page }) => {
    const flagOffBase = `http://localhost:${FLAG_OFF_PORT}`;
    let flagOffServer: ChildProcess | undefined;
    try {
      flagOffServer = spawnServer(FLAG_OFF_PORT, { PHASE_25_RESEARCH_ENABLED: "false" });
      const ready = await waitForServerReady(flagOffBase);
      expect(ready, "flag-off port server never became ready").toBe(true);

      await page.goto(`${flagOffBase}/login`);
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/dashboard");

      const searchResponse = await page.request.post(`${flagOffBase}/api/research/corpus/search`, { data: { query: "anything" } });
      expect(searchResponse.status()).toBe(404);

      await page.goto(`${flagOffBase}/research/nonexistent-project-id/corpus`);
      await expect(main(page).getByText("That page is not here.")).toBeVisible();
    } finally {
      flagOffServer?.kill("SIGTERM");
    }
  });

  // Every `research_corpus_item`/`research_project_member`/`research_job_request`
  // row this file inserts directly cascades from `deleteTestUser(EMAIL)` in
  // `afterAll` via its own `user_id` FK chain — the `research-monitors.spec.ts`/
  // `research-corrections.spec.ts` precedent, applies unchanged here.
});
