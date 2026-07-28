import AxeBuilder from "@axe-core/playwright";
import {
  claimLoci,
  claimRelationships,
  claimScores,
  db,
  documents,
  pages,
  processingRuns,
  researchClaims,
  researchJobRequests,
  researchProjectMembers,
  researchProjectQuestions,
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
 * Next streams an unmounted server segment in a hidden holder near
 * `</body>` while a page is hydrating (D-19-36, documented in
 * docs/PROJECT-LOG.md as a self-healing Next.js/React streaming-SSR
 * artifact) — a transient duplicate can make a bare `page.getByText(...)`
 * match twice. Every real-page assertion in this file is scoped to
 * `#main-content` (the same convention `curriculum.spec.ts`/
 * `canonical-identity.spec.ts` already use) so that hidden holder can never
 * make an assertion flaky.
 */
function main(page: Page) {
  return page.locator("#main-content");
}

/**
 * Phase 28.1: Research workspace web surfaces. Everything here is CI-safe —
 * seeded directly against Postgres (no worker process, no live model/
 * bibliographic call). The one exception is the "Extract claims" dispatch
 * test, which drives the real POST /api/research/projects/:id/jobs route:
 * that only needs pg-boss's own schema (already provisioned on this shared
 * local Postgres — see docs/PROJECT-LOG.md) to accept an enqueue, never a
 * running worker to consume it, so it stays CI-safe too.
 */

const EMAIL = `e2e-research-${Date.now()}@example.com`;
const SECOND_EMAIL = `e2e-research-other-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

async function login(page: Page, email = EMAIL) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/dashboard");
}

async function markOnboarded(id: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, id));
}

/** Same 300ms settle precedent as accessibility-sweep.spec.ts (D-19-8) —
 *  gives `.app-control`/`.app-panel-enter` transitions time to finish
 *  before axe reads computed color/contrast. */
async function scan(page: Page) {
  await page.waitForTimeout(300);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}

/**
 * Seeds one work with a published edition (a real `processing_run` +
 * `text_block`, so `research_claim.text_block_id` anchors to something
 * real) and 3 `research_claim` rows spanning distinct nature/anchor/
 * verification combinations, plus `claim_score`/`claim_locus` rows on the
 * first, and 2 `research_job_request` rows (one complete, one failed) — the
 * full shape the claims table / permalink / insight feed / jobs panel all
 * read from. Bypasses the worker entirely (same CI-safety reasoning as
 * `seedPublishedEdition`).
 */
async function seedResearchClaimsFixture(ownerId: string, workTitle: string) {
  const bodyText = "Vicious people act on decision, yet live according to passion, unlike the merely incontinent.";
  const [work] = await db.insert(works).values({ userId: ownerId, title: workTitle, authorName: "Test Author" }).returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId: ownerId,
      workId: work.id,
      storagePath: `${ownerId}/${work.id}/edition.txt`,
      originalFilename: "edition.txt",
      mimeType: "text/plain",
      fileSize: 200,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: bodyText,
    })
    .returning({ id: documents.id });
  const [run] = await db
    .insert(processingRuns)
    .values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true, degraded: false })
    .returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: bodyText }).returning({ id: pages.id });
  const [bodyBlock] = await db
    .insert(textBlocks)
    .values({ pageId: page.id, blockOrder: 0, kind: "body", text: bodyText })
    .returning({ id: textBlocks.id });

  const [anchoredClaim] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: work.id,
      processingRunId: run.id,
      textBlockId: bodyBlock.id,
      quote: "live according to passion",
      prefix: "yet ",
      suffix: ", unlike",
      anchorState: "anchored",
      claimText: "Vicious agents act on decision while living according to passion.",
      claimNature: "interpretive",
      confidence: "high",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "Vicious people act on decision, yet live according to passion",
      excerptVerified: true,
      contentHash: "e2e-research-fixture-hash-1",
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const [empiricalClaim] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: work.id,
      processingRunId: run.id,
      textBlockId: bodyBlock.id,
      quote: "the merely incontinent",
      prefix: "unlike ",
      suffix: ".",
      anchorState: "anchored",
      claimText: "The vicious agent is distinct from the merely incontinent agent.",
      claimNature: "empirical",
      confidence: "medium",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "unlike the merely incontinent",
      excerptVerified: true,
      contentHash: "e2e-research-fixture-hash-2",
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "user_verified",
    })
    .returning({ id: researchClaims.id });

  // A claim whose anchor was lost by a later reprocess (plan §Pipeline
  // "Reprocess supersession") — never deleted, only marked, and the
  // permalink must NOT offer a jump-to-reader link for this one.
  const [unanchoredClaim] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: work.id,
      processingRunId: null,
      textBlockId: null,
      quote: null,
      prefix: null,
      suffix: null,
      anchorState: "unanchored",
      claimText: "A claim whose original passage no longer matches after reprocessing.",
      claimNature: "historical",
      confidence: "low",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "a passage that no longer matches",
      excerptVerified: false,
      contentHash: "e2e-research-fixture-hash-3",
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "disputed",
    })
    .returning({ id: researchClaims.id });

  await db.insert(claimScores).values([
    { claimId: anchoredClaim.id, dimension: "textual_support", score: 0.72, label: "strong", tier: "direct_quotation", signals: ["direct_quotation", "multiple_loci"], scorerVersion: "textual-support-v1" },
    { claimId: empiricalClaim.id, dimension: "evidence_strength", score: 0.35, label: "weak", tier: "observational", signals: ["hedged_language"], scorerVersion: "evidence-strength-v1" },
  ]);
  await db.insert(claimLoci).values([
    { claimId: anchoredClaim.id, locusKey: "aristotle:nicomachean-ethics:1150b", origin: "excerpt", rawLocus: "1150b19-22" },
  ]);

  await db.insert(researchJobRequests).values([
    {
      userId: ownerId,
      jobType: "extract_claims",
      scope: { workIds: [work.id] },
      idempotencyKey: `e2e-research-complete-${work.id}`,
      status: "complete",
      coverage: "full",
      note: "Extracted 3 claims from 1 chunk.",
      estimatedCostUsd: 0.01,
      actualCostUsd: 0.01,
    },
    {
      userId: ownerId,
      jobType: "extract_claims",
      scope: { workIds: [work.id] },
      idempotencyKey: `e2e-research-failed-${work.id}`,
      status: "failed",
      error: "Simulated extraction failure for testing.",
      estimatedCostUsd: 0.01,
      actualCostUsd: 0,
    },
  ]);

  return { workId: work.id, documentId: doc.id, runId: run.id, bodyBlockId: bodyBlock.id, anchoredClaimId: anchoredClaim.id, unanchoredClaimId: unanchoredClaim.id };
}

async function createProjectViaApi(page: Page, title: string): Promise<string> {
  const response = await page.request.post("/api/research/projects", { data: { title } });
  const body = await response.json();
  return body.project.id as string;
}

test.describe("Research workspace (Phase 28.1)", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
    const otherId = await createVerifiedTestUser(SECOND_EMAIL, PASSWORD);
    await markOnboarded(otherId);
  });
  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    await deleteTestUser(SECOND_EMAIL);
  });

  test("the /research workspace and its API are 404 while PHASE_25_RESEARCH_ENABLED is off", async ({ page, request }) => {
    const port = 3111;
    const webRoot = path.resolve(__dirname, "..");
    let server: ChildProcess | undefined;
    try {
      // Spawn a second built server on its own port with the flag
      // explicitly overridden false — Node's own env-var precedence (an
      // explicitly-set `env` entry beats a `.env.local` value the app later
      // loads) confirmed working by hand against a throwaway port before
      // writing this. `next/dist/bin/next` (not the `.bin/next` shell
      // wrapper) is spawned directly since it carries its own `#!/usr/bin/env
      // node` shebang and is a real JS entry point `spawn()` can exec.
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

      // The API route checks the flag BEFORE authentication (see
      // `requireResearchApiUser`), so an unauthenticated request already
      // proves it, and route handlers set their status directly
      // (`NextResponse.json(..., { status: 404 })`), so the HTTP status
      // itself is a reliable signal here.
      const apiResponse = await request.get(`${base}/api/research/projects`);
      expect(apiResponse.status()).toBe(404);

      // The PAGE route's own flag check runs inside `ResearchPage`, but two
      // things make its HTTP status code an unreliable signal for a real
      // logged-in visit: (1) the shared `(app)/layout.tsx` calls
      // `requireSession()` first for every route in that group, so an
      // unauthenticated visitor never even reaches the flag check; (2) the
      // `(app)` route group has its own `loading.tsx`, which makes the
      // whole subtree stream — Next commits the initial 200 status as soon
      // as the shell starts streaming, before the page's own `notFound()`
      // resolves deeper in that same stream, so even a real, correctly
      // triggered `notFound()` can no longer change the already-sent status
      // code (confirmed by inspecting the raw response: it carries a
      // `NEXT_HTTP_ERROR_FALLBACK;404` digest and the real not-found
      // content, wrapped in an HTTP 200). This is a structural property of
      // every page under `(app)`, not specific to this route. What's
      // actually verifiable — and what the flag is really for — is that a
      // logged-in visitor sees the not-found content instead of the real
      // Research page, which is checked below.
      await page.goto(`${base}/login`);
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("**/dashboard");
      await page.goto(`${base}/research`);
      await expect(main(page).getByText("That page is not here.")).toBeVisible();
      await expect(main(page).getByRole("heading", { name: "Research" })).toHaveCount(0);
    } finally {
      server?.kill("SIGTERM");
    }
  });

  test("creates a project, adds questions and a work member, and dispatches claim extraction", async ({ page }) => {
    const fixture = await seedResearchClaimsFixture(userId, "Dispatch-test work");
    await login(page);
    await page.goto("/research");
    await expect(main(page).getByRole("heading", { name: "Research" })).toBeVisible();

    // Stage 5 §5.1: `window.prompt` replaced by `CreateResearchProjectDialog`
    // — same `getByRole("dialog", ...)` idiom `trash.spec.ts` already uses
    // for `PermanentDeleteDialog`.
    await main(page).getByRole("button", { name: "New project" }).click();
    const createDialog = page.getByRole("dialog", { name: /New research project/i });
    await expect(createDialog).toBeVisible();
    const titleField = createDialog.getByLabel("Project title");
    await expect(titleField).toBeFocused();
    await titleField.fill("Vice and akrasia");
    await createDialog.getByRole("button", { name: "Create" }).click();
    await page.waitForURL("**/research/*");
    await expect(main(page).getByRole("heading", { name: "Vice and akrasia" })).toBeVisible();

    await main(page).getByLabel("New research question").fill("Are vice and akrasia the same psychological state?");
    await main(page).getByRole("button", { name: "Add", exact: true }).click();
    await expect(main(page).getByText("Are vice and akrasia the same psychological state?")).toBeVisible();

    await main(page).getByLabel("Add a work from your Library").selectOption(fixture.workId);
    await main(page).getByLabel("Role").selectOption("central");
    await main(page).getByRole("button", { name: "Add to project" }).click();
    await expect(main(page).getByText("Dispatch-test work")).toBeVisible();

    const extractButton = main(page).getByRole("button", { name: "Extract claims" });
    await expect(extractButton).toBeVisible();
    await extractButton.click();
    await expect(main(page).getByRole("heading", { name: "Research jobs" })).toBeVisible();
    // The two seeded fixture requests already render "Complete"/"Failed" —
    // "Queued" only appears for the request this click just created.
    await expect(main(page).getByText("Queued").first()).toBeVisible({ timeout: 10_000 });

    // D-25-14 seam check: the row this real dispatch just created must carry
    // the CANONICAL `{workId}` scope `@ice/claims`'s `parseExtractClaimsScope`
    // (the worker's own parser) accepts — not the pre-fix `{workIds: [...]}`
    // array shape that silently failed to parse and surfaced a misleading
    // "corpus-item path not implemented" error for an ordinary work
    // extraction. A UI assertion alone ("Queued" renders) proved the ROW got
    // created, but never proved the worker could actually read it back — this
    // is the DB-level half that closes that gap.
    const allExtractRequests = await db.select().from(researchJobRequests).where(eq(researchJobRequests.jobType, "extract_claims"));
    const dispatched = allExtractRequests.find((r) => (r.scope as { workId?: unknown } | null)?.workId === fixture.workId);
    expect(dispatched, "no extract_claims row carries the canonical {workId} scope for the dispatched work").toBeTruthy();
    expect(dispatched!.scope).not.toHaveProperty("workIds");
  });

  // Phase 30 gap-fix lane: the center of the research chain
  // (extract → detect relationships → cluster debates → synthesize) had no
  // web dispatcher for its middle two steps at all — this test drives the
  // real POST /api/research/projects/:id/jobs route for `detect_relationships`,
  // the same CI-safety reasoning as the "Extract claims" dispatch test above
  // (pg-boss's schema accepts the enqueue; nothing requires a running worker
  // to consume it).
  test("dispatches relationship detection once two works have claims, confirming the cost estimate, and disables it before that", async ({ page }) => {
    const fixtureA = await seedResearchClaimsFixture(userId, "Detect work A");
    const fixtureB = await seedResearchClaimsFixture(userId, "Detect work B");
    await login(page);
    const projectId = await createProjectViaApi(page, "Detect relationships project");
    await db.insert(researchProjectMembers).values({ projectId, memberType: "work", workId: fixtureA.workId, role: "central" });

    await page.goto(`/research/${projectId}`);
    await expect(main(page).getByRole("heading", { name: "Detect relationships project" })).toBeVisible();

    const jobsPanel = main(page).getByRole("region", { name: "Research jobs" });
    const detectButton = jobsPanel.getByRole("button", { name: "Detect relationships" });
    await expect(detectButton).toBeVisible();
    await expect(detectButton).toBeDisabled();
    await expect(jobsPanel.getByText("Needs claims from a second work")).toBeVisible();

    // Add a second work with claims — the precondition
    // (`workCountWithClaims >= 2`) is now met and the control unlocks.
    await db.insert(researchProjectMembers).values({ projectId, memberType: "work", workId: fixtureB.workId, role: "supporting" });
    await page.reload();
    await expect(main(page).getByRole("heading", { name: "Detect relationships project" })).toBeVisible();
    await expect(detectButton).toBeEnabled();

    // The worst-case per-run judge cost can't be known before Stage 1 runs
    // (see `dispatchDetectRelationshipsJob`'s own doc comment), so this
    // action always needs explicit confirmation on first dispatch — the
    // same needs_confirmation flow "Extract claims" already exercises above.
    await detectButton.click();
    const confirmButton = jobsPanel.getByRole("button", { name: /Confirm and detect relationships/i });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();
    await expect(jobsPanel.getByText("Queued").first()).toBeVisible({ timeout: 10_000 });

    const rows = await db.select().from(researchJobRequests).where(eq(researchJobRequests.jobType, "detect_relationships"));
    const dispatched = rows.find((r) => (r.scope as { projectId?: unknown } | null)?.projectId === projectId);
    expect(dispatched, "no detect_relationships row carries the canonical {projectId} scope").toBeTruthy();
    expect(dispatched!.scope).toEqual({ projectId });
  });

  // D-25-15 item 3: once a project already has SOME judged relationships
  // (the "Detect relationships" step above is done), a prior run can still
  // have left candidates unjudged (capped away, budget-stopped, or a failed
  // judge call — `detectRelationshipsForProject`'s own doc comment: those
  // are picked back up automatically on the NEXT run). The button must
  // surface that backlog rather than silently reverting to its generic
  // "Detect relationships" label as if nothing were outstanding.
  test("relabels the detect button 'Continue judging (N pairs remaining)' when a prior run left candidates unjudged", async ({ page }) => {
    const fixtureA = await seedResearchClaimsFixture(userId, "Continue-judging work A");
    const fixtureB = await seedResearchClaimsFixture(userId, "Continue-judging work B");
    await login(page);
    const projectId = await createProjectViaApi(page, "Continue judging project");
    await db.insert(researchProjectMembers).values([
      { projectId, memberType: "work", workId: fixtureA.workId, role: "central" },
      { projectId, memberType: "work", workId: fixtureB.workId, role: "supporting" },
    ]);

    // At least one relationship already judged (detectDone === true, so the
    // pipeline stepper itself has moved past "Detect relationships").
    const [loClaimId, hiClaimId] = [fixtureA.anchoredClaimId, fixtureB.anchoredClaimId].sort();
    await db.insert(claimRelationships).values({
      userId,
      projectId,
      claimLoId: loClaimId,
      claimHiId: hiClaimId,
      valence: "contradiction",
      category: "theoretical",
      judgeBranch: "empirical",
      strongerSide: "neither",
      explanation: "Test relationship.",
      resolution: "Test resolution.",
      engagement: "none_detected",
      basisHash: "e2e-continue-judging-basis",
      promptVersion: "test-v1",
      provider: "test",
      model: "test-model",
    });

    // A completed detect_relationships run whose note honestly reports 7
    // candidate pairs still awaiting judgment (the exact `awaitingJudgment=`
    // format `detectRelationshipsForProject` writes).
    await db.insert(researchJobRequests).values({
      userId,
      jobType: "detect_relationships",
      scope: { projectId },
      idempotencyKey: `e2e-continue-judging-${projectId}`,
      status: "complete",
      coverage: "partial",
      note: "channels: dense=4 bm25=3 locus=0 locus_section=0 | candidates: 10 found, 10 kept after cap, 10 newly persisted | judge: judged=3 alreadyJudged=0 failed=0 awaitingJudgment=7 (stopped early: cost budget)",
      estimatedCostUsd: 0.03,
      actualCostUsd: 0.03,
    });

    await page.goto(`/research/${projectId}`);
    await expect(main(page).getByRole("heading", { name: "Continue judging project" })).toBeVisible();

    const jobsPanel = main(page).getByRole("region", { name: "Research jobs" });
    const continueButton = jobsPanel.getByRole("button", { name: "Continue judging (7 pairs remaining)" });
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toBeEnabled();
    await expect(jobsPanel.getByText("7 candidate pairs from a prior run are still awaiting judgment.")).toBeVisible();

    // Clicking it dispatches the SAME "detect_relationships" action (never a
    // distinct job type) — confirming the needs_confirmation prompt queues a
    // second detect_relationships request for this project. The dispatch can
    // legitimately also come back as a `conflict` instead, if this shared
    // test account happens to have a genuinely different detect_relationships/
    // cluster_debates job actively running elsewhere at this exact instant
    // (an environment-timing detail this suite's own doc comment already
    // flags as out of scope — nothing requires a worker to consume a queued
    // job, but nothing prevents one from doing so either); either response
    // proves the button is wired to the real dispatch route, which is this
    // affordance's own correctness, so both are accepted here — only the
    // needs_confirmation path additionally proves out the confirm-and-queue
    // round trip.
    await continueButton.click();
    const confirmButton = jobsPanel.getByRole("button", { name: /Confirm and detect relationships/i });
    const conflictNotice = jobsPanel.getByText("A different judge_scan job is already running.");
    await expect(confirmButton.or(conflictNotice)).toBeVisible();
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
      await expect(jobsPanel.getByText("Queued").first()).toBeVisible({ timeout: 10_000 });

      const rows = await db.select().from(researchJobRequests).where(eq(researchJobRequests.jobType, "detect_relationships"));
      const projectRows = rows.filter((r) => (r.scope as { projectId?: unknown } | null)?.projectId === projectId);
      expect(projectRows.length, "expected the original completed row plus a newly queued one").toBe(2);
    }
  });

  test("dispatches debate clustering once a relationship is judged, and disables it before that", async ({ page }) => {
    const fixture = await seedResearchClaimsFixture(userId, "Cluster work");
    await login(page);
    const projectId = await createProjectViaApi(page, "Cluster debates project");
    await db.insert(researchProjectMembers).values({ projectId, memberType: "work", workId: fixture.workId, role: "central" });

    await page.goto(`/research/${projectId}`);
    await expect(main(page).getByRole("heading", { name: "Cluster debates project" })).toBeVisible();

    const jobsPanel = main(page).getByRole("region", { name: "Research jobs" });
    const clusterButton = jobsPanel.getByRole("button", { name: "Cluster debates" });
    await expect(clusterButton).toBeVisible();
    await expect(clusterButton).toBeDisabled();
    await expect(jobsPanel.getByText("Waiting on relationship detection")).toBeVisible();

    // Seed an already-judged relationship directly — this suite tests
    // dispatch, not the paid judge stage itself (that's
    // `detectRelationships.integration.test.ts`'s job, same split
    // `clusterDebates.integration.test.ts`'s own `seedRelationship` helper
    // makes on the worker side).
    const [claimLoId, claimHiId] = [fixture.anchoredClaimId, fixture.unanchoredClaimId].sort();
    await db.insert(claimRelationships).values({
      userId,
      projectId,
      claimLoId,
      claimHiId,
      valence: "contradiction",
      category: "findings",
      judgeBranch: "empirical",
      strongerSide: "neither",
      explanation: "Test relationship.",
      resolution: "Test resolution.",
      engagement: "none_detected",
      basisHash: crypto.randomUUID(),
      promptVersion: "test-v1",
      provider: "test",
      model: "test-model",
    });

    await page.reload();
    await expect(main(page).getByRole("heading", { name: "Cluster debates project" })).toBeVisible();
    await expect(clusterButton).toBeEnabled();
    // A single judged relationship is nowhere near the auto-approve
    // threshold, so this dispatches immediately with no confirmation step.
    await clusterButton.click();
    await expect(jobsPanel.getByText("Queued").first()).toBeVisible({ timeout: 10_000 });

    const rows = await db.select().from(researchJobRequests).where(eq(researchJobRequests.jobType, "cluster_debates"));
    const dispatched = rows.find((r) => (r.scope as { projectId?: unknown } | null)?.projectId === projectId);
    expect(dispatched, "no cluster_debates row carries the canonical {projectId} scope").toBeTruthy();
    expect(dispatched!.scope).toEqual({ projectId });
  });

  test("archives and restores a project, and does not disclose another user's project", async ({ page, browser }) => {
    await login(page);
    const projectId = await createProjectViaApi(page, "Archivable project");
    await page.goto(`/research/${projectId}`);
    await expect(main(page).getByRole("heading", { name: "Archivable project" })).toBeVisible();

    const archiveResponse = await page.request.delete(`/api/research/projects/${projectId}`);
    expect(archiveResponse.status()).toBe(200);

    await page.goto("/research");
    await expect(main(page).getByText("Archivable project")).not.toBeVisible();
    await main(page).getByRole("button", { name: "Show archived projects" }).click();
    await expect(main(page).getByRole("heading", { name: "Archived projects" })).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Archivable project" })).toBeVisible();
    await main(page).getByRole("button", { name: "Restore project" }).click();
    await expect(main(page).getByRole("link", { name: "Archivable project" })).toBeVisible();

    const other = await browser.newPage();
    await login(other, SECOND_EMAIL);
    const response = await other.request.get(`/api/research/projects/${projectId}`);
    expect(response.status()).toBe(404);
    await other.close();
  });

  test("claims table renders seeded claims and filters wire control to state to output", async ({ page }) => {
    const fixture = await seedResearchClaimsFixture(userId, "Filterable work");
    await login(page);
    const projectId = await createProjectViaApi(page, "Claims filter project");
    await db.insert(researchProjectMembers).values({ projectId, memberType: "work", workId: fixture.workId, role: "central" });

    await page.goto(`/research/${projectId}/claims`);
    await expect(main(page).getByRole("heading", { name: "Claims" })).toBeVisible();
    // Stage 5 §7: the claims list now dual-renders (a `md:block` table plus
    // an `md:hidden` card list carrying the same claim text) — scoped to the
    // table itself, which is the one of the pair actually visible at this
    // (desktop-default) viewport, so a bare `main(page).getByText(...)`
    // no longer resolves ambiguously to both.
    const table = main(page).getByRole("table");
    await expect(table.getByText("Vicious agents act on decision while living according to passion.")).toBeVisible();
    await expect(table.getByText("The vicious agent is distinct from the merely incontinent agent.")).toBeVisible();
    await expect(table.getByText("A claim whose original passage no longer matches after reprocessing.")).toBeVisible();

    await main(page).getByLabel("Nature").selectOption("empirical");
    await expect(table.getByText("The vicious agent is distinct from the merely incontinent agent.")).toBeVisible();
    await expect(table.getByText("Vicious agents act on decision while living according to passion.")).not.toBeVisible();

    await main(page).getByLabel("Nature").selectOption("");
    await main(page).getByLabel("Anchor").selectOption("unanchored");
    await expect(table.getByText("A claim whose original passage no longer matches after reprocessing.")).toBeVisible();
    await expect(table.getByText("Vicious agents act on decision while living according to passion.")).not.toBeVisible();

    await main(page).getByLabel("Anchor").selectOption("");
    await main(page).getByLabel("Verification").selectOption("disputed");
    await expect(table.getByText("A claim whose original passage no longer matches after reprocessing.")).toBeVisible();
    await expect(table.getByText("The vicious agent is distinct from the merely incontinent agent.")).not.toBeVisible();
  });

  test("claim permalink shows excerpt, scores, loci, and a jump-to-reader link only when a real anchor exists", async ({ page }) => {
    const fixture = await seedResearchClaimsFixture(userId, "Permalink work");
    await login(page);
    const projectId = await createProjectViaApi(page, "Permalink project");
    await db.insert(researchProjectMembers).values({ projectId, memberType: "work", workId: fixture.workId, role: "central" });

    await page.goto(`/research/claims/${fixture.anchoredClaimId}`);
    await expect(main(page).getByRole("heading", { name: "Vicious agents act on decision while living according to passion." })).toBeVisible();
    await expect(main(page).getByText("Passage verified")).toBeVisible();
    await expect(main(page).getByText("Vicious people act on decision, yet live according to passion")).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Scores" })).toBeVisible();
    await expect(main(page).getByText(/Textual support: strong/)).toBeVisible();
    await expect(main(page).getByRole("heading", { name: "Loci" })).toBeVisible();
    await expect(main(page).getByText("1150b19-22")).toBeVisible();
    // Passage-to-claim/evidence/map continuity (charter §16 journey 5): the
    // "Open in reader" link carries the exact `#block-<id>` anchor fragment
    // `EditionReader` renders on that block, not just the work's Reader in
    // general — reversible navigation back to the real passage.
    await expect(main(page).getByRole("link", { name: "Open in reader" })).toHaveAttribute("href", `/works/${fixture.workId}/reader#block-${fixture.bodyBlockId}`);
    // Claim → contextual Knowledge Map continuity (same journey): always
    // present regardless of anchor state, since the Map's "claim" context
    // resolves by claim id alone.
    await expect(main(page).getByRole("link", { name: "View in Knowledge Map" })).toHaveAttribute("href", `/graph?ctxKind=claim&ctxId=${fixture.anchoredClaimId}`);

    await page.goto(`/research/claims/${fixture.unanchoredClaimId}`);
    await expect(main(page).getByRole("heading", { name: "A claim whose original passage no longer matches after reprocessing." })).toBeVisible();
    await expect(main(page).getByRole("link", { name: "Open in reader" })).toHaveCount(0);
    await expect(main(page).getByRole("link", { name: "View in Knowledge Map" })).toHaveAttribute("href", `/graph?ctxKind=claim&ctxId=${fixture.unanchoredClaimId}`);
  });

  // Passage-to-claim/evidence/map continuity (charter §16 journey 5),
  // reversible-navigation half: following the claim permalink's "Open in
  // reader" link must land in a working Reader with the exact block
  // present in the DOM, not just a URL that merely resolves.
  test("the claim permalink's 'Open in reader' link lands on the exact anchored passage", async ({ page }) => {
    const fixture = await seedResearchClaimsFixture(userId, "Reversible-nav work");
    await login(page);

    await page.goto(`/research/claims/${fixture.anchoredClaimId}`);
    await main(page).getByRole("link", { name: "Open in reader" }).click();
    await expect(page).toHaveURL(`/works/${fixture.workId}/reader#block-${fixture.bodyBlockId}`);
    await expect(page.locator(`#block-${fixture.bodyBlockId}`)).toBeVisible();
    await expect(page.locator(`#block-${fixture.bodyBlockId}`)).toContainText("Vicious people act on decision, yet live according to passion");
  });

  test("axe: zero wcag2a/wcag2aa violations across the new research pages, light and dark", async ({ page }) => {
    const fixture = await seedResearchClaimsFixture(userId, "Accessibility-sweep work");
    await login(page);
    const projectId = await createProjectViaApi(page, "Accessibility project");
    await db.insert(researchProjectQuestions).values({ projectId, question: "Does the reader form matter?", sortOrder: 0 });
    await db.insert(researchProjectMembers).values({ projectId, memberType: "work", workId: fixture.workId, role: "central" });

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });

      await page.goto("/research");
      await expect(main(page).getByRole("heading", { name: "Research" })).toBeVisible();
      expect((await scan(page)).violations, `/research (${colorScheme})`).toEqual([]);

      await page.goto(`/research/${projectId}`);
      await expect(main(page).getByRole("heading", { name: "Accessibility project" })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId] (${colorScheme})`).toEqual([]);

      await page.goto(`/research/${projectId}/claims`);
      await expect(main(page).getByRole("heading", { name: "Claims" })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/claims (${colorScheme})`).toEqual([]);

      await page.goto(`/research/claims/${fixture.anchoredClaimId}`);
      await expect(main(page).getByRole("heading", { name: "Vicious agents act on decision while living according to passion." })).toBeVisible();
      expect((await scan(page)).violations, `/research/claims/[claimId] (${colorScheme})`).toEqual([]);
    }
  });

  // Every `research_*` row this file inserts directly cascades from
  // `deleteTestUser(EMAIL)` in `afterAll` via its `user_id` FK (see
  // schema.ts's Phase 25 tables) — no explicit sweep needed here.
});
