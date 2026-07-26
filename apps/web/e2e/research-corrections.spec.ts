import AxeBuilder from "@axe-core/playwright";
import {
  claimRelationships,
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
  researchGaps,
  researchHypotheses,
  researchHypothesisSources,
  researchHypothesisSupport,
  researchProjectMembers,
  researchProjects,
  researchRevisions,
  textBlocks,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  applyResearchCorrection,
  applyResearchCorrectionOnce,
  listResearchRevisions,
  type ApplyResearchCorrectionInput,
} from "@/lib/research/corrections";
import { auditTouchTargets, createVerifiedTestUser, deleteTestUser } from "./helpers";

/**
 * Phase 29.2: the review/correction UX for every research object.
 * `applyResearchCorrection` (`lib/research/corrections.ts`) is exercised
 * BOTH directly (the "programmatic" describe block below — the unit/
 * integration coverage the lane's brief asks for, run the same way
 * `auth.spec.ts` imports `@/lib/tokens` for a non-browser check) and
 * through the real UI/API (`api/research/corrections`,
 * `api/research/revisions`). Own dedicated server on PORT 3180, per this
 * lane's own port assignment — the `research-chambers.spec.ts`/
 * `research-hypotheses.spec.ts` precedent of a fixed, distinctive port so
 * parallel worktree lanes sharing the same local Postgres never collide.
 */

const PORT = 3180;
const FLAG_OFF_PORT = 3181;
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

const EMAIL = `e2e-corrections-${Date.now()}@example.com`;
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

/** Seeds one work with a real published run/block, plus one claim whose
 *  supporting excerpt is deliberately splittable ("the rational part" /
 *  "the appetitive part" are both literal substrings) — the shared base
 *  every test below builds on. Each test passes its own `suffix` so
 *  content hashes/basis hashes never collide across tests (the
 *  `seedHypothesesFixture` precedent). */
async function seedWorkAndClaim(ownerId: string, suffix: string, claimTextOverride?: string, excerptOverride?: string) {
  const bodyText = "The soul has both a rational part and an appetitive part, and virtue concerns their relation.";
  const [work] = await db.insert(works).values({ userId: ownerId, title: `Work ${suffix}`, authorName: "Test Author" }).returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({ userId: ownerId, workId: work.id, storagePath: `${ownerId}/${work.id}/e.txt`, originalFilename: "e.txt", mimeType: "text/plain", fileSize: bodyText.length, processingStatus: "ready", analysisStatus: "complete", extractedText: bodyText })
    .returning({ id: documents.id });
  const [run] = await db.insert(processingRuns).values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true, degraded: false }).returning({ id: processingRuns.id });
  const [page1] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: bodyText }).returning({ id: pages.id });
  const [block] = await db.insert(textBlocks).values({ pageId: page1.id, blockOrder: 0, kind: "body", text: bodyText }).returning({ id: textBlocks.id });

  const claimText = claimTextOverride ?? "The soul has a rational part and an appetitive part.";
  const excerpt = excerptOverride ?? "rational part and an appetitive part";
  const [claim] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: work.id,
      processingRunId: run.id,
      textBlockId: block.id,
      quote: excerpt,
      prefix: "The soul has both a ",
      suffix: ", and virtue concerns",
      anchorState: "anchored",
      claimText,
      claimNature: "interpretive",
      confidence: "high",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: excerpt,
      excerptVerified: true,
      contentHash: `e2e-corrections-${suffix}`,
      promptVersion: "claim-extraction-v1",
    })
    .returning();

  return { workId: work.id, blockId: block.id, bodyText, claim };
}

/** Extends `seedWorkAndClaim` with a second work + claim, a judged
 *  contradiction relationship, a debate cluster, a chamber, a hypothesis,
 *  and a gap — the full "debate web" fixture the relationship/cluster/
 *  chamber/hypothesis/gap tests need. Mirrors
 *  `research-hypotheses.spec.ts`/`research-chambers.spec.ts`'s own seed
 *  shapes, combined into one fixture since this lane's tests touch every
 *  object type. */
