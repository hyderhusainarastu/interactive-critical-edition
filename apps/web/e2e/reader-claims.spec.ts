import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { aiUsageLogs, claimScores, db, researchClaims } from "@ice/db";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "./helpers";

/**
 * Phase 28.3 E2E: the reader's Claims tab and in-text claim markers, behind
 * `readerClaimLayer`. `research_claim`/`claim_score` rows are SEEDED
 * directly (same CI-safety reasoning as `edition.spec.ts`/`rag.spec.ts` —
 * no worker, no live model call); `seedPublishedEdition`'s body block text
 * ("Vicious people act on decision, yet live according to passion. Vice
 * remains a state on which one decides.") supplies the real substrings the
 * three claim fixtures below anchor to.
 *
 * Two `describe` blocks, gated OPPOSITE ways (the `rag.spec.ts` precedent
 * for a local-only Phase 25 gate, applied to both branches this time): the
 * first covers the flag-ON behavior — Claims tab content, marker rendering
 * (solid vs. dashed vs. sidebar-only), click-to-open, and axe — and only
 * runs when `PHASE_25_READER_CLAIM_LAYER_ENABLED=true`; the second proves
 * the flag-OFF posture (no tab, no marker, API 404) and only runs when the
 * flag is unset/false. A single server process's env is fixed at boot, so
 * exercising both branches for real means running this file twice against
 * two differently-configured builds — each run correctly skips the other
 * block rather than failing.
 */

const EMAIL = `reader-claims-${Date.now()}@example.com`;
const PASSWORD = "Test-Password-1";

