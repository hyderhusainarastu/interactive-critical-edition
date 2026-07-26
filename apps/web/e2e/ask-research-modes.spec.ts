import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  claimRelationships,
  db,
  debateClusterMembers,
  debateClusterRelationships,
  debateClusters,
  researchClaims,
  researchProjects,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "./helpers";

/**
 * Phase 28.6 E2E: Ask Library's per-message research modes
 * (`find_counterarguments` / `find_support` / `explain_disagreement` /
 * `map_debate`), behind `askResearchModes`. Follows `reader-claims.spec.ts`'s
 * TWO describe-block, opposite-gated pattern: a single server process's env
 * is fixed at boot, so exercising both the ON and OFF branch for real means
 * running this file twice against two differently-configured server
 * processes, each correctly skipping the other block. `research_claim`/
 * `claim_relationship`/`debate_cluster` rows are SEEDED directly (the
 * `reader-claims.spec.ts`/`rag.spec.ts` CI-safety convention — no worker, no
 * live model call needed). `PHASE_18_RAG_PROVIDER_ENABLED` stays unset
 * throughout, so every research-mode answer takes the deterministic $0
 * fallback path — real, cited, fully-testable evidence with zero live-API
 * cost, exactly like `rag.spec.ts`'s own Socratic-mode coverage.
 */

const PASSWORD = "Test-Password-1";

async function seedResearchModeFixtures(userId: string) {
  const seeded = await seedPublishedEdition(userId);
  const workAId = seeded.workId;

  const [workB] = await db.insert(works).values({ userId, title: "The Opposing Reading", authorName: "A Rival Scholar" }).returning({ id: works.id });
  const workBId = workB.id;

  async function seedClaim(workId: string, claimText: string, contentHash: string) {
    const [claim] = await db
      .insert(researchClaims)
      .values({
        userId,
        workId,
        anchorState: "unanchored",
        claimText,
        claimNature: "interpretive",
        confidence: "medium",
        section: "Body",
        sourceScope: "full_text",
        supportingExcerpt: claimText.slice(0, 20),
        contentHash,
        promptVersion: "e2e-seed-v1",
      })
      .returning({ id: researchClaims.id });
    return claim.id;
  }

  const claimAId = await seedClaim(workAId, "Vice is a settled disposition arrived at by decision.", "e2e-mode-claim-a");
  const claimBId = await seedClaim(workBId, "Vice cannot be a matter of decision at all — it is imposed by habituation alone.", "e2e-mode-claim-b");
  const claimSupportId = await seedClaim(workBId, "The decision-based reading of vice is well supported by the text's own account of voluntary action.", "e2e-mode-claim-support");

  const [project] = await db.insert(researchProjects).values({ userId, title: "E2E Research Modes Project" }).returning({ id: researchProjects.id });
  const projectId = project.id;

  async function seedRelationship(claimLo: string, claimHi: string, valence: "contradiction" | "support" | "nuance", basisHash: string) {
    const [loId, hiId] = [claimLo, claimHi].sort();
    await db.insert(claimRelationships).values({
      userId,
      projectId,
      claimLoId: loId,
      claimHiId: hiId,
      valence,
      category: "theoretical",
      judgeBranch: "empirical",
      strongerSide: "neither",
      explanation: "Seeded for e2e coverage.",
      resolution: "Check the primary text.",
      engagement: "none_detected",
      basisHash,
      promptVersion: "e2e-seed-v1",
      provider: "test",
      model: "test-model",
    });
  }

  await seedRelationship(claimAId, claimBId, "contradiction", "e2e-mode-rel-contradiction");
  await seedRelationship(claimAId, claimSupportId, "support", "e2e-mode-rel-support");

  const [cluster] = await db
    .insert(debateClusters)
    .values({
      userId,
      projectId,
      name: "The Decision Debate",
      researchQuestion: "Is vice a matter of decision?",
      description: "Two works disagree on whether vice is decided into or merely habituated.",
      memberHash: "e2e-mode-cluster-hash",
      edgeCount: 1,
      counts: { contradiction: 1 },
      status: "active",
    })
    .returning({ id: debateClusters.id });
  const clusterId = cluster.id;

  await db.insert(debateClusterMembers).values([
    { clusterId, claimId: claimAId },
    { clusterId, claimId: claimBId },
  ]);
  const [contradictionRow] = await db
    .select({ id: claimRelationships.id })
    .from(claimRelationships)
    .where(eq(claimRelationships.basisHash, "e2e-mode-rel-contradiction"))
    .limit(1);
  await db.insert(debateClusterRelationships).values({ clusterId, claimRelationshipId: contradictionRow.id });

  return { workAId, workBId, claimAId, claimBId, claimSupportId, clusterId };
}

