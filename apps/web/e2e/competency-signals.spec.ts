import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { competencySignals, concepts, conceptMastery, db, graphEdges, understandingRatings } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "./helpers";

/**
 * Sub-phase 22.9b (plan §3, §5 Feature B): the fully deterministic path —
 * the zero-cost self-report detector only. No live LLM call anywhere in
 * this file (`PHASE_22_COMPETENCY_PROVIDER_ENABLED` stays unset/off); the
 * gated-model-tier + a serialized live call are deferred to the production
 * canary, per the plan's own explicit sequencing.
 *
 * Requires the local-only `PHASE_22_COMPETENCY_ENABLED` gate. Like the
 * existing `rag.spec.ts` skip condition, this reads the TEST RUNNER's own
 * process env — the actual web dev server must ALSO have been started (or
 * restarted) with this flag set for the feature to be live server-side;
 * exporting it only for the Playwright invocation is not sufficient on its
 * own if the server process predates the flag being added.
 */
test.describe("Sub-phase 22.9b conversational competency designation", () => {
  test.skip(process.env.PHASE_18_RAG_ENABLED !== "true" || process.env.PHASE_22_COMPETENCY_ENABLED !== "true", "requires the local-only Phase 18 RAG + Phase 22.9b competency gates");

  const EMAIL = `competency-${Date.now()}@example.com`;
  const PASSWORD = "Test-Password-1";
  let userId = "";
  let workId = "";
  let akrasiaConceptId = "";
  let sophrosyneConceptId = "";

  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    const seeded = await seedPublishedEdition(userId);
    workId = seeded.workId;

    const suffix = crypto.randomUUID().slice(0, 8);
    const inserted = await db
      .insert(concepts)
      .values([
        { slug: `akrasia-${suffix}`, kind: "concept", label: "Akrasia", summary: "Weakness of will." },
        { slug: `sophrosyne-${suffix}`, kind: "concept", label: "Sophrosyne", summary: "Temperance." },
      ])
      .returning({ id: concepts.id });
    akrasiaConceptId = inserted[0]!.id;
    sophrosyneConceptId = inserted[1]!.id;

    await db.insert(graphEdges).values([
      { userId, sourceType: "work", sourceId: workId, targetType: "concept", targetId: akrasiaConceptId, edgeType: "presupposes", confidence: 0.9, evidence: { role: "central" }, createdBy: "system" },
      { userId, sourceType: "work", sourceId: workId, targetType: "concept", targetId: sophrosyneConceptId, edgeType: "presupposes", confidence: 0.7, evidence: { role: "mentioned" }, createdBy: "system" },
    ]);

    // Precedence fixture: an EXPLICIT rating already on record for
    // Sophrosyne, which a chat-inferred signal must never overwrite.
    await db.insert(conceptMastery).values({ userId, conceptId: sophrosyneConceptId, score: 80, source: "explicit", evidence: "seeded for test" });
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
    await expect(page.getByRole("button", { name: "Ask Library" })).toBeVisible();
    await page.getByRole("button", { name: "Ask Library" }).click();
  });

  test("a self-reported unfamiliarity statement is noted, grounded in the reader's own words, and undo restores the prior (empty) state", async ({ page }) => {
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("I've never heard of Akrasia.");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();

    const notice = chat.getByRole("button", { name: /Noted:.*Akrasia.*unfamiliar/i });
    await expect(notice).toBeVisible();

    // Ledger + concept_mastery both reflect the applied write before undo.
    await expect
      .poll(async () => {
        const [row] = await db
          .select({ status: competencySignals.status, newScore: competencySignals.newScore, basis: competencySignals.basis, detector: competencySignals.detector })
          .from(competencySignals)
          .where(and(eq(competencySignals.userId, userId), eq(competencySignals.conceptId, akrasiaConceptId)));
        return row;
      })
      .toMatchObject({ status: "applied", newScore: 10, detector: "self-report-pattern" });
    const [signalRow] = await db
      .select({ id: competencySignals.id, basis: competencySignals.basis })
      .from(competencySignals)
      .where(and(eq(competencySignals.userId, userId), eq(competencySignals.conceptId, akrasiaConceptId)));
    expect(signalRow!.basis).toContain("I've never heard of Akrasia");

    const [masteryRow] = await db.select({ score: conceptMastery.score, source: conceptMastery.source }).from(conceptMastery).where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, akrasiaConceptId)));
    expect(masteryRow).toMatchObject({ score: 10, source: "inferred" });

    // Diagnostic GET provenance (plan §3.4): the same verbatim quote shows
    // up as this concept's evidence, reachable through the owned-work API.
    const diagnostic = await page.request.get(`/api/works/${workId}/diagnostic`);
    expect(diagnostic.ok()).toBeTruthy();
    const diagnosticBody = await diagnostic.json();
    const akrasiaMastery = diagnosticBody.existingMastery.find((m: { conceptId: string }) => m.conceptId === akrasiaConceptId);
    expect(akrasiaMastery).toMatchObject({ source: "inferred" });
    expect(akrasiaMastery.evidence).toContain("I've never heard of Akrasia");

    // Expand the notice, then undo.
    await notice.click();
    await expect(chat.getByText(/Your words:.*I've never heard of Akrasia/)).toBeVisible();
    await chat.getByRole("button", { name: "Undo" }).click();
    await expect(chat.getByText(/Undone:.*Akrasia/)).toBeVisible();

    await expect
      .poll(async () => {
        const [row] = await db.select({ status: competencySignals.status }).from(competencySignals).where(eq(competencySignals.id, signalRow!.id));
        return row?.status;
      })
      .toBe("undone");
    const restored = await db.select().from(conceptMastery).where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, akrasiaConceptId)));
    expect(restored).toHaveLength(0); // no prior row existed, so undo deletes it entirely
  });

  test("never overwrites an explicit rating already on record (precedence regression)", async ({ page }) => {
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("I've never heard of Sophrosyne.");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();

    // A precedence-skipped signal is never surfaced (plan §3.2).
    await expect(chat.getByRole("button", { name: /Noted:.*Sophrosyne/i })).toHaveCount(0);

    await expect
      .poll(async () => {
        const [row] = await db
          .select({ status: competencySignals.status, previousScore: competencySignals.previousScore, previousSource: competencySignals.previousSource })
          .from(competencySignals)
          .where(and(eq(competencySignals.userId, userId), eq(competencySignals.conceptId, sophrosyneConceptId)));
        return row;
      })
      .toMatchObject({ status: "skipped_precedence", previousScore: 80, previousSource: "explicit" });

    const [masteryRow] = await db.select({ score: conceptMastery.score, source: conceptMastery.source }).from(conceptMastery).where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, sophrosyneConceptId)));
    expect(masteryRow).toMatchObject({ score: 80, source: "explicit" });
  });

  test("a work-directed statement writes understanding_rating.workId, undo removes it (DB-level: no roadmap/graph UI reads this target yet)", async ({ page }) => {
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("I've read Vice and Reason already.");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();

    const notice = chat.getByRole("button", { name: /Noted:.*Vice and Reason.*familiar/i });
    await expect(notice).toBeVisible();

    await expect
      .poll(async () => {
        const [row] = await db.select({ score: understandingRatings.score, source: understandingRatings.source }).from(understandingRatings).where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.workId, workId)));
        return row;
      })
      .toMatchObject({ score: 65, source: "inferred" });

    await notice.click();
    await chat.getByRole("button", { name: "Undo" }).click();
    await expect(chat.getByText(/Undone:.*Vice and Reason/)).toBeVisible();
    const restored = await db.select().from(understandingRatings).where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.workId, workId)));
    expect(restored).toHaveLength(0);
  });

  /**
   * Phase 22.6 gate axe extension: the competency notice area — a NEW Phase
   * 22.9b surface (confidence/basis disclosure inside the global Ask Library
   * panel) with no prior automated accessibility coverage anywhere in the
   * suite. Scanned here with the notice both collapsed (as it first renders)
   * and expanded (its "Your words: …" quote disclosure), inside the same
   * real reader-panel dialog the tests above already drive.
   */
  test("the competency notice area meets WCAG 2A/2AA, collapsed and expanded", async ({ page }) => {
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("I've never heard of Akrasia.");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();

    const notice = chat.getByRole("button", { name: /Noted:.*Akrasia.*unfamiliar/i });
    await expect(notice).toBeVisible();
    await page.waitForTimeout(300);
    const collapsed = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(collapsed.violations).toEqual([]);

    await notice.click();
    await expect(chat.getByText(/Your words:.*I've never heard of Akrasia/)).toBeVisible();
    await page.waitForTimeout(300);
    const expanded = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(expanded.violations).toEqual([]);
  });
});