test.describe("Reader Claims tab (Phase 28.3)", () => {
  test.skip(process.env.PHASE_25_READER_CLAIM_LAYER_ENABLED !== "true", "requires the local-only Phase 25 readerClaimLayer gate");

  let workId = "";
  let anchoredClaimId = "";
  let matchedClaimId = "";
  let unmatchedClaimId = "";

  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    const seeded = await seedPublishedEdition(userId);
    workId = seeded.workId;

    const [anchored] = await db
      .insert(researchClaims)
      .values({
        userId,
        workId,
        processingRunId: seeded.runId,
        textBlockId: seeded.bodyBlockId,
        quote: "Vice remains a state on which one decides.",
        prefix: "",
        suffix: "",
        anchorState: "anchored",
        claimText: "Vice is a settled disposition arrived at by decision, not mere habituation.",
        claimNature: "interpretive",
        confidence: "high",
        section: "Introduction",
        sourceScope: "full_text",
        supportingExcerpt: "Vice remains a state on which one decides.",
        contentHash: "e2e-seed-anchored-claim",
        promptVersion: "v1-seed",
        verificationStatus: "user_verified",
      })
      .returning({ id: researchClaims.id });
    anchoredClaimId = anchored.id;

    await db.insert(claimScores).values({
      claimId: anchoredClaimId,
      dimension: "textual_support",
      score: 0.82,
      label: "strong",
      tier: "direct-quotation",
      signals: ["quoted passage", "explicit textual marker"],
      scorerVersion: "e2e-seed",
    });

    // Only this claim's run gets a claim_extraction usage row — proves the
    // "model" provenance fact is real-fact-or-null, not fabricated per row.
    await db.insert(aiUsageLogs).values({
      runId: seeded.runId,
      documentId: seeded.documentId,
      task: "claim_extraction",
      stage: "extracting-claims",
      provider: "openai",
      model: "gpt-5.4-nano",
      promptTokens: 900,
      completionTokens: 120,
      estimatedCostUsd: 0.004,
    });

    const [matched] = await db
      .insert(researchClaims)
      .values({
        userId,
        workId,
        // null, not seeded.runId: proves the "model" provenance fact is
        // real-fact-or-null per claim, not copied from a sibling claim's
        // run just because they share a work (no ai_usage_log row exists
        // for this claim's run, unlike the anchored claim's below).
        processingRunId: null,
        textBlockId: null,
        quote: "live according to passion",
        prefix: "",
        suffix: "",
        anchorState: "unanchored",
        claimText: "The vicious agent's conduct tracks passion even though it originates in decision.",
        claimNature: "textual",
        confidence: "medium",
        section: "Introduction",
        sourceScope: "full_text",
        supportingExcerpt: "live according to passion",
        contentHash: "e2e-seed-matched-claim",
        promptVersion: "v1-seed",
      })
      .returning({ id: researchClaims.id });
    matchedClaimId = matched.id;

    const [unmatched] = await db
      .insert(researchClaims)
      .values({
        userId,
        workId,
        processingRunId: null,
        textBlockId: null,
        quote: "a phrase this fixture never actually contains anywhere",
        prefix: "",
        suffix: "",
        anchorState: "unanchored",
        claimText: "A claim whose anchor could not be relocated after a reprocess.",
        claimNature: "conceptual",
        confidence: "low",
        section: "Introduction",
        sourceScope: "full_text",
        supportingExcerpt: "a phrase this fixture never actually contains anywhere",
        contentHash: "e2e-seed-unmatched-claim",
        promptVersion: "v1-seed",
      })
      .returning({ id: researchClaims.id });
    unmatchedClaimId = unmatched.id;
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto(`/works/${workId}/reader`);
    await expect(page.getByRole("region", { name: /interactive reader.*processed text/i })).toBeVisible();
  });

  test("the Claims tab lists anchored, re-matched, and unmatched claims with nature/confidence/verification/scores/provenance", async ({ page }) => {
    await page.getByRole("button", { name: /^Claims/i }).click();
    const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });

    await expect(sidebar.getByText(/Vice is a settled disposition/i)).toBeVisible();
    await expect(sidebar.getByText(/vicious agent's conduct tracks passion/i)).toBeVisible();
    await expect(sidebar.getByText(/anchor could not be relocated/i)).toBeVisible();

    const anchoredCard = sidebar.locator(`[data-claim-card="${anchoredClaimId}"]`);
    await expect(anchoredCard).toContainText(/Interpretive/);
    await expect(anchoredCard).toContainText(/High confidence/i);
    await expect(anchoredCard).toContainText(/Verified by you/i);

    const matchedCard = sidebar.locator(`[data-claim-card="${matchedClaimId}"]`);
    await expect(matchedCard).toContainText(/re-matched/i);
    const unmatchedCard = sidebar.locator(`[data-claim-card="${unmatchedClaimId}"]`);
    await expect(unmatchedCard).toContainText(/unanchored/i);
    await expect(unmatchedCard).not.toContainText(/re-matched/i);

    // Dimension-labeled score chip; the signals behind it are progressive
    // disclosure, not shown until the chip is expanded (never a per-position
    // aggregate — each dimension stands on its own).
    const scoreChip = anchoredCard.getByRole("button", { name: /Textual support: strong/i });
    await expect(scoreChip).toBeVisible();
    await expect(anchoredCard.getByText("quoted passage")).not.toBeVisible();
    await scoreChip.click();
    await expect(anchoredCard.getByText("quoted passage")).toBeVisible();
    await expect(anchoredCard.getByText("explicit textual marker")).toBeVisible();

    // Evidence excerpt + provenance (real model fact from the run's own
    // ai_usage_log row, plus the prompt version).
    await anchoredCard.getByRole("button", { name: /evidence and details/i }).click();
    await expect(anchoredCard).toContainText("Vice remains a state on which one decides.");
    await expect(anchoredCard).toContainText(/gpt-5\.4-nano/i);
    await expect(anchoredCard).toContainText(/prompt v1-seed/i);
    await expect(anchoredCard).toContainText(/full text/i);

    // Unanchored claims carry no usage-log-backed run fact here (none was
    // seeded for them) — provenance honestly omits a model name rather than
    // guessing one.
    await matchedCard.getByRole("button", { name: /evidence and details/i }).click();
    await expect(matchedCard).not.toContainText(/gpt-5\.4-nano/i);
    await expect(matchedCard).toContainText(/prompt v1-seed/i);

    // Deep link to the permalink page (another lane's scope — link only).
    await expect(anchoredCard.getByRole("link", { name: /open full claim/i })).toHaveAttribute("href", `/research/claims/${anchoredClaimId}`);
  });

  test("an anchored claim renders a solid in-text marker, a re-matched unanchored claim renders a dashed one, and an unmatchable claim stays sidebar-only", async ({ page }) => {
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });

    const anchoredMarker = edition.locator("button[data-marker-kind='claim']");
    await expect(anchoredMarker).toHaveCount(1);
    await expect(anchoredMarker).toHaveAttribute("data-annotation-id", anchoredClaimId);
    await expect(anchoredMarker).not.toHaveClass(/reader-annotation-marker-matched/);

    const matchedMarker = edition.locator("button[data-marker-kind='claim-matched']");
    await expect(matchedMarker).toHaveCount(1);
    await expect(matchedMarker).toHaveAttribute("data-annotation-id", matchedClaimId);
    await expect(matchedMarker).toHaveClass(/reader-annotation-marker-matched/);

    // Zero or multiple block matches never fabricate a marker — sidebar-only.
    await expect(edition.locator(`button[data-annotation-id="${unmatchedClaimId}"]`)).toHaveCount(0);
  });

  test("clicking an in-text claim marker opens the Claims tab and reveals that claim's card", async ({ page }) => {
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
    await edition.locator("button[data-marker-kind='claim']").click();

    await expect(page.getByRole("button", { name: /^Claims/i })).toHaveAttribute("aria-pressed", "true");
    const sidebar = page.getByRole("complementary", { name: /edition sidebar/i });
    await expect(sidebar.locator(`[data-claim-card="${anchoredClaimId}"]`)).toBeVisible();
  });

  test("GET /api/works/:workId/claims returns the seeded claims for the owning user", async ({ page }) => {
    const response = await page.request.get(`/api/works/${workId}/claims`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    const ids = (body.claims as Array<{ id: string }>).map((c) => c.id).sort();
    expect(ids).toEqual([anchoredClaimId, matchedClaimId, unmatchedClaimId].sort());
  });

  test("zero axe violations with the Claims tab open, in both themes", async ({ page }) => {
    await page.getByRole("button", { name: /^Claims/i }).click();
    for (const themeButton of ["Light", "Dark"] as const) {
      await page.getByRole("button", { name: themeButton, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", themeButton.toLowerCase());
      // D-19-8 settle precedent (edition.spec.ts's own axe test): a
      // just-fired theme-switch color transition can report a transient,
      // non-representative contrast failure that clears a moment later.
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations, themeButton).toEqual([]);
    }
  });
});

