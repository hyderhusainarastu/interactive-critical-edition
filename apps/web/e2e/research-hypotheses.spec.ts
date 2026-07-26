import AxeBuilder from "@axe-core/playwright";
import {
  claimRelationships,
  db,
  debateClusters,
  documents,
  pages,
  processingRuns,
  researchClaims,
  researchGaps,
  researchHypotheses,
  researchHypothesisSources,
  researchHypothesisSupport,
  researchProjectMembers,
  textBlocks,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 27.2: hypotheses + research gaps web surfaces. CI-safe — seeded
 * directly against Postgres (no worker process, no live model call), the
 * `research.spec.ts` precedent. The "Generate hypotheses" dispatch test
 * drives the real POST /api/research/projects/:id/jobs route: only pg-boss's
 * own schema is needed to accept an enqueue, never a running worker to
 * consume it, so it stays CI-safe too. Run on its own dedicated port (3145)
 * per this lane's own port assignment, distinct from `research.spec.ts`'s
 * 3111 — both spin up a second built server for the flag-off case, and this
 * suite is kept independently portable rather than assumed to share a port
 * with a file it doesn't otherwise depend on.
 */

function main(page: Page) {
  return page.locator("#main-content");
}

const PORT = 3145;
const EMAIL = `e2e-hypotheses-${Date.now()}@example.com`;
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

/**
 * Seeds a full hypothesis+gap fixture bypassing both the worker and any
 * LLM/embedding call: two works, two claims, one judged contradiction
 * relationship, one debate cluster over it, one hypothesis citing that
 * relationship (with a computed novelty tier) plus its support row, and one
 * gap derived from the same cluster — everything the hypotheses page reads.
 */
async function seedHypothesesFixture(ownerId: string, projectId: string, suffix: string) {
  const [workA] = await db.insert(works).values({ userId: ownerId, title: `Work A ${suffix}`, authorName: "Author A" }).returning({ id: works.id });
  const [workB] = await db.insert(works).values({ userId: ownerId, title: `Work B ${suffix}`, authorName: "Author B" }).returning({ id: works.id });
  await db.insert(researchProjectMembers).values([
    { projectId, memberType: "work", workId: workA.id, role: "central" },
    { projectId, memberType: "work", workId: workB.id, role: "central" },
  ]);

  const bodyText = "Akrasia involves a failure of knowledge, not desire.";
  const [doc] = await db
    .insert(documents)
    .values({ userId: ownerId, workId: workA.id, storagePath: `${ownerId}/${workA.id}/e.txt`, originalFilename: "e.txt", mimeType: "text/plain", fileSize: 100, processingStatus: "ready", analysisStatus: "complete", extractedText: bodyText })
    .returning({ id: documents.id });
  const [run] = await db.insert(processingRuns).values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true, degraded: false }).returning({ id: processingRuns.id });
  const [page1] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: bodyText }).returning({ id: pages.id });
  const [block] = await db.insert(textBlocks).values({ pageId: page1.id, blockOrder: 0, kind: "body", text: bodyText }).returning({ id: textBlocks.id });

  const [claimA] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workA.id,
      processingRunId: run.id,
      textBlockId: block.id,
      quote: "failure of knowledge",
      prefix: "a ",
      suffix: ", not",
      anchorState: "anchored",
      claimText: "Akrasia is a failure of knowledge.",
      claimNature: "interpretive",
      confidence: "high",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "Akrasia involves a failure of knowledge",
      excerptVerified: true,
      contentHash: `hyp-fixture-a-${suffix}`,
      promptVersion: "claim-extraction-v1",
    })
    .returning({ id: researchClaims.id });
  const [claimB] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workB.id,
      anchorState: "unanchored",
      claimText: "Akrasia is a failure of desire, not knowledge.",
      claimNature: "interpretive",
      confidence: "medium",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "a failure of desire",
      excerptVerified: false,
      contentHash: `hyp-fixture-b-${suffix}`,
      promptVersion: "claim-extraction-v1",
    })
    .returning({ id: researchClaims.id });

  const [claimLoId, claimHiId] = [claimA.id, claimB.id].sort();
  const [relationship] = await db
    .insert(claimRelationships)
    .values({
      userId: ownerId,
      projectId,
      claimLoId,
      claimHiId,
      valence: "contradiction",
      category: "theoretical",
      judgeBranch: "empirical",
      strongerSide: "neither",
      explanation: "The two works disagree on whether akrasia is a cognitive or motivational failure.",
      resolution: "Compare Aristotle's own usage of phronesis across both readings.",
      engagement: "none_detected",
      basisHash: `hyp-fixture-basis-${suffix}`,
      promptVersion: "judge-v3-baseline-reasoning-schema",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: claimRelationships.id });

  const [cluster] = await db
    .insert(debateClusters)
    .values({
      userId: ownerId,
      projectId,
      name: `Akrasia Debate ${suffix}`,
      researchQuestion: "Does the akratic agent know what they are doing?",
      memberHash: `hyp-fixture-member-hash-${suffix}`,
      edgeCount: 1,
      counts: { contradiction: 1, support: 0, nuance: 0 },
      status: "active",
    })
    .returning({ id: debateClusters.id });

  const [hypothesis] = await db
    .insert(researchHypotheses)
    .values({
      userId: ownerId,
      projectId,
      question: null,
      statement: "Practical wisdom mediates between conflicting accounts of virtuous action.",
      rationale: "Both readings converge once virtue is understood as context-sensitive judgment rather than a fixed faculty.",
      methodology: "Compare Aristotle's usage of phronesis across both texts' treatments of akrasia.",
      challenges: ["Requires reconciling divergent translations of key terms."],
      grounding: "detected_conflicts",
      noveltyDistance: 0.83,
      noveltyTier: "high",
      noveltyEmbeddingModel: "text-embedding-3-small",
      noveltyCorpus: "project_claims:2",
      runHash: `hyp-fixture-run-hash-${suffix}`,
      promptVersion: "hypothesis-v1",
      provider: "openai",
      model: "gpt-5.4-nano",
    })
    .returning({ id: researchHypotheses.id });
  await db.insert(researchHypothesisSources).values({ hypothesisId: hypothesis.id, claimRelationshipId: relationship.id });
  await db.insert(researchHypothesisSupport).values([
    { hypothesisId: hypothesis.id, workId: workA.id, corpusItemId: null },
    { hypothesisId: hypothesis.id, workId: workB.id, corpusItemId: null },
  ]);

  const [gap] = await db
    .insert(researchGaps)
    .values({
      userId: ownerId,
      projectId,
      debateClusterId: cluster.id,
      description: `"Akrasia Debate ${suffix}" contains 1 unresolved contradiction with no reconciling account yet recorded — the open question is: Does the akratic agent know what they are doing?`,
      unresolvedContradictionCount: 1,
    })
    .returning({ id: researchGaps.id });

  return { workA, workB, hypothesisId: hypothesis.id, gapId: gap.id };
}

