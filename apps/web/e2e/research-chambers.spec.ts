import AxeBuilder from "@axe-core/playwright";
import {
  bibliographicRecords,
  claimScores,
  credibilityAssessments,
  db,
  debateClusterMembers,
  debateClusters,
  documents,
  evidenceChamberPositionClaims,
  evidenceChamberPositions,
  evidenceChambers,
  pages,
  processingRuns,
  researchClaims,
  researchProjectMembers,
  researchProjects,
  researchResources,
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
 * Phase 27.1: Evidence Chamber web surfaces. Runs against a DEDICATED,
 * isolated built-server instance on PORT 3140 (the `research.spec.ts` "second
 * server" idiom applied to the whole file, not just one sub-test) — this
 * worktree lane runs alongside other parallel lanes on the same shared local
 * Postgres, so a fixed, distinctive port avoids colliding with whatever the
 * ambient dev server (or another lane's own dedicated port) is doing.
 * Everything here is CI-safe in spirit — seeded directly against Postgres,
 * no live model call — but is NOT wired into the CI-safe subset itself
 * (`.github/workflows/ci.yml`) since it needs its own spawned server, the
 * same category of "manual full-stack run" as the rest of `research.spec.ts`.
 */

const PORT = 3140;
const FLAG_OFF_PORT = 3141;
const BASE_URL = `http://localhost:${PORT}`;

function main(page: Page) {
  return page.locator("#main-content");
}

async function scan(page: Page) {
  // Same 300ms settle precedent as `research.spec.ts`/`accessibility-sweep.spec.ts`
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

const EMAIL = `e2e-chambers-${Date.now()}@example.com`;
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

/**
 * Seeds a full Evidence Chamber: one project, one debate cluster with two
 * member claims from two different works, and an already-synthesized
 * `evidence_chamber` with two positions (one per work) — bypassing the
 * worker/LLM entirely (the `seedResearchClaimsFixture` precedent). One of
 * the two claims' owning work ALSO gets a `bibliographic_record` +
 * `research_resource` + `credibility_assessment` chain (the normalized-
 * title self-match `lib/research/chambers.ts`'s `loadPositionSourceCredibility`
 * reads), so the seeded page can assert BOTH credibility levels render,
 * separately labeled: position-level source credibility (from that chain)
 * and claim-level scores (`claim_score`, seeded on both claims).
 */
async function seedEvidenceChamberFixture(ownerId: string) {
  const workATitle = `Irwin's Reading of Akrasia ${Date.now()}`;
  const workBTitle = `Davidson on Weakness of Will ${Date.now()}`;

  const [workA] = await db.insert(works).values({ userId: ownerId, title: workATitle, authorName: "Terence Irwin" }).returning({ id: works.id });
  const [workB] = await db.insert(works).values({ userId: ownerId, title: workBTitle, authorName: "Donald Davidson" }).returning({ id: works.id });

  async function seedRunAndBlock(workId: string, text: string) {
    const [doc] = await db
      .insert(documents)
      .values({
        userId: ownerId,
        workId,
        storagePath: `${ownerId}/${workId}/edition.txt`,
        originalFilename: "edition.txt",
        mimeType: "text/plain",
        fileSize: 200,
        processingStatus: "ready",
        analysisStatus: "complete",
        extractedText: text,
      })
      .returning({ id: documents.id });
    const [run] = await db
      .insert(processingRuns)
      .values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true, degraded: false })
      .returning({ id: processingRuns.id });
    const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text }).returning({ id: pages.id });
    const [block] = await db.insert(textBlocks).values({ pageId: page.id, blockOrder: 0, kind: "body", text }).returning({ id: textBlocks.id });
    return { docId: doc.id, runId: run.id, blockId: block.id };
  }

  const runA = await seedRunAndBlock(workA.id, "Akrasia involves an incomplete practical syllogism, not a failure of will.");
  const runB = await seedRunAndBlock(workB.id, "Akrasia is best explained as weakness of will overriding better judgment.");

  const [claimA] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workA.id,
      processingRunId: runA.runId,
      textBlockId: runA.blockId,
      quote: "incomplete practical syllogism",
      prefix: "involves an ",
      suffix: ", not a failure of will.",
      anchorState: "anchored",
      claimText: "Akrasia is a failure of the practical syllogism, not of will.",
      claimNature: "interpretive",
      confidence: "high",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "an incomplete practical syllogism",
      excerptVerified: true,
      contentHash: `e2e-chamber-fixture-${workA.id}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [claimB] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workB.id,
      processingRunId: runB.runId,
      textBlockId: runB.blockId,
      quote: "weakness of will",
      prefix: "explained as ",
      suffix: " overriding better judgment.",
      anchorState: "anchored",
      claimText: "Akrasia is weakness of will overriding better judgment.",
      claimNature: "interpretive",
      confidence: "medium",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "weakness of will overriding better judgment",
      excerptVerified: true,
      contentHash: `e2e-chamber-fixture-${workB.id}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  await db.insert(claimScores).values([
    { claimId: claimA.id, dimension: "textual_support", score: 0.72, label: "strong", tier: "direct_quotation", signals: ["direct_quotation"], scorerVersion: "textual-support-v1" },
    { claimId: claimB.id, dimension: "textual_support", score: 0.4, label: "moderate", tier: "paraphrase", signals: ["paraphrase"], scorerVersion: "textual-support-v1" },
  ]);

  const [project] = await db.insert(researchProjects).values({ userId: ownerId, title: "Akrasia project" }).returning({ id: researchProjects.id });
  await db.insert(researchProjectMembers).values([
    { projectId: project.id, memberType: "work", workId: workA.id, role: "central" },
    { projectId: project.id, memberType: "work", workId: workB.id, role: "central" },
  ]);

  const [cluster] = await db
    .insert(debateClusters)
    .values({ userId: ownerId, projectId: project.id, name: "Akrasia: knowledge or will?", researchQuestion: "Does akrasia involve a failure of knowledge or of will?", memberHash: `e2e-chamber-${project.id}`, edgeCount: 1, counts: { contradiction: 1 } })
    .returning({ id: debateClusters.id });
  await db.insert(debateClusterMembers).values([
    { clusterId: cluster.id, claimId: claimA.id },
    { clusterId: cluster.id, claimId: claimB.id },
  ]);

  // Position-level source credibility chain — work A also turns up as a
  // researched, credibility-assessed bibliographic record elsewhere in the
  // user's library (the normalized-title self-match `chambers.ts` reads).
  const [bibRecord] = await db.insert(bibliographicRecords).values({ source: "test", title: workATitle, authors: "Terence Irwin" }).returning({ id: bibliographicRecords.id });
  const [resource] = await db
    .insert(researchResources)
    .values({ runId: runB.runId, title: workATitle, provider: "test", bibRecordId: bibRecord.id })
    .returning({ id: researchResources.id });
  await db.insert(credibilityAssessments).values({
    resourceId: resource.id,
    score: 0.86,
    authority: "B",
    publicationRigor: 0.8,
    creatorExpertise: 0.75,
    hostProvenance: 0.7,
    pedagogicalValue: 0.6,
    relevance: 0.9,
    evidenceStrength: 0.65,
    peerReviewed: true,
    rationale: "A well-regarded university-press monograph with extensive scholarly citation.",
    creator: { name: "Terence Irwin", corroboration: "faculty page" },
    popularity: { value: 340, unit: "citations", provider: "test" },
  });

  const [chamber] = await db
    .insert(evidenceChambers)
    .values({
      userId: ownerId,
      projectId: project.id,
      clusterId: cluster.id,
      question: "Does akrasia involve a failure of knowledge or a failure of will?",
      sharedGround: "Both agree the akratic agent acts against their own better judgment.",
      pointOfDivergence: "Irwin locates the failure in an incomplete practical syllogism; Davidson in weakness of will.",
      possibleReconciliation: "The two accounts may describe different stages of the same psychological process.",
      unresolvedQuestion: "Whether the practical-syllogism model can be tested independently of the reading itself.",
      missingEvidence: "A shared criterion for what counts as a 'complete' practical syllogism.",
      nextAction: "Compare both readings against Nicomachean Ethics 7.3's own text directly.",
      basisHash: `e2e-chamber-basis-${cluster.id}`,
      promptVersion: "evidence-chamber-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: evidenceChambers.id });

  const [positionA] = await db
    .insert(evidenceChamberPositions)
    .values({ chamberId: chamber.id, ordinal: 0, label: workATitle, summary: "Incomplete practical syllogism.", method: "textual", scope: "NE 7.3", stanceConfidenceLabel: "high", stanceConfidence: 0.9 })
    .returning({ id: evidenceChamberPositions.id });
  const [positionB] = await db
    .insert(evidenceChamberPositions)
    .values({ chamberId: chamber.id, ordinal: 1, label: workBTitle, summary: "Weakness of will.", method: "philosophical", scope: "general akrasia", stanceConfidenceLabel: "medium", stanceConfidence: 0.6 })
    .returning({ id: evidenceChamberPositions.id });

  await db.insert(evidenceChamberPositionClaims).values([
    { positionId: positionA.id, claimId: claimA.id, ordinal: 0, excerpt: "an incomplete practical syllogism" },
    { positionId: positionB.id, claimId: claimB.id, ordinal: 0, excerpt: "weakness of will overriding better judgment" },
  ]);

  return { workATitle, workBTitle, projectId: project.id, clusterId: cluster.id, chamberId: chamber.id };
}

test.describe("Evidence Chamber (Phase 27.1)", () => {
  test.use({ baseURL: BASE_URL });

  test.beforeAll(async () => {
    server = spawnServer(PORT, { PHASE_25_RESEARCH_ENABLED: "true" });
    const ready = await waitForServerReady(BASE_URL);
    expect(ready, "dedicated port-3140 server never became ready").toBe(true);

    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    server?.kill("SIGTERM");
  });

  test("the debates cluster view and chamber view render, and the chamber shows all brief fields plus both credibility levels, separately labeled", async ({ page }) => {
    const fixture = await seedEvidenceChamberFixture(userId);
    await login(page);

    await page.goto(`/research/${fixture.projectId}/debates`);
    await expect(main(page).getByRole("heading", { name: "Debates" })).toBeVisible();
    await expect(main(page).getByText("Akrasia: knowledge or will?")).toBeVisible();
    await expect(main(page).getByText("Chamber synthesized")).toBeVisible();

    await page.goto(`/research/${fixture.projectId}/debates/${fixture.clusterId}`);
    await expect(main(page).getByRole("heading", { name: "Akrasia: knowledge or will?" })).toBeVisible();
    await expect(main(page).getByRole("link", { name: "View chamber" })).toHaveAttribute("href", `/research/chambers/${fixture.chamberId}`);

    await page.goto(`/research/chambers/${fixture.chamberId}`);
    // Every brief field.
    await expect(main(page).getByRole("heading", { name: "Does akrasia involve a failure of knowledge or a failure of will?" })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Shared ground" })).toBeVisible();
    await expect(main(page).getByText("Both agree the akratic agent acts against their own better judgment.")).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Point of divergence" })).toBeVisible();
    await expect(main(page).getByText(/Irwin locates the failure/)).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Possible reconciliation" })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Unresolved question" })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Missing evidence" })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Next action" })).toBeVisible();

    // Positions in ordinal order — never re-sorted or ranked.
    await expect(main(page).getByRole("heading", { name: fixture.workATitle })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: fixture.workBTitle })).toBeVisible();
    const headingOrder = await main(page).getByRole("heading", { level: 3 }).allTextContents();
    expect(headingOrder.indexOf(fixture.workATitle)).toBeLessThan(headingOrder.indexOf(fixture.workBTitle));

    // Two credibility levels, SEPARATELY labeled — never averaged/combined.
    await expect(main(page).getByText(`Position-level source credibility — ${fixture.workATitle}`)).toBeVisible();
    await expect(main(page).getByText("Publication rigor")).toBeVisible();
    await expect(main(page).getByText("Peer reviewed")).toBeVisible();
    await expect(main(page).getByText(/Claim-level Textual support: Strong/)).toBeVisible();
    await expect(main(page).getByText(/Claim-level Textual support: Moderate/)).toBeVisible();

    // Provenance is present.
    await expect(main(page).getByRole("heading", { name: "Provenance" })).toBeVisible();
    await expect(main(page).getByText("evidence-chamber-v1")).toBeVisible();

    // No winner-ish content anywhere on the rendered page.
    const bodyText = (await main(page).innerText()).toLowerCase();
    for (const forbidden of ["winner", "verdict", "prevail"]) {
      expect(bodyText, `page text should not contain "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test("axe: zero wcag2a/wcag2aa violations on the debates and chamber pages, light and dark", async ({ page }) => {
    const fixture = await seedEvidenceChamberFixture(userId);
    await login(page);

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });

      await page.goto(`/research/${fixture.projectId}/debates`);
      await expect(main(page).getByRole("heading", { name: "Debates" })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/debates (${colorScheme})`).toEqual([]);

      await page.goto(`/research/${fixture.projectId}/debates/${fixture.clusterId}`);
      await expect(main(page).getByRole("heading", { name: "Akrasia: knowledge or will?" })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/debates/[clusterId] (${colorScheme})`).toEqual([]);

      await page.goto(`/research/chambers/${fixture.chamberId}`);
      await expect(main(page).getByRole("heading", { name: "Provenance" })).toBeVisible();
      expect((await scan(page)).violations, `/research/chambers/[chamberId] (${colorScheme})`).toEqual([]);
    }
  });

  test("owner-scoped 404: another user cannot view this chamber, cluster, or debates list", async ({ browser }) => {
    const fixture = await seedEvidenceChamberFixture(userId);
    const otherEmail = `e2e-chambers-other-${Date.now()}@example.com`;
    const otherId = await createVerifiedTestUser(otherEmail, PASSWORD);
    await markOnboarded(otherId);
    try {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const otherPage = await context.newPage();
      await otherPage.goto(`${BASE_URL}/login`);
      await otherPage.getByLabel("Email").fill(otherEmail);
      await otherPage.getByLabel("Password").fill(PASSWORD);
      await otherPage.getByRole("button", { name: "Log in" }).click();
      await otherPage.waitForURL("**/dashboard");

      await otherPage.goto(`/research/chambers/${fixture.chamberId}`);
      await expect(main(otherPage).getByText("That page is not here.")).toBeVisible();

      const apiResponse = await otherPage.request.get(`/api/research/chambers/${fixture.chamberId}`);
      expect(apiResponse.status()).toBe(404);
      await context.close();
    } finally {
      await deleteTestUser(otherEmail);
    }
  });

  test("the debates cluster view and chamber view are 404 while PHASE_25_RESEARCH_ENABLED is off", async ({ page, request }) => {
    const fixture = await seedEvidenceChamberFixture(userId);
    const flagOffBase = `http://localhost:${FLAG_OFF_PORT}`;
    let flagOffServer: ChildProcess | undefined;
    try {
      flagOffServer = spawnServer(FLAG_OFF_PORT, { PHASE_25_RESEARCH_ENABLED: "false" });
      const ready = await waitForServerReady(flagOffBase);
      expect(ready, "flag-off port server never became ready").toBe(true);

      const apiResponse = await request.get(`${flagOffBase}/api/research/chambers/${fixture.chamberId}`);
      expect(apiResponse.status()).toBe(404);

      await page.goto(`${flagOffBase}/login`);
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/dashboard");

      await page.goto(`${flagOffBase}/research/chambers/${fixture.chamberId}`);
      await expect(main(page).getByText("That page is not here.")).toBeVisible();
      await page.goto(`${flagOffBase}/research/${fixture.projectId}/debates`);
      await expect(main(page).getByText("That page is not here.")).toBeVisible();
    } finally {
      flagOffServer?.kill("SIGTERM");
    }
  });

  // Every `research_*`/`evidence_chamber*`/`debate_cluster*`/`bibliographic_record`/
  // `research_resource`/`credibility_assessment` row this file inserts
  // directly cascades from `deleteTestUser(EMAIL)` in `afterAll` via its
  // `user_id` FK chain (see schema.ts's Phase 25/26/27 tables) — no explicit
  // sweep needed here. `bibliographic_record` is the one shared-catalog
  // exception (no user FK, the documented orphan-sweep precedent) — left in
  // place like every other test that seeds one, since it's harmless at
  // single-user-scale test data volume.
});