test.describe("Reader Claims tab — flag disabled", () => {
  test.skip(process.env.PHASE_25_READER_CLAIM_LAYER_ENABLED === "true", "requires the Phase 25 readerClaimLayer gate to be OFF");

  const offEmail = `reader-claims-off-${Date.now()}@example.com`;
  let workId = "";

  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(offEmail, PASSWORD);
    const seeded = await seedPublishedEdition(userId);
    workId = seeded.workId;
    await db.insert(researchClaims).values({
      userId,
      workId,
      processingRunId: seeded.runId,
      textBlockId: seeded.bodyBlockId,
      quote: "Vice remains a state on which one decides.",
      prefix: "",
      suffix: "",
      anchorState: "anchored",
      claimText: "This claim exists but must never surface while the flag is off.",
      claimNature: "interpretive",
      confidence: "high",
      section: "Introduction",
      sourceScope: "full_text",
      supportingExcerpt: "Vice remains a state on which one decides.",
      contentHash: "e2e-seed-flag-off-claim",
      promptVersion: "v1-seed",
    });
  });

  test.afterAll(async () => {
    await deleteTestUser(offEmail);
  });

  test("no Claims tab, no claim marker, and the API 404s when the flag is off", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(offEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
    await page.goto(`/works/${workId}/reader`);
    const edition = page.getByRole("region", { name: /interactive reader.*processed text/i });
    await expect(edition).toBeVisible();

    await expect(page.getByRole("button", { name: /^Claims/i })).toHaveCount(0);
    await expect(edition.locator("button[data-marker-kind='claim']")).toHaveCount(0);
    await expect(edition.locator("button[data-marker-kind='claim-matched']")).toHaveCount(0);

    const response = await page.request.get(`/api/works/${workId}/claims`);
    expect(response.status()).toBe(404);
  });
});