test.describe("Research hypotheses & gaps (Phase 27.2)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("hypotheses page renders statement/rationale/methodology/challenges, cited conflicts, novelty chip, and the gaps list", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Hypotheses render project");
    await seedHypothesesFixture(userId, projectId, "render");

    await page.goto(`/research/${projectId}/hypotheses`);
    await expect(main(page).getByRole("heading", { name: "Hypotheses & gaps" })).toBeVisible();
    await expect(main(page).getByText("Practical wisdom mediates between conflicting accounts of virtuous action.")).toBeVisible();
    await expect(main(page).getByText(/Both readings converge/)).toBeVisible();
    await expect(main(page).getByText(/Compare Aristotle's usage of phronesis/)).toBeVisible();
    await expect(main(page).getByText("Requires reconciling divergent translations of key terms.")).toBeVisible();
    await expect(main(page).getByText("High novelty")).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Contradiction · theoretical" })).toBeVisible();
    await expect(main(page).getByText(/Draws on: Work A render, Work B render/)).toBeVisible();

    await expect(main(page).getByRole("heading", { name: "Open gaps" })).toBeVisible();
    await expect(main(page).getByText(/unresolved contradiction with no reconciling account/)).toBeVisible();
    await expect(main(page).getByText(/From debate: Akrasia Debate render/)).toBeVisible();
  });

  test("an empty project shows honest empty states for both hypotheses and gaps", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Empty hypotheses project");

    await page.goto(`/research/${projectId}/hypotheses`);
    await expect(main(page).getByText(/No hypotheses yet/)).toBeVisible();
    await expect(main(page).getByText("No open gaps recorded yet.")).toBeVisible();
  });

  test("dispatches a generate_hypotheses job via the real API route (no worker needed to accept the enqueue)", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Dispatch hypotheses project");
    await seedHypothesesFixture(userId, projectId, "dispatch");

    await page.goto(`/research/${projectId}/hypotheses`);
    await main(page).getByLabel("Research question (optional)").fill("Is akrasia possible?");
    await main(page).getByRole("button", { name: "Generate hypotheses" }).click();
    await expect(main(page).getByText(/Hypothesis generation started/)).toBeVisible({ timeout: 10_000 });
  });

  test("cost figures are never rendered on the hypotheses page (Workstream F)", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "No cost figures project");
    await seedHypothesesFixture(userId, projectId, "nocost");

    await page.goto(`/research/${projectId}/hypotheses`);
    const bodyText = (await main(page).innerText()).toLowerCase();
    expect(bodyText).not.toMatch(/\$\d/);
    expect(bodyText).not.toContain("estimated cost");
    expect(bodyText).not.toContain("actual cost");
  });

  test("the hypotheses page and its API are 404 while PHASE_25_RESEARCH_ENABLED is off", async ({ page, request }) => {
    const webRoot = path.resolve(__dirname, "..");
    let server: ChildProcess | undefined;
    try {
      server = spawn(path.join(webRoot, "node_modules", "next", "dist", "bin", "next"), ["start", "-p", String(PORT)], {
        cwd: webRoot,
        env: { ...process.env, PORT: String(PORT), PHASE_25_RESEARCH_ENABLED: "false" },
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
      expect(ready, "second server (flag off) never became ready").toBe(true);

      const apiResponse = await request.get(`${base}/api/research/projects/00000000-0000-0000-0000-000000000000/hypotheses`);
      expect(apiResponse.status()).toBe(404);

      await login(page, base);
      await page.goto(`${base}/research/00000000-0000-0000-0000-000000000000/hypotheses`);
      await expect(main(page).getByText("That page is not here.")).toBeVisible();
      await expect(main(page).getByRole("heading", { name: "Hypotheses & gaps" })).toHaveCount(0);
    } finally {
      server?.kill("SIGTERM");
    }
  });

  test("axe: zero wcag2a/wcag2aa violations on the hypotheses page, light and dark", async ({ page }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Accessibility hypotheses project");
    await seedHypothesesFixture(userId, projectId, "axe");

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`/research/${projectId}/hypotheses`);
      await expect(main(page).getByRole("heading", { name: "Hypotheses & gaps" })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/hypotheses (${colorScheme})`).toEqual([]);
    }
  });

  // Every `research_*` row this file inserts directly cascades from
  // `deleteTestUser(EMAIL)` in `afterAll` via its `user_id` FK.
});