test.describe("Ask Library research modes (Phase 28.6)", () => {
  test.skip(process.env.PHASE_25_ASK_RESEARCH_MODES_ENABLED !== "true", "requires the local-only Phase 25 askResearchModes gate");

  const email = `ask-research-modes-${Date.now()}@example.com`;
  let workAId = "";
  let claimBId = "";
  let claimSupportId = "";
  let clusterId = "";

  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(email, PASSWORD);
    const seeded = await seedResearchModeFixtures(userId);
    ({ workAId, claimBId, claimSupportId, clusterId } = seeded);
  });

  test.afterAll(async () => {
    await deleteTestUser(email);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
  });

  test("the mode selector is visible on the reader's Ask Library panel, defaulting to Socratic", async ({ page }) => {
    await page.goto(`/works/${workAId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    const modeSelect = chat.getByLabel("Mode");
    await expect(modeSelect).toBeVisible();
    await expect(modeSelect).toHaveValue("socratic");
  });

  test("find_counterarguments returns a grounded answer citing the contradicting claim, work-scoped via the reader's context work", async ({ page }) => {
    await page.goto(`/works/${workAId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await chat.getByLabel("Mode").selectOption("find_counterarguments");
    await chat.getByLabel("Ask a question about your Library").fill("What pushes back on the idea that vice is decided?");
    await chat.getByRole("button", { name: "Ask" }).click();

    await expect(chat.getByText("Library companion").last()).toBeVisible();
    await expect(chat.getByText("· Find counterarguments")).toBeVisible();
    const claimChip = chat.getByRole("link", { name: /The Opposing Reading/i });
    await expect(claimChip).toBeVisible();
    await expect(claimChip).toHaveAttribute("href", `/research/claims/${claimBId}`);

    // Mode persists on rag_message.mode — reload and confirm the badge
    // survives from real DB state, not just the live SSE echo.
    await page.reload();
    await page.getByRole("button", { name: "Ask Library" }).click();
    const reopened = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(reopened.getByText("· Find counterarguments")).toBeVisible();
    await expect(reopened.getByRole("link", { name: /The Opposing Reading/i })).toHaveAttribute("href", `/research/claims/${claimBId}`);
  });

  test("find_support returns a grounded answer citing the supporting claim", async ({ page }) => {
    await page.goto(`/works/${workAId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await chat.getByRole("button", { name: "New conversation" }).click();
    await chat.getByLabel("Mode").selectOption("find_support");
    await chat.getByLabel("Ask a question about your Library").fill("What supports the idea that vice is decided?");
    await chat.getByRole("button", { name: "Ask" }).click();

    await expect(chat.getByText("Library companion").last()).toBeVisible();
    await expect(chat.getByText("· Find support")).toBeVisible();
    const claimChip = chat.getByRole("link", { name: /The Opposing Reading/i });
    await expect(claimChip).toBeVisible();
    await expect(claimChip).toHaveAttribute("href", `/research/claims/${claimSupportId}`);
  });

  test("find_counterarguments returns the explicit not-found answer when there is no scope to resolve at all", async ({ page }) => {
    // The plain `/ask-library` page (no contextWorkId, no claimId deep
    // link) genuinely cannot resolve a scope for this mode — the honest
    // `noScopeAnswer` path, distinct from "scope resolved but zero
    // relationships found".
    await page.goto("/ask-library");
    const chat = page.getByRole("region", { name: "Library-grounded Socratic chat" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Mode").selectOption("find_counterarguments");
    await chat.getByLabel("Ask a question about your Library").fill("What pushes back on this, in general?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat).toContainText(/specific work or claim/i);
  });

  test("explain_disagreement deep-linked to a cluster cites at least one claim per side", async ({ page }) => {
    await page.goto(`/ask-library?mode=explain_disagreement&clusterId=${clusterId}`);
    const chat = page.getByRole("region", { name: "Library-grounded Socratic chat" });
    await expect(chat).toBeVisible();
    await expect(chat.getByLabel("Mode")).toHaveValue("explain_disagreement");
    await chat.getByLabel("Ask a question about your Library").fill("Where do these two works actually disagree?");
    await chat.getByRole("button", { name: "Ask" }).click();

    await expect(chat.getByText("Library companion").last()).toBeVisible();
    await expect(chat.getByText("· Explain disagreement")).toBeVisible();
    // At least one claim chip from each side — a `research_claim` row
    // belonging to workA and one belonging to workB.
    const chips = chat.getByRole("link", { name: /^\[\d+\]/ });
    await expect(chips).toHaveCount(2);
  });

  test("explain_disagreement returns the honest not-found without a cluster id or a work pair", async ({ page }) => {
    await page.goto("/ask-library?mode=explain_disagreement");
    const chat = page.getByRole("region", { name: "Library-grounded Socratic chat" });
    await expect(chat).toBeVisible();
    await expect(chat.getByLabel("Mode")).toHaveValue("explain_disagreement");
    await chat.getByLabel("Ask a question about your Library").fill("Where do works in my Library disagree?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat).toContainText(/choose a debate/i);
  });

  test("map_debate deep-linked to a cluster summarizes it, citing member claims", async ({ page }) => {
    await page.goto(`/ask-library?mode=map_debate&clusterId=${clusterId}`);
    const chat = page.getByRole("region", { name: "Library-grounded Socratic chat" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("What is this debate about?");
    await chat.getByRole("button", { name: "Ask" }).click();

    await expect(chat.getByText("Library companion").last()).toBeVisible();
    await expect(chat).toContainText(/The Decision Debate/i);
    const chips = chat.getByRole("link", { name: /^\[\d+\]/ });
    expect(await chips.count()).toBeGreaterThanOrEqual(2);
  });

  test("map_debate returns the honest not-found without a cluster id", async ({ page }) => {
    await page.goto("/ask-library?mode=map_debate");
    const chat = page.getByRole("region", { name: "Library-grounded Socratic chat" });
    await expect(chat).toBeVisible();
    await chat.getByLabel("Ask a question about your Library").fill("Map a debate for me.");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat).toContainText(/choose a debate/i);
  });

  test("a plain socratic ask (the mode selector's default) still works normally alongside the research modes", async ({ page }) => {
    await page.goto(`/works/${workAId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    // Mode defaults to socratic; a plain question still answers normally
    // (not-found here, since no rag_chunk was indexed for this fixture).
    await chat.getByLabel("Ask a question about your Library").fill("What is the central argument here?");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();
    await expect(chat.getByText("· Find counterarguments")).toHaveCount(0);
  });

  test("zero axe violations with the mode selector visible, in both themes", async ({ page }) => {
    await page.goto(`/works/${workAId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat.getByLabel("Mode")).toBeVisible();
    for (const themeButton of ["Light", "Dark"] as const) {
      await page.getByRole("button", { name: themeButton, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", themeButton.toLowerCase());
      // D-19-8 settle precedent: a just-fired theme-switch transition can
      // report a transient, non-representative contrast failure.
      await page.waitForTimeout(300);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(results.violations, themeButton).toEqual([]);
    }
  });
});

test.describe("Ask Library research modes — flag disabled", () => {
  test.skip(process.env.PHASE_25_ASK_RESEARCH_MODES_ENABLED === "true", "requires the Phase 25 askResearchModes gate to be OFF");

  const offEmail = `ask-research-modes-off-${Date.now()}@example.com`;
  let workAId = "";
  let conversationId = "";

  test.beforeAll(async () => {
    const userId = await createVerifiedTestUser(offEmail, PASSWORD);
    const seeded = await seedPublishedEdition(userId);
    workAId = seeded.workId;
  });

  test.afterAll(async () => {
    await deleteTestUser(offEmail);
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(offEmail);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("**/dashboard");
  });

  test("the mode selector is absent, and the API rejects a non-socratic mode", async ({ page }) => {
    await page.goto(`/works/${workAId}/reader`);
    await page.getByRole("button", { name: "Ask Library" }).click();
    const chat = page.getByRole("dialog", { name: "Ask Library — Reader panel" });
    await expect(chat).toBeVisible();
    await expect(chat.getByLabel("Mode")).toHaveCount(0);

    // Ask once through the UI to obtain a real conversation id, then probe
    // the API directly — a flag-off deployment must reject a non-socratic
    // mode outright, not silently answer as if it were socratic.
    await chat.getByLabel("Ask a question about your Library").fill("A plain socratic question.");
    await chat.getByRole("button", { name: "Ask" }).click();
    await expect(chat.getByText("Library companion").last()).toBeVisible();

    const list = await page.request.get("/api/rag/conversations");
    expect(list.ok()).toBe(true);
    const { conversations } = await list.json();
    conversationId = conversations[0].id;
    const response = await page.request.post(`/api/rag/conversations/${conversationId}`, {
      data: { message: "Find counterarguments to this.", mode: "find_counterarguments" },
    });
    expect(response.status()).toBe(400);
  });
});
