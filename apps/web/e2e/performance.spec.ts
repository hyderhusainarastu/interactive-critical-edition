import { expect, test } from "@playwright/test";
import { bibliographicRecords, concepts, db, graphEdges, works } from "@ice/db";
import {
  createVerifiedTestUser,
  deleteTestUser,
  seedOwnedWork,
  seedWorkWithGraphData,
  seedWorkWithLibraryItems,
} from "./helpers";

/**
 * Phase 23.6 (plan §23.6 "Measure:"): documented performance budgets for
 * the scenarios that can be measured cheaply and deterministically — all
 * fixture data is SEEDED directly (same CI-safety precedent as
 * graph.spec.ts/library.spec.ts/roadmap-graph.spec.ts), so there is no
 * live worker/AI-provider cost here and no dependency on GROBID/bibliographic
 * APIs being reachable. Needs the local web app + Postgres running, same as
 * every other seeded spec in this suite.
 *
 * Each test times a *functional* milestone (a landmark element becoming
 * visible, or a request's round trip) rather than raw browser Navigation
 * Timing, matching how the plan phrases the scenarios ("Library search",
 * "Roadmap calculation", "Writer autosave" — user-visible outcomes, not a
 * paint metric). Budgets are deliberately generous — the plan's own words
 * are "prevent severe regressions", not micro-optimize — and are documented
 * inline next to each one; a first real measurement run should tighten them
 * if the observed numbers are dramatically under budget.
 *
 * Explicitly NOT covered here — each needs a live worker and/or a paid
 * external API call, so folding them into this always-seeded, zero-cost
 * spec would either be dishonest (faking the workload) or expensive to run
 * routinely. Budgets and manual run instructions for these are in
 * docs/audits/phase-23-6-performance-resilience.md instead:
 *   - large PDF processing (needs GROBID + a real multi-page PDF)
 *   - reprocess (needs a real prior run to reprocess)
 *   - RAG first token / completion (needs a live AI provider call)
 *   - the "Run:" resilience drills (worker restart, DB reconnection,
 *     provider/Storage outage simulation, backup/restore, concurrent
 *     upload) — operational drills, not routine page-load timings.
 */