async function seedDebateWebFixture(ownerId: string, suffix: string) {
  const base = await seedWorkAndClaim(ownerId, `${suffix}-a`);
  const [workB] = await db.insert(works).values({ userId: ownerId, title: `Work ${suffix}-b`, authorName: "Author B" }).returning({ id: works.id });
  const [claimB] = await db
    .insert(researchClaims)
    .values({
      userId: ownerId,
      workId: workB.id,
      anchorState: "unanchored",
      claimText: "The soul is a single unified faculty with no internal parts.",
      claimNature: "interpretive",
      confidence: "medium",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: "a single unified faculty",
      excerptVerified: false,
      contentHash: `e2e-corrections-${suffix}-b`,
      promptVersion: "claim-extraction-v1",
    })
    .returning();

  const [project] = await db.insert(researchProjects).values({ userId: ownerId, title: `Corrections project ${suffix}` }).returning({ id: researchProjects.id });
  await db.insert(researchProjectMembers).values([
    { projectId: project.id, memberType: "work", workId: base.workId, role: "central" },
    { projectId: project.id, memberType: "work", workId: workB.id, role: "central" },
  ]);

  const [claimLoId, claimHiId] = [base.claim.id, claimB.id].sort();
  const [relationship] = await db
    .insert(claimRelationships)
    .values({
      userId: ownerId,
      projectId: project.id,
      claimLoId,
      claimHiId,
      valence: "contradiction",
      category: "theoretical",
      judgeBranch: "empirical",
      strongerSide: "neither",
      explanation: "The two works disagree on whether the soul has internal parts.",
      resolution: "Compare both readings against the same passage.",
      engagement: "none_detected",
      basisHash: `e2e-corrections-rel-${suffix}`,
      promptVersion: "judge-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: claimRelationships.id });

  const [cluster] = await db
    .insert(debateClusters)
    .values({ userId: ownerId, projectId: project.id, name: `Soul parts debate ${suffix}`, researchQuestion: "Does the soul have parts?", memberHash: `e2e-corrections-cluster-${suffix}`, edgeCount: 1, counts: { contradiction: 1, support: 0, nuance: 0 } })
    .returning({ id: debateClusters.id });
  await db.insert(debateClusterMembers).values([
    { clusterId: cluster.id, claimId: base.claim.id },
    { clusterId: cluster.id, claimId: claimB.id },
  ]);

  const [chamber] = await db
    .insert(evidenceChambers)
    .values({
      userId: ownerId,
      projectId: project.id,
      clusterId: cluster.id,
      question: "Does the soul have internal parts?",
      sharedGround: "Both agree the soul is the seat of virtue.",
      pointOfDivergence: "One reading posits internal parts; the other a single faculty.",
      possibleReconciliation: "The two accounts may describe different explanatory levels.",
      unresolvedQuestion: "Whether 'part' is meant literally or functionally.",
      missingEvidence: "A shared criterion for what counts as a real part.",
      nextAction: "Compare both readings against the source text directly.",
      basisHash: `e2e-corrections-chamber-${suffix}`,
      promptVersion: "evidence-chamber-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: evidenceChambers.id });
  const [positionA] = await db
    .insert(evidenceChamberPositions)
    .values({ chamberId: chamber.id, ordinal: 0, label: `Work ${suffix}-a`, summary: "Internal parts.", method: "textual", scope: "general", stanceConfidenceLabel: "high", stanceConfidence: 0.9 })
    .returning({ id: evidenceChamberPositions.id });
  await db.insert(evidenceChamberPositionClaims).values({ positionId: positionA.id, claimId: base.claim.id, ordinal: 0, excerpt: base.claim.supportingExcerpt });

  const [hypothesis] = await db
    .insert(researchHypotheses)
    .values({
      userId: ownerId,
      projectId: project.id,
      question: null,
      statement: "The disagreement dissolves once 'part' is read functionally rather than literally.",
      rationale: "Both readings converge under a functional reading of psychic parts.",
      methodology: "Compare both works' usage of 'part' across parallel passages.",
      challenges: ["Requires reconciling divergent translations."],
      grounding: "detected_conflicts",
      runHash: `e2e-corrections-hyp-${suffix}`,
      promptVersion: "hypothesis-v1",
      provider: "test",
      model: "test-model",
    })
    .returning({ id: researchHypotheses.id });
  await db.insert(researchHypothesisSources).values({ hypothesisId: hypothesis.id, claimRelationshipId: relationship.id });
  await db.insert(researchHypothesisSupport).values([
    { hypothesisId: hypothesis.id, workId: base.workId, corpusItemId: null },
    { hypothesisId: hypothesis.id, workId: workB.id, corpusItemId: null },
  ]);

  const [gap] = await db
    .insert(researchGaps)
    .values({
      userId: ownerId,
      projectId: project.id,
      debateClusterId: cluster.id,
      description: `"Soul parts debate ${suffix}" contains 1 unresolved contradiction — the open question is: Does the soul have parts?`,
      unresolvedContradictionCount: 1,
    })
    .returning({ id: researchGaps.id });

  return { projectId: project.id, workAId: base.workId, workBId: workB.id, claimAId: base.claim.id, claimBId: claimB.id, relationshipId: relationship.id, clusterId: cluster.id, chamberId: chamber.id, hypothesisId: hypothesis.id, gapId: gap.id };
}

test.describe("Research corrections (Phase 29.2)", () => {
  test.use({ baseURL: BASE_URL });

  test.beforeAll(async () => {
    server = spawnServer(PORT, { PHASE_25_RESEARCH_ENABLED: "true" });
    const ready = await waitForServerReady(BASE_URL);
    expect(ready, "dedicated port-3180 server never became ready").toBe(true);

    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await markOnboarded(userId);
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
    server?.kill("SIGTERM");
  });

  // -------------------------------------------------------------------
  // Programmatic (unit/integration) coverage of applyResearchCorrection
  // -------------------------------------------------------------------

  test("verify/dispute/hide/restore apply to relationship, cluster, chamber, hypothesis, and gap", async () => {
    const fixture = await seedDebateWebFixture(userId, `status-${Date.now()}`);
    const targets: { objectType: ApplyResearchCorrectionInput["objectType"]; objectId: string }[] = [
      { objectType: "relationship", objectId: fixture.relationshipId },
      { objectType: "cluster", objectId: fixture.clusterId },
      { objectType: "chamber", objectId: fixture.chamberId },
      { objectType: "hypothesis", objectId: fixture.hypothesisId },
      { objectType: "gap", objectId: fixture.gapId },
    ];
    for (const target of targets) {
      const verified = await applyResearchCorrection({ userId, editor: "user", objectType: target.objectType, objectId: target.objectId, action: "verified" } as ApplyResearchCorrectionInput);
      expect(verified.ok, `${target.objectType} verify should succeed`).toBe(true);
      const disputed = await applyResearchCorrection({ userId, editor: "user", objectType: target.objectType, objectId: target.objectId, action: "disputed", reason: "needs a second look" } as ApplyResearchCorrectionInput);
      expect(disputed.ok, `${target.objectType} dispute should succeed`).toBe(true);
      const hidden = await applyResearchCorrection({ userId, editor: "user", objectType: target.objectType, objectId: target.objectId, action: "hidden" } as ApplyResearchCorrectionInput);
      expect(hidden.ok, `${target.objectType} hide should succeed`).toBe(true);
      const restored = await applyResearchCorrection({ userId, editor: "user", objectType: target.objectType, objectId: target.objectId, action: "restored" } as ApplyResearchCorrectionInput);
      expect(restored.ok, `${target.objectType} restore should succeed`).toBe(true);

      const revisions = await listResearchRevisions(userId, target.objectType, target.objectId);
      // generated backfill (0) + verified (1) + disputed (2) + hidden (3) + restored (4)
      expect(revisions.map((r) => r.revision)).toEqual([0, 1, 2, 3, 4]);
      expect(revisions[0].action).toBe("generated");
      expect(revisions[0].editor).toBe("system");
      expect(revisions[2].reason).toBe("needs a second look");
    }

    // A not-owned/nonexistent id is honestly not_found, never a distinguishable error.
    const missing = await applyResearchCorrection({ userId, editor: "user", objectType: "gap", objectId: "00000000-0000-0000-0000-000000000000", action: "verified" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("not_found");
  });

  test("claim edited: a matching excerpt stays anchored, a mismatched one goes unanchored — never silently", async () => {
    const { claim } = await seedWorkAndClaim(userId, `edit-${Date.now()}`);

    const goodEdit = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: "claim",
      objectId: claim.id,
      action: "edited",
      changes: { claimText: "The soul has a rational and an appetitive part, exactly as stated.", supportingExcerpt: "an appetitive part" },
    });
    expect(goodEdit.ok).toBe(true);
    const [afterGood] = await db.select().from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(afterGood.excerptVerified).toBe(true);
    expect(afterGood.anchorState).toBe("anchored");
    expect(afterGood.promptVersion).toBe("research-correction-edited-v1");

    const badEdit = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: "claim",
      objectId: claim.id,
      action: "edited",
      changes: { supportingExcerpt: "a passage that was never actually in the source text anywhere" },
    });
    expect(badEdit.ok).toBe(true);
    const [afterBad] = await db.select().from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(afterBad.excerptVerified).toBe(false);
    expect(afterBad.anchorState).toBe("unanchored");
    expect(afterBad.textBlockId).toBeNull();
  });

  test("claim reclassified: valid nature updates claim_nature, invalid nature is rejected", async () => {
    const { claim } = await seedWorkAndClaim(userId, `reclass-${Date.now()}`);
    const good = await applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: claim.id, action: "reclassified", changes: { claimNature: "conceptual" } });
    expect(good.ok).toBe(true);
    const [after] = await db.select({ claimNature: researchClaims.claimNature }).from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(after.claimNature).toBe("conceptual");

    const bad = await applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: claim.id, action: "reclassified", changes: { claimNature: "not-a-real-nature" } });
    expect(bad).toEqual({ ok: false, error: "invalid", message: "Unknown claim nature." });
  });

  test("claim split: rejects a non-substring part, and a valid split supersedes the parent with related_object_ids both ways", async () => {
    const { claim } = await seedWorkAndClaim(userId, `split-${Date.now()}`);

    const invalid = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: "claim",
      objectId: claim.id,
      action: "split",
      changes: { excerpts: ["rational part", "a phrase invented out of thin air"] },
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.message).toMatch(/not a literal substring/);

    const valid = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: "claim",
      objectId: claim.id,
      action: "split",
      changes: { excerpts: ["rational part", "appetitive part"] },
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error("expected split to succeed");
    expect(valid.newClaimIds).toHaveLength(2);

    const [parentAfter] = await db.select().from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(parentAfter.status).toBe("superseded");

    const children = await db.select().from(researchClaims).where(eq(researchClaims.workId, parentAfter.workId as string));
    const newChildren = children.filter((c) => valid.newClaimIds!.includes(c.id));
    expect(newChildren).toHaveLength(2);
    for (const child of newChildren) {
      expect(child.status).toBe("active");
      expect(child.excerptVerified).toBe(true);
      expect(child.verificationStatus).toBe("user_verified");
      expect(child.textBlockId).toBe(parentAfter.textBlockId);
    }

    const parentRevisions = await listResearchRevisions(userId, "claim", claim.id);
    const splitRevision = parentRevisions.find((r) => r.action === "split");
    expect(splitRevision?.relatedObjectIds).toEqual(valid.newClaimIds);
    const childRevisions = await listResearchRevisions(userId, "claim", valid.newClaimIds![0]);
    expect(childRevisions).toHaveLength(1);
    expect(childRevisions[0].revision).toBe(0);
    expect(childRevisions[0].before).toBeNull();
    expect((childRevisions[0].relatedObjectIds as string[]).includes(claim.id)).toBe(true);
  });

  test("claim merge: supersedes both originals and creates one new active claim, rejecting a fabricated excerpt", async () => {
    const suffix = `merge-${Date.now()}`;
    const { claim: claimOne, workId } = await seedWorkAndClaim(userId, `${suffix}-1`, "The rational part governs deliberation.", "rational part");
    const { claim: claimTwo } = await seedWorkAndClaim(userId, `${suffix}-2`, "The appetitive part governs desire.", "appetitive part");
    // Force claimTwo onto the SAME work as claimOne so the merge's
    // same-source guard is satisfied (seedWorkAndClaim always makes a fresh work).
    await db.update(researchClaims).set({ workId }).where(eq(researchClaims.id, claimTwo.id));

    const fabricated = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: "claim",
      objectId: claimOne.id,
      action: "merged",
      changes: { otherClaimIds: [claimTwo.id], claimText: "Merged claim", supportingExcerpt: "a phrase neither claim ever excerpted" },
    });
    expect(fabricated.ok).toBe(false);

    const merged = await applyResearchCorrection({
      userId,
      editor: "user",
      objectType: "claim",
      objectId: claimOne.id,
      action: "merged",
      changes: { otherClaimIds: [claimTwo.id], claimText: "The soul's rational and appetitive parts jointly govern action.", supportingExcerpt: "rational part" },
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error("expected merge to succeed");

    const [claimOneAfter] = await db.select().from(researchClaims).where(eq(researchClaims.id, claimOne.id));
    const [claimTwoAfter] = await db.select().from(researchClaims).where(eq(researchClaims.id, claimTwo.id));
    expect(claimOneAfter.status).toBe("superseded");
    expect(claimTwoAfter.status).toBe("superseded");
    const [mergedRow] = await db.select().from(researchClaims).where(eq(researchClaims.id, merged.objectId));
    expect(mergedRow.status).toBe("active");
    expect(mergedRow.verificationStatus).toBe("user_verified");
    expect(mergedRow.promptVersion).toBe("research-correction-merged-v1");
  });

  test("transaction atomicity: a rejected revision insert rolls back the object update", async () => {
    const { claim } = await seedWorkAndClaim(userId, `atomic-${Date.now()}`);
    const [before] = await db.select({ verificationStatus: researchClaims.verificationStatus }).from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(before.verificationStatus).toBe("unreviewed");

    // Deliberately invalid at the TYPE level (CorrectionEditor has no
    // "system" member — corrections.test.ts's own compile-time guarantee)
    // but constructed here via a cast to prove the DB-level CHECK
    // (`research_revision_no_auto_endorsement`) rejects it at runtime too,
    // and that the claim's own status update rolls back alongside the
    // failed revision insert rather than persisting half the transaction.
    let threw = false;
    try {
      await applyResearchCorrectionOnce({ userId, editor: "system" as unknown as "user", objectType: "claim", objectId: claim.id, action: "verified" });
    } catch {
      threw = true;
    }
    expect(threw, "a system-authored non-generated revision must be rejected, not silently accepted").toBe(true);

    const [after] = await db.select({ verificationStatus: researchClaims.verificationStatus }).from(researchClaims).where(eq(researchClaims.id, claim.id));
    expect(after.verificationStatus).toBe("unreviewed");
    const revisions = await db.select().from(researchRevisions).where(eq(researchRevisions.researchClaimId, claim.id));
    expect(revisions).toHaveLength(0);
  });

  test("monotonic revision numbering under two rapid, concurrent corrections against the same object", async () => {
    const { claim } = await seedWorkAndClaim(userId, `race-${Date.now()}`);
    const [a, b] = await Promise.all([
      applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: claim.id, action: "verified" }),
      applyResearchCorrection({ userId, editor: "user", objectType: "claim", objectId: claim.id, action: "disputed", reason: "concurrent" }),
    ]);
    expect(a.ok, "first concurrent correction should succeed").toBe(true);
    expect(b.ok, "second concurrent correction should succeed (retried past the revision race)").toBe(true);
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.revision).not.toBe(b.revision);

    const revisions = await listResearchRevisions(userId, "claim", claim.id);
    const revisionNumbers = revisions.map((r) => r.revision);
    expect(new Set(revisionNumbers).size).toBe(revisionNumbers.length); // no duplicates
    expect([...revisionNumbers].sort((x, y) => x - y)).toEqual(revisionNumbers); // monotonic
  });

  // -------------------------------------------------------------------
  // UI coverage
  // -------------------------------------------------------------------

  test("claim permalink: verify/dispute/hide/restore update the chip, and the history drawer renders the trail", async ({ page }) => {
    const { claim } = await seedWorkAndClaim(userId, `ui-status-${Date.now()}`);
    await login(page);
    await page.goto(`/research/claims/${claim.id}`);

    const controls = main(page).locator('[data-research-correction-controls="claim"]');
    await expect(controls.locator("[data-verification-chip]")).toHaveText("Unreviewed");

    await controls.getByRole("button", { name: "Verify" }).click();
    await expect(controls.locator("[data-verification-chip]")).toHaveText("Verified");

    await controls.getByRole("button", { name: "Dispute" }).click();
    await controls.getByPlaceholder(/Why does this look wrong/).fill("Doesn't match my reading.");
    await controls.getByRole("button", { name: "Confirm dispute" }).click();
    await expect(controls.locator("[data-verification-chip]")).toHaveText("Disputed");

    await controls.getByRole("button", { name: "Hide" }).click();
    await expect(controls.getByText("Hidden")).toBeVisible();
    await controls.getByRole("button", { name: "Restore" }).click();
    await expect(controls.getByText("Hidden")).toHaveCount(0);

    await controls.getByRole("button", { name: "History" }).click();
    await expect(controls.getByText(/Revision 0 — Generated/)).toBeVisible();
    await expect(controls.getByText(/Revision 1 — Verified/)).toBeVisible();
    await expect(controls.getByText(/Revision 2 — Disputed/)).toBeVisible();
    await expect(controls.getByText("Reason: Doesn't match my reading.")).toBeVisible();
  });

  test("claim permalink: edit updates claim text, and a mismatched excerpt edit is surfaced (not silent)", async ({ page }) => {
    const { claim } = await seedWorkAndClaim(userId, `ui-edit-${Date.now()}`);
    await login(page);
    await page.goto(`/research/claims/${claim.id}`);

    await main(page).getByRole("button", { name: "Edit", exact: true }).click();
    // id-based, not getByLabel: the read-only "Supporting excerpt" section
    // heading below shares that exact accessible name with the edit
    // textarea's own <label>, so getByLabel resolves to two elements here.
    const textArea = main(page).locator("#claim-edit-text");
    await textArea.fill("The soul is composed of a rational and an appetitive part, restated.");
    await main(page).getByRole("button", { name: "Save" }).click();
    // Generous, documented budget for the RSC refresh this Save triggers
    // (the D-19-37 "RSC-dependent title assertion" precedent), not a fixed
    // client-side state update.
    await expect(main(page).getByRole("heading", { name: "The soul is composed of a rational and an appetitive part, restated." })).toBeVisible({ timeout: 15_000 });

    await main(page).getByRole("button", { name: "Edit", exact: true }).click();
    const excerptArea = main(page).locator("#claim-edit-excerpt");
    await excerptArea.fill("a phrase that was never in the source text");
    await main(page).getByRole("button", { name: "Save" }).click();
    await expect(main(page).getByText(/now marked unanchored rather than silently kept/)).toBeVisible();
    await expect(main(page).getByText("This claim's anchor is currently unanchored.")).toBeVisible();
  });

  test("claim permalink: reclassify updates the nature chip", async ({ page }) => {
    const { claim } = await seedWorkAndClaim(userId, `ui-reclassify-${Date.now()}`);
    await login(page);
    await page.goto(`/research/claims/${claim.id}`);
    await expect(main(page).getByText("Interpretive", { exact: true })).toBeVisible();

    await main(page).getByRole("button", { name: "Reclassify", exact: true }).click();
    await main(page).getByLabel("Claim nature").selectOption("conceptual");
    await main(page).getByRole("button", { name: "Save" }).click();
    await expect(main(page).getByText("Conceptual", { exact: true })).toBeVisible();
  });

  test("claim permalink: split creates two linked parts", async ({ page }) => {
    const { claim } = await seedWorkAndClaim(userId, `ui-split-${Date.now()}`);
    await login(page);
    await page.goto(`/research/claims/${claim.id}`);

    await main(page).getByRole("button", { name: "Split", exact: true }).click();
    const parts = main(page).locator('textarea[id^="split-excerpt-"]');
    await parts.nth(0).fill("rational part");
    await parts.nth(1).fill("appetitive part");
    await main(page).getByRole("button", { name: "Split claim" }).click();

    await expect(main(page).getByRole("link", { name: "part 1" })).toBeVisible();
    await expect(main(page).getByRole("link", { name: "part 2" })).toBeVisible();
  });

  test("hypotheses page: relationship, hypothesis, and gap review controls each verify independently", async ({ page }) => {
    const fixture = await seedDebateWebFixture(userId, `ui-hyp-${Date.now()}`);
    await login(page);
    await page.goto(`/research/${fixture.projectId}/hypotheses`);

    const relationshipControls = main(page).locator(`[data-research-correction-controls="relationship"]`).first();
    await relationshipControls.getByRole("button", { name: "Verify" }).click();
    await expect(relationshipControls.locator("[data-verification-chip]")).toHaveText("Verified");

    const hypothesisControls = main(page).locator(`[data-research-correction-controls="hypothesis"]`).first();
    await hypothesisControls.getByRole("button", { name: "Verify" }).click();
    await expect(hypothesisControls.locator("[data-verification-chip]")).toHaveText("Verified");

    const gapControls = main(page).locator(`[data-research-correction-controls="gap"]`).first();
    await gapControls.getByRole("button", { name: "Verify" }).click();
    await expect(gapControls.locator("[data-verification-chip]")).toHaveText("Verified");
  });

  test("chamber and debate cluster pages: verify updates each object's own chip", async ({ page }) => {
    const fixture = await seedDebateWebFixture(userId, `ui-chamber-${Date.now()}`);
    await login(page);

    await page.goto(`/research/${fixture.projectId}/debates/${fixture.clusterId}`);
    const clusterControls = main(page).locator('[data-research-correction-controls="cluster"]');
    await clusterControls.getByRole("button", { name: "Verify" }).click();
    await expect(clusterControls.locator("[data-verification-chip]")).toHaveText("Verified");

    await page.goto(`/research/chambers/${fixture.chamberId}`);
    const chamberControls = main(page).locator('[data-research-correction-controls="chamber"]');
    await chamberControls.getByRole("button", { name: "Dispute" }).click();
    await chamberControls.getByRole("button", { name: "Confirm dispute" }).click();
    await expect(chamberControls.locator("[data-verification-chip]")).toHaveText("Disputed");
  });

  test("axe: zero wcag2a/wcag2aa violations on the claim permalink and hypotheses pages, light and dark", async ({ page }) => {
    const fixture = await seedDebateWebFixture(userId, `axe-${Date.now()}`);
    await login(page);

    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`/research/claims/${fixture.claimAId}`);
      await expect(main(page).getByRole("heading", { name: "Review" })).toBeVisible();
      expect((await scan(page)).violations, `/research/claims/[claimId] (${colorScheme})`).toEqual([]);

      await page.goto(`/research/${fixture.projectId}/hypotheses`);
      await expect(main(page).getByRole("heading", { name: "Hypotheses & gaps" })).toBeVisible();
      expect((await scan(page)).violations, `/research/[projectId]/hypotheses (${colorScheme})`).toEqual([]);
    }
  });

  // D-25-10: the Phase 30 axe sweep found the claim-permalink correction UI
  // (verify/dispute/hide/restore/edit/reclassify/split/merge buttons, the
  // history drawer toggle) below the 44px touch-target minimum — some as
  // low as 16px. Fixed sizing-only (min-h-11/min-w-11, the D-23-41
  // precedent) on the non-compact `ResearchCorrectionControls`/
  // `ClaimCorrectionExtras` render path; the SAME components render
  // `compact` on the hypotheses/gaps page and stay deliberately dense
  // (`data-dense-controls`-exempted), asserted separately below.
  test("claim permalink page controls meet the 44x44 touch-target minimum, including every open sub-form", async ({ page }) => {
    const { claim } = await seedWorkAndClaim(userId, `touch-${Date.now()}`);
    await login(page);
    await page.goto(`/research/claims/${claim.id}`);
    await expect(main(page).getByRole("heading", { name: "Review" })).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);

    // Open every sub-form so its own buttons/inputs render and get measured
    // too — the audit run on plain page load never sees a form that only
    // mounts once its own toggle is clicked (the reader-popover precedent
    // this pattern follows, `accessibility-sweep.spec.ts`'s own comment).
    await main(page).getByRole("button", { name: "Dispute" }).click();
    await expect(main(page).getByPlaceholder(/Why does this look wrong/)).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
    await main(page).getByRole("button", { name: "Cancel" }).click();

    await main(page).getByRole("button", { name: "History" }).click();
    await expect(main(page).getByRole("button", { name: "Hide history" })).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);

    await main(page).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(main(page).locator("#claim-edit-text")).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
    await main(page).getByRole("button", { name: "Cancel edit" }).click();

    await main(page).getByRole("button", { name: "Reclassify", exact: true }).click();
    await expect(main(page).getByLabel("Claim nature")).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
    await main(page).getByRole("button", { name: "Cancel reclassify" }).click();

    await main(page).getByRole("button", { name: "Split", exact: true }).click();
    await expect(main(page).getByRole("button", { name: "Split claim" })).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
    await main(page).getByRole("button", { name: "Cancel split" }).click();

    await main(page).getByRole("button", { name: "Merge with another claim" }).click();
    await expect(main(page).getByRole("button", { name: "Merge claims" })).toBeVisible();
    expect(await auditTouchTargets(page)).toEqual([]);
  });

  test("hypotheses page's compact correction controls stay dense-exempted from the touch-target audit", async ({ page }) => {
    const fixture = await seedDebateWebFixture(userId, `touch-hyp-${Date.now()}`);
    await login(page);
    await page.goto(`/research/${fixture.projectId}/hypotheses`);
    await expect(main(page).getByRole("heading", { name: "Hypotheses & gaps" })).toBeVisible();
    // Scoped to the two lists the compact review chips actually live in —
    // this page also has an unrelated, pre-existing "Generate hypotheses"
    // button below the 44px floor that is genuinely out of THIS task's
    // scope (D-25-10 named the monitors page, the correction UI, and the
    // Ask Library mode selector, not this button), so a whole-page audit
    // here would assert something this task was never asked to fix.
    expect(await auditTouchTargets(page, '[aria-label="Generated hypotheses"]')).toEqual([]);
    expect(await auditTouchTargets(page, '[aria-label="Research gaps"]')).toEqual([]);
  });

  test("corrections/revisions API and the claim permalink page are 404 while PHASE_25_RESEARCH_ENABLED is off", async ({ page }) => {
    const { claim } = await seedWorkAndClaim(userId, `flagoff-${Date.now()}`);
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

      const postResponse = await page.request.post(`${flagOffBase}/api/research/corrections`, { data: { objectType: "claim", objectId: claim.id, action: "verified" } });
      expect(postResponse.status()).toBe(404);
      const getResponse = await page.request.get(`${flagOffBase}/api/research/revisions?objectType=claim&objectId=${claim.id}`);
      expect(getResponse.status()).toBe(404);

      await page.goto(`${flagOffBase}/research/claims/${claim.id}`);
      await expect(main(page).getByText("That page is not here.")).toBeVisible();
    } finally {
      flagOffServer?.kill("SIGTERM");
    }
  });

  // Every `research_*`/`claim_relationship`/`debate_cluster*`/`evidence_chamber*`
  // row this file inserts directly cascades from `deleteTestUser(EMAIL)` in
  // `afterAll` via its `user_id` FK chain — the `research-hypotheses.spec.ts`/
  // `research-chambers.spec.ts` precedent, applies unchanged here.
});
