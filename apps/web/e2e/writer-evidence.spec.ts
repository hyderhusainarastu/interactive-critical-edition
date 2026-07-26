import AxeBuilder from "@axe-core/playwright";
import {
  bibliographicRecords,
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
  textBlocks,
  users,
  works,
  writerCitations,
  writerDocuments,
  writerProjects,
} from "@ice/db";
import { and, eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 28.5: Writer evidence insertion. Runs against a DEDICATED, isolated
 * built-server instance on PORT 3170 — the `research-chambers.spec.ts`
 * "dedicated port" idiom, since this worktree lane runs alongside other
 * parallel lanes on the same shared local Postgres and
 * `PHASE_25_WRITER_EVIDENCE_ENABLED` is a brand-new flag no ambient dev
 * server has ever been configured with. Everything here is seeded directly
 * against Postgres — no live model call — but is NOT wired into the
 * CI-safe subset, the same category of "manual full-stack run" as the rest
 * of `research-chambers.spec.ts`/`research.spec.ts`.
 */

const PORT = 3170;
const FLAG_OFF_PORT = 3171;
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

const EMAIL = `e2e-writer-evidence-${Date.now()}@example.com`;
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

async function seedRunAndBlock(ownerId: string, workId: string, text: string) {
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
  return { blockId: block.id };
}

/**
 * Seeds: a research project with three claims across two works —
 * `workResolvable` (has a matching, field-rich `bibliographic_record`, so
 * its claims' citations resolve) and `workUnresolvable` (no matching
 * record at all — the honest "no resolvable identity" case); one claim on
 * `workResolvable` is deliberately `anchor_state = 'unanchored'`. A debate
 * cluster (both anchored claims as members) and a synthesized evidence
 * chamber round out the panel's three list sections. Also seeds a private
 * writer project with one document, NOT yet linked to the research
 * project — the link is driven through the UI in the main test.
 */
async function seedFixture(ownerId: string) {
  const suffix = Date.now();
  const resolvableTitle = `Justice as Common Advantage ${suffix}`;
  const unresolvableTitle = `An Obscure Manuscript ${suffix}`;

  const [workResolvable] = await db.insert(works).values({ userId: ownerId, title: resolvableTitle, authorName: "A. Political Philosopher" }).returning({ id: works.id });
  const [workUnresolvable] = await db.insert(works).values({ userId: ownerId, title: unresolvableTitle, authorName: null }).returning({ id: works.id });

  const runResolvable = await seedRunAndBlock(ownerId, workResolvable.id, "Justice is the common advantage among citizens who share a constitution.");
  const runUnresolvable = await seedRunAndBlock(ownerId, workUnresolvable.id, "A passage of uncertain provenance discussing civic virtue.");

  await db.insert(bibliographicRecords).values({ source: "test", title: resolvableTitle, authors: "A. Political Philosopher", year: 1990, doi: "10.1234/justice" });
  // Deliberately NO bibliographic_record for `unresolvableTitle` — the
  // "no resolvable identity" branch this fixture exists to exercise.

  const [claimResolvable] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workResolvable.id,
      textBlockId: runResolvable.blockId,
      quote: "common advantage",
      prefix: "Justice is the ",
      suffix: " among citizens",
      anchorState: "anchored",
      claimText: "Justice is defined as the common advantage among co-citizens.",
      claimNature: "interpretive",
      confidence: "high",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "the common advantage among citizens who share a constitution",
      excerptVerified: true,
      contentHash: `e2e-writer-evidence-resolvable-${workResolvable.id}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [claimUnresolvable] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workUnresolvable.id,
      textBlockId: runUnresolvable.blockId,
      quote: "civic virtue",
      prefix: "discussing ",
      suffix: ".",
      anchorState: "anchored",
      claimText: "The manuscript treats civic virtue as central to its argument.",
      claimNature: "historical",
      confidence: "medium",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "a passage of uncertain provenance discussing civic virtue",
      excerptVerified: true,
      contentHash: `e2e-writer-evidence-unresolvable-${workUnresolvable.id}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [claimUnanchored] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workResolvable.id,
      textBlockId: null,
      anchorState: "unanchored",
      claimText: "A claim whose original passage a reprocess could no longer locate.",
      claimNature: "conceptual",
      confidence: "low",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "a claim that lost its live anchor",
      excerptVerified: false,
      contentHash: `e2e-writer-evidence-unanchored-${workResolvable.id}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [project] = await db.insert(researchProjects).values({ userId: ownerId, title: `Civic virtue project ${suffix}` }).returning({ id: researchProjects.id });
  await db.insert(researchProjectMembers).values([
    { projectId: project.id, memberType: "work", workId: workResolvable.id, role: "central" },
    { projectId: project.id, memberType: "work", workId: workUnresolvable.id, role: "supporting" },
  ]);

  const [cluster] = await db
    .insert(debateClusters)
    .values({ userId: ownerId, projectId: project.id, name: `Justice and virtue debate ${suffix}`, researchQuestion: "Is justice reducible to civic virtue?", memberHash: `e2e-writer-evidence-${project.id}`, edgeCount: 1, counts: { nuance: 1 } })
    .returning({ id: debateClusters.id });
  await db.insert(debateClusterMembers).values([
    { clusterId: cluster.id, claimId: claimResolvable.id },
    { clusterId: cluster.id, claimId: claimUnresolvable.id },
  ]);

  const [chamber] = await db
    .insert(evidenceChambers)
    .values({
      userId: ownerId,
      projectId: project.id,
      clusterId: cluster.id,
      question: `Does justice reduce to civic virtue? ${suffix}`,
      sharedGround: "Both claims treat the constitution as the shared frame.",
      pointOfDivergence: "One reading centers advantage, the other centers virtue.",
      possibleReconciliation: "Civic virtue may just be advantage properly understood.",
      unresolvedQuestion: "Whether advantage and virtue can be independently measured.",
      missingEvidence: "A shared operational definition of 'advantage'.",
      nextAction: "Compare both readings against the constitution's own text.",
      basisHash: `e2e-writer-evidence-basis-${cluster.id}`,
      promptVersion: "evidence-chamber-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: evidenceChambers.id });
  const [position] = await db
    .insert(evidenceChamberPositions)
    .values({ chamberId: chamber.id, ordinal: 0, label: resolvableTitle, summary: "Advantage-centered reading.", method: "textual", scope: "whole work", stanceConfidenceLabel: "high", stanceConfidence: 0.9 })
    .returning({ id: evidenceChamberPositions.id });
  await db.insert(evidenceChamberPositionClaims).values([{ positionId: position.id, claimId: claimResolvable.id, ordinal: 0, excerpt: "the common advantage among citizens who share a constitution" }]);

  const [writerProject] = await db.insert(writerProjects).values({ userId: ownerId, title: `Essay on justice ${suffix}` }).returning({ id: writerProjects.id });
  const [writerDocument] = await db
    .insert(writerDocuments)
    .values({ projectId: writerProject.id, title: "Draft", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "An essay in progress." }] }] }, sortOrder: 0 })
    .returning({ id: writerDocuments.id });

  return {
    projectId: project.id,
    projectTitle: `Civic virtue project ${suffix}`,
    resolvableTitle,
    unresolvableTitle,
    claimResolvableId: claimResolvable.id,
    claimUnresolvableId: claimUnresolvable.id,
    claimUnanchoredId: claimUnanchored.id,
    clusterName: `Justice and virtue debate ${suffix}`,
    chamberQuestion: `Does justice reduce to civic virtue? ${suffix}`,
    writerProjectId: writerProject.id,
    writerDocumentId: writerDocument.id,
  };
}

test.describe("Writer evidence insertion (Phase 28.5)", () => {
  test.use({ baseURL: BASE_URL });

  test.beforeAll(async () => {
    server = spawnServer(PORT, { PHASE_12_WRITER_ENABLED: "true", PHASE_25_WRITER_EVIDENCE_ENABLED: "true" });
    const ready = await waitForServerReady(BASE_URL);
    expect(ready, "dedicated port-3170 server never became ready").toBe(true);

    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    server?.kill("SIGTERM");
  });

  test("links a research project, the panel renders its claims/debates/chambers, insert produces a real blockquote + citation row, and filters actually filter", async ({ page }) => {
    const fixture = await seedFixture(userId);
    await login(page);
    await page.goto(`/writer/${fixture.writerProjectId}`);

    // Not linked yet: the picker, not the claims list.
    await expect(main(page).getByRole("heading", { name: "Research evidence" })).toBeVisible();
    await expect(main(page).getByLabel("Research project to link")).toBeVisible();
    await main(page).getByLabel("Research project to link").selectOption({ label: fixture.projectTitle });
    await main(page).getByRole("button", { name: "Link" }).click();
    await expect(main(page).getByText(fixture.projectTitle)).toBeVisible();

    // Panel renders claims (non-rejected/non-hidden) with the
    // "verifiable-offloading essentials" — excerpt, provenance (work +
    // nature), verification status — plus debates and chambers.
    const resolvableCardBeforeInsert = main(page).locator("li", { hasText: "the common advantage among citizens" });
    await expect(resolvableCardBeforeInsert).toBeVisible();
    await expect(resolvableCardBeforeInsert).toContainText(fixture.resolvableTitle);
    await expect(resolvableCardBeforeInsert).toContainText("interpretive");
    await expect(resolvableCardBeforeInsert).toContainText("unreviewed");
    await expect(main(page).getByRole("link", { name: fixture.clusterName })).toBeVisible();
    await expect(main(page).getByRole("link", { name: fixture.chamberQuestion })).toBeVisible();

    // Filterable by work: selecting the unresolvable work's claims should
    // hide the resolvable claim's excerpt.
    await main(page).getByLabel("Filter evidence by work").selectOption({ label: fixture.unresolvableTitle });
    await expect(main(page).getByText("the common advantage among citizens", { exact: false })).toHaveCount(0);
    await main(page).getByLabel("Filter evidence by work").selectOption({ value: "" });
    await expect(main(page).getByText("the common advantage among citizens", { exact: false })).toBeVisible();

    // Insert the resolvable claim's evidence — scoped to its own list item
    // (not `.first()`) since claim list order is by recency and this
    // fixture's three claims are inserted close enough together that their
    // timestamps aren't a reliable tiebreak.
    const resolvableCard = main(page).locator("li", { hasText: "the common advantage among citizens" });
    await resolvableCard.getByRole("button", { name: "Insert" }).click();
    await expect(main(page).getByLabel("Draft")).toContainText("the common advantage among citizens who share a constitution", { timeout: 10_000 });

    const [savedDocument] = await db.select({ content: writerDocuments.content }).from(writerDocuments).where(eq(writerDocuments.id, fixture.writerDocumentId)).limit(1);
    const blocks = (savedDocument!.content as { content: { type: string; attrs?: Record<string, unknown> }[] }).content;
    const blockquote = blocks.find((block) => block.type === "blockquote");
    expect(blockquote, "the document should contain a real blockquote node").toBeTruthy();
    expect(blockquote!.attrs).toMatchObject({ researchClaimId: fixture.claimResolvableId, excerpt: "the common advantage among citizens who share a constitution", workTitle: fixture.resolvableTitle });

    const linkedCitations = await db.select().from(writerCitations).where(and(eq(writerCitations.projectId, fixture.writerProjectId), eq(writerCitations.researchClaimId, fixture.claimResolvableId)));
    expect(linkedCitations).toHaveLength(1);
    expect((linkedCitations[0]!.cslJson as { title: string }).title).toBe(fixture.resolvableTitle);
  });

  test("a claim with no resolvable bibliographic identity inserts an honest 'citation unresolved' marker and creates no citation row", async ({ page }) => {
    const fixture = await seedFixture(userId);
    await db.insert(researchProjectMembers).values({ projectId: fixture.projectId, memberType: "writer_project", writerProjectId: fixture.writerProjectId, role: "supporting" });
    await login(page);
    await page.goto(`/writer/${fixture.writerProjectId}`);
    await expect(main(page).getByText("a passage of uncertain provenance discussing civic virtue", { exact: false })).toBeVisible();

    const unresolvableCard = main(page).locator("li", { hasText: "An Obscure Manuscript" });
    await unresolvableCard.getByRole("button", { name: "Insert" }).click();
    await expect(main(page).getByLabel("Draft")).toContainText("Citation unresolved", { timeout: 10_000 });

    const [savedDocument] = await db.select({ content: writerDocuments.content }).from(writerDocuments).where(eq(writerDocuments.id, fixture.writerDocumentId)).limit(1);
    const blocks = (savedDocument!.content as { content: { type: string; content?: { text: string }[] }[] }).content;
    const markerText = blocks.flatMap((block) => (block.content ?? []).map((node) => node.text)).join(" ");
    expect(markerText).toContain("Citation unresolved");

    const linkedCitations = await db.select().from(writerCitations).where(and(eq(writerCitations.projectId, fixture.writerProjectId), eq(writerCitations.researchClaimId, fixture.claimUnresolvableId)));
    expect(linkedCitations).toHaveLength(0);
  });

  test("an unanchored claim inserts a 'passage not currently locatable' marker alongside its (resolvable) citation", async ({ page }) => {
    const fixture = await seedFixture(userId);
    await db.insert(researchProjectMembers).values({ projectId: fixture.projectId, memberType: "writer_project", writerProjectId: fixture.writerProjectId, role: "supporting" });
    await login(page);
    await page.goto(`/writer/${fixture.writerProjectId}`);
    await expect(main(page).getByText("a claim that lost its live anchor", { exact: false })).toBeVisible();
    await expect(main(page).getByText("unanchored", { exact: false })).toBeVisible();

    const unanchoredCard = main(page).locator("li", { hasText: "a claim that lost its live anchor" });
    await unanchoredCard.getByRole("button", { name: "Insert" }).click();
    await expect(main(page).getByLabel("Draft")).toContainText("Passage not currently locatable", { timeout: 10_000 });

    const linkedCitations = await db.select().from(writerCitations).where(and(eq(writerCitations.projectId, fixture.writerProjectId), eq(writerCitations.researchClaimId, fixture.claimUnanchoredId)));
    expect(linkedCitations).toHaveLength(1);
  });

  test("axe: zero wcag2a/wcag2aa violations on a writer project with a linked evidence panel, light and dark", async ({ page }) => {
    const fixture = await seedFixture(userId);
    await db.insert(researchProjectMembers).values({ projectId: fixture.projectId, memberType: "writer_project", writerProjectId: fixture.writerProjectId, role: "supporting" });
    await login(page);

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`/writer/${fixture.writerProjectId}`);
      await expect(main(page).getByRole("heading", { name: "Research evidence" })).toBeVisible();
      await expect(main(page).locator("li", { hasText: "the common advantage among citizens" })).toBeVisible();
      expect((await scan(page)).violations, `/writer/[projectId] with a linked evidence panel (${colorScheme})`).toEqual([]);
    }
  });

  test("the Evidence panel is absent, and the evidence/research-link APIs 404, while PHASE_25_WRITER_EVIDENCE_ENABLED is off", async ({ page, request }) => {
    const fixture = await seedFixture(userId);
    const flagOffBase = `http://localhost:${FLAG_OFF_PORT}`;
    let flagOffServer: ChildProcess | undefined;
    try {
      flagOffServer = spawnServer(FLAG_OFF_PORT, { PHASE_12_WRITER_ENABLED: "true", PHASE_25_WRITER_EVIDENCE_ENABLED: "false" });
      const ready = await waitForServerReady(flagOffBase);
      expect(ready, "flag-off port server never became ready").toBe(true);

      const evidenceResponse = await request.get(`${flagOffBase}/api/writer/projects/${fixture.writerProjectId}/evidence`);
      expect(evidenceResponse.status()).toBe(404);
      const linkResponse = await request.get(`${flagOffBase}/api/writer/projects/${fixture.writerProjectId}/research-link`);
      expect(linkResponse.status()).toBe(404);

      await page.goto(`${flagOffBase}/login`);
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/dashboard");

      await page.goto(`${flagOffBase}/writer/${fixture.writerProjectId}`);
      await expect(page.getByLabel("Draft")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Research evidence" })).toHaveCount(0);
    } finally {
      flagOffServer?.kill("SIGTERM");
    }
  });

  // Every `writer_project`/`writer_document`/`writer_citation`/`research_*`/
  // `debate_cluster*`/`evidence_chamber*`/`work`/`document`/`processing_run`/
  // `page`/`text_block` row this file inserts directly cascades from
  // `deleteTestUser(EMAIL)` in `afterAll` via its `user_id` FK chain — the
  // `research-chambers.spec.ts` precedent. `bibliographic_record` is the
  // one shared-catalog exception (no user FK), left in place like every
  // other test that seeds one — harmless at single-user-scale test volume.
});