const EMAIL = `e2e-perf-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

/** Logged for every measurement so a manual run's terminal output IS the
 *  record of the actual numbers observed, not just a pass/fail. */
function record(scenario: string, elapsedMs: number, budgetMs: number) {
  console.log(`[perf] ${scenario}: ${elapsedMs}ms (budget ${budgetMs}ms)`);
}

/** Same shape as roadmap-graph.spec.ts's own `seedRoadmapTarget` (the
 *  roadmap traversal reads `evidence->>'category'`, not `edge_type` — see
 *  that file's comment) — duplicated locally rather than lifted into
 *  helpers.ts, matching that file's own precedent of a per-spec custom edge
 *  shape rather than widening the shared helper surface. */
async function seedRoadmapTarget(workId: string, title: string, category: string): Promise<void> {
  const [bib] = await db
    .insert(bibliographicRecords)
    .values({ source: "crossref", title, authors: "Aristotle", year: -350, accessStatus: "metadata_only" })
    .returning({ id: bibliographicRecords.id });
  await db.insert(graphEdges).values({
    userId,
    sourceType: "work",
    sourceId: workId,
    targetType: "bibliographic_record",
    targetId: bib.id,
    edgeType: "cites",
    confidence: 0.8,
    evidence: { category },
    createdBy: "system",
  });
}

/** Seeds `count` concept nodes all attached to one work, for the
 *  "large-graph test" (plan §23.6 "Run:") — reuses `seedWorkWithConcepts`'s
 *  own graph_edge shape (work -[presupposes]-> concept), scaled up. */
async function seedManyGraphNodes(workId: string, count: number): Promise<void> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const rows = Array.from({ length: count }, (_, i) => ({
    slug: `perf-concept-${suffix}-${i}`,
    kind: "concept" as const,
    label: `Perf concept ${i}`,
    summary: "Seeded for the Phase 23.6 large-graph timing test.",
  }));
  const inserted = await db.insert(concepts).values(rows).returning({ id: concepts.id });
  await db.insert(graphEdges).values(
    inserted.map((concept) => ({
      userId,
      sourceType: "work" as const,
      sourceId: workId,
      targetType: "concept" as const,
      targetId: concept.id,
      edgeType: "presupposes" as const,
      confidence: 0.7,
      evidence: { role: "seeded", reason: "Phase 23.6 large-graph timing fixture." },
      createdBy: "system" as const,
    })),
  );
}

test.describe("Performance budgets (Phase 23.6)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("landing page reaches its hero heading within budget", async ({ page }) => {
    // Public page, no auth/seed needed. Generous for a local dev-server
    // cold compile; tighten once measured against a production build.
    const BUDGET_MS = 4000;
    const start = Date.now();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const elapsed = Date.now() - start;
    record("landing initial render", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("Library search narrows results within budget", async ({ page }) => {
    const BUDGET_MS = 2500; // 300ms client debounce + server round trip + render
    await seedWorkWithLibraryItems(userId, "Perf Library Work", [
      { resourceTitle: "The Structure of Scientific Revolutions", relationship: "historical_context" },
      { resourceTitle: "An Essay Concerning Human Understanding", relationship: "prerequisite" },
    ]);

    await login(page);
    await page.goto("/library");
    const content = page.locator("#main-content");
    await expect(content.getByRole("listitem").first()).toBeVisible();

    const start = Date.now();
    await content.getByLabel("Search library").fill("Scientific Revolutions");
    await expect(content.getByRole("listitem").filter({ hasText: "Scientific Revolutions" })).toBeVisible();
    await expect(content.getByRole("listitem").filter({ hasText: "Human Understanding" })).toHaveCount(0);
    const elapsed = Date.now() - start;
    record("Library search narrow", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("Library search stays within budget with 50 seeded items (large-Library query test)", async ({ page }) => {
    const BUDGET_MS = 3500; // same round trip, more rows to filter/render
    const items = Array.from({ length: 50 }, (_, i) => ({
      resourceTitle: `Perf Library Item ${i} — Scaling Fixture`,
      relationship: "optional_extension" as const,
    }));
    await seedWorkWithLibraryItems(userId, "Perf Large Library Work", items);

    await login(page);
    const start = Date.now();
    await page.goto("/library");
    const content = page.locator("#main-content");
    await expect(content.getByRole("listitem").first()).toBeVisible();
    const elapsed = Date.now() - start;
    record("Library render (50 items)", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("Reader reaches its first paragraph within budget", async ({ page }) => {
    const BUDGET_MS = 4000;
    const { workId } = await seedOwnedWork(userId);

    await login(page);
    const start = Date.now();
    await page.goto(`/works/${workId}/reader`);
    await expect(page.locator('[data-paragraph-index="0"]')).toBeVisible();
    const elapsed = Date.now() - start;
    record("Reader initial render", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("Roadmap calculation completes within budget", async ({ page }) => {
    const BUDGET_MS = 3500; // recursive-CTE traversal + pure ranking + render
    const { workId } = await seedWorkWithGraphData(userId, { title: "Perf Roadmap Work" });
    await seedRoadmapTarget(workId, "Perf Target: Prerequisite Work", "prerequisite");
    await seedRoadmapTarget(workId, "Perf Target: Explicit Reference", "explicit_reference");
    await seedRoadmapTarget(workId, "Perf Target: Historical Context", "historical_context");
    await seedRoadmapTarget(workId, "Perf Target: Interpretive Aid", "interpretive_aid");

    await login(page);
    const start = Date.now();
    await page.goto(`/works/${workId}/roadmap`);
    await expect(page.getByRole("heading", { name: "Reading roadmap" })).toBeVisible();
    await expect(page.locator("[data-roadmap-item]").first()).toBeVisible();
    const elapsed = Date.now() - start;
    record("Roadmap calculation", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("Visualization builds, renders, filters, and re-focuses within budget", async ({ page }) => {
    const BUILD_BUDGET_MS = 5000; // WebGL/three.js is the heaviest client bundle in the app
    const FILTER_BUDGET_MS = 2000;
    const FOCUS_BUDGET_MS = 2000;
    const { workId } = await seedWorkWithGraphData(userId, { title: "Perf Graph Work", withPublicSources: true });

    await login(page);
    const buildStart = Date.now();
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    const buildElapsed = Date.now() - buildStart;
    record("Visualization build/render", buildElapsed, BUILD_BUDGET_MS);
    expect(buildElapsed).toBeLessThan(BUILD_BUDGET_MS);

    const filterStart = Date.now();
    await page.getByLabel("Kind").selectOption("concept");
    await expect(page.getByLabel("Kind")).toHaveValue("concept");
    const filterElapsed = Date.now() - filterStart;
    record("Visualization filter", filterElapsed, FILTER_BUDGET_MS);
    expect(filterElapsed).toBeLessThan(FILTER_BUDGET_MS);

    await page.getByLabel("Kind").selectOption("all");
    const focusGroup = page.getByRole("group", { name: "Focus mode" });
    const focusStart = Date.now();
    await focusGroup.getByRole("button", { name: "Full graph" }).click();
    await expect(focusGroup.getByRole("button", { name: "Full graph" })).toHaveAttribute("aria-pressed", "true");
    const focusElapsed = Date.now() - focusStart;
    record("Visualization focus mode change", focusElapsed, FOCUS_BUDGET_MS);
    expect(focusElapsed).toBeLessThan(FOCUS_BUDGET_MS);
  });

  test("Visualization stays within budget with 40 seeded nodes (large-graph test)", async ({ page }) => {
    const BUDGET_MS = 6000;
    const { workId } = await seedWorkWithGraphData(userId, { title: "Perf Large Graph Work" });
    await seedManyGraphNodes(workId, 40);

    await login(page);
    const start = Date.now();
    await page.goto(`/works/${workId}/graph?layout=explore`);
    await expect(page.getByRole("heading", { name: "Visualization" })).toBeVisible();
    await expect(page.getByText(/\d+ of \d+ shown/)).toBeVisible();
    const elapsed = Date.now() - start;
    record("Visualization render (40+ nodes)", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("Writer autosave completes within budget", async ({ page }) => {
    // The debounce itself is 750ms (WriterEditor.tsx) plus a PATCH round
    // trip — budgeted at 2.5s total from last keystroke to "Saved".
    const BUDGET_MS = 2500;
    await login(page);
    await page.goto("/writer");
    await expect(page.getByRole("heading", { name: "Writer" })).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept("Perf autosave draft"));
    await page.getByRole("button", { name: "New project" }).click();
    await page.waitForURL("**/writer/*");
    const draft = page.getByLabel("Draft").last();

    const start = Date.now();
    await draft.fill("Timed autosave content for the Phase 23.6 budget.");
    await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 10_000 });
    const elapsed = Date.now() - start;
    record("Writer autosave", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("Trash permanent-delete cleanup completes within budget", async ({ page }) => {
    const BUDGET_MS = 2000;
    const [work] = await db
      .insert(works)
      .values({ userId, title: "Perf Purge Work", deletedAt: new Date() })
      .returning({ id: works.id });

    await login(page);
    const start = Date.now();
    const response = await page.request.post(`/api/works/${work.id}/purge`);
    const elapsed = Date.now() - start;
    // The route returns HTTP 200 for every outcome, including
    // storage_failed/failed (the body is the contract, not the status —
    // see purge/route.ts) — response.ok() alone would pass even on a
    // reported failure, so assert the parsed body's actual outcome.
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.outcome).toBe("completed");
    record("Trash permanent-delete cleanup", elapsed, BUDGET_MS);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
