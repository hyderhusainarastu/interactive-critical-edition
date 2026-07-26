import type { StructuredCaller } from "@ice/research";
import {
  aiUsageLogs,
  db,
  debateClusterMembers,
  debateClusters,
  evidenceChamberPositionClaims,
  evidenceChamberPositions,
  evidenceChambers,
  researchClaims,
  researchJobRequests,
  researchProjectMembers,
  researchProjects,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { JudgeAnthropicCaller } from "./detectRelationships";
import { runResearchJob } from "./jobRunner";
import * as repo from "./repository";
import { synthesizeChamberForCluster } from "./synthesizeChamber";

/**
 * Integration tests for the synthesize_chamber pipeline (Phase 27.1):
 * Evidence Chamber synthesis over a debate cluster's claims, via a mocked
 * LLM call. Skipped when DATABASE_URL is unset, matching every other
 * `*.integration.test.ts` file's convention. Every test injects an explicit
 * mock (or an explicitly UNAVAILABLE one) for both synthesis providers —
 * never `synthesizeChamber()`'s own production wrapper, which constructs
 * real clients reading ambient `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` — so
 * this suite costs exactly $0 regardless of what real provider keys happen
 * to be exported in whatever shell runs it.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Mocks (the clusterDebates.integration.test.ts / detectRelationships.integration.test.ts precedent).
// ---------------------------------------------------------------------------

class MockOpenAIChamberCaller implements StructuredCaller {
  available = true;
  calls = 0;
  constructor(private readonly responder: (callIndex: number) => unknown) {}
  async call<T>(params: { model: string; validate: (parsed: unknown) => T }) {
    const parsed = this.responder(this.calls);
    this.calls += 1;
    const data = params.validate(parsed);
    return { data, promptTokens: 400, completionTokens: 250, model: params.model };
  }
}

class UnavailableOpenAICaller implements StructuredCaller {
  available = false;
  calls = 0;
  async call(): Promise<never> {
    this.calls += 1;
    throw new Error("UnavailableOpenAICaller must never be called — check `available` first.");
  }
}

class FailingOpenAICaller implements StructuredCaller {
  available = true;
  calls = 0;
  async call(): Promise<never> {
    this.calls += 1;
    throw new Error("simulated OpenAI failure");
  }
}

class UnavailableAnthropicCaller implements JudgeAnthropicCaller {
  available = false;
  calls = 0;
  async call(): Promise<never> {
    this.calls += 1;
    throw new Error("UnavailableAnthropicCaller must never be called — check `available` first.");
  }
}

class FailingAnthropicCaller implements JudgeAnthropicCaller {
  available = true;
  calls = 0;
  async call(params: { model: string }) {
    this.calls += 1;
    return { ok: false as const, error: "simulated anthropic failure", model: params.model, promptTokens: 10, completionTokens: 0 };
  }
}

function chamberResponse(overrides: Record<string, unknown> = {}) {
  return {
    question: "Does akrasia involve a failure of knowledge or a failure of will?",
    sharedGround: "Both agree the akratic agent acts against their better judgment.",
    pointOfDivergence: "Irwin locates the failure in incomplete practical reasoning; Davidson in weakness of will.",
    possibleReconciliation: "The two accounts may describe different stages of the same process.",
    unresolvedQuestion: "Whether the practical syllogism model can be tested independently of the reading itself.",
    missingEvidence: "A shared criterion for what counts as 'complete' practical reasoning.",
    nextAction: "Compare both readings against NE 7.3's own text directly.",
    positions: [
      { label: "Work A", summary: "Incomplete syllogism.", method: "textual", scope: "NE 7.3", stanceConfidence: "high" },
      { label: "Work B", summary: "Weakness of will.", method: "philosophical", scope: "general akrasia", stanceConfidence: "medium" },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedUser() {
  const [user] = await db.insert(users).values({ email: `sc-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  return user.id;
}

async function seedWork(userId: string, title: string) {
  const [work] = await db.insert(works).values({ userId, title, authorName: "Test Author" }).returning({ id: works.id });
  return work.id;
}

async function seedClaim(userId: string, workId: string, claimText: string) {
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
      supportingExcerpt: claimText.slice(0, Math.min(20, claimText.length)) || "x",
      excerptVerified: false,
      contentHash: crypto.randomUUID(),
      promptVersion: "test-v1",
    })
    .returning({ id: researchClaims.id, claimText: researchClaims.claimText });
  return claim;
}

async function seedProject(userId: string, workIds: string[]) {
  const [project] = await db.insert(researchProjects).values({ userId, title: "Test Research Project" }).returning({ id: researchProjects.id });
  for (const workId of workIds) {
    await db.insert(researchProjectMembers).values({ projectId: project.id, memberType: "work", workId, role: "central" });
  }
  return project.id;
}

async function seedCluster(userId: string, projectId: string, claimIds: string[], name = "Akrasia Debate") {
  const [cluster] = await db
    .insert(debateClusters)
    .values({ userId, projectId, name, memberHash: crypto.randomUUID(), edgeCount: claimIds.length - 1, counts: {} })
    .returning({ id: debateClusters.id });
  for (const claimId of claimIds) {
    await db.insert(debateClusterMembers).values({ clusterId: cluster.id, claimId });
  }
  return cluster.id;
}

async function seedJobRequest(userId: string, projectId: string, clusterId: string) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({ userId, jobType: "synthesize_chamber", scope: { projectId, clusterId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

async function runChamber(requestId: string, clusterId: string, openai: StructuredCaller, anthropic: JudgeAnthropicCaller = new UnavailableAnthropicCaller()) {
  let outcome!: Awaited<ReturnType<typeof synthesizeChamberForCluster>>;
  await runResearchJob(requestId, async (ctx) => {
    outcome = await synthesizeChamberForCluster(ctx, clusterId, openai, anthropic);
    return outcome;
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("synthesize_chamber (integration)", () => {
  const cleanupUsers: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("synthesizes a chamber, matches positions to claims by work title, and persists everything transactionally", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Akrasia involves a failure of knowledge.");
    const claimB = await seedClaim(userId, workB, "Akrasia involves a failure of desire, not knowledge.");
    const projectId = await seedProject(userId, [workA, workB]);
    const clusterId = await seedCluster(userId, projectId, [claimA.id, claimB.id]);

    const openai = new MockOpenAIChamberCaller(() => chamberResponse());
    const requestId = await seedJobRequest(userId, projectId, clusterId);
    const outcome = await runChamber(requestId, clusterId, openai);

    expect(outcome.synthesized).toBe(true);
    expect(outcome.reused).toBe(false);
    expect(outcome.coverage).toBe("full");
    expect(openai.calls).toBe(1);

    const [chamber] = await db.select().from(evidenceChambers).where(eq(evidenceChambers.clusterId, clusterId));
    expect(chamber).toBeDefined();
    expect(chamber.provider).toBe("openai");
    expect(chamber.question).toBe("Does akrasia involve a failure of knowledge or a failure of will?");

    const positions = await db
      .select()
      .from(evidenceChamberPositions)
      .where(eq(evidenceChamberPositions.chamberId, chamber.id))
      .orderBy(evidenceChamberPositions.ordinal);
    expect(positions).toHaveLength(2);
    expect(positions[0].label).toBe("Work A");
    expect(positions[0].ordinal).toBe(0);
    expect(positions[0].stanceConfidenceLabel).toBe("high");
    expect(positions[0].stanceConfidence).toBeCloseTo(0.9);
    expect(positions[1].stanceConfidenceLabel).toBe("medium");
    expect(positions[1].stanceConfidence).toBeCloseTo(0.6);

    const position0Claims = await db.select().from(evidenceChamberPositionClaims).where(eq(evidenceChamberPositionClaims.positionId, positions[0].id));
    expect(position0Claims).toHaveLength(1);
    expect(position0Claims[0].claimId).toBe(claimA.id);
    expect(position0Claims[0].excerpt.length).toBeGreaterThan(0);

    const position1Claims = await db.select().from(evidenceChamberPositionClaims).where(eq(evidenceChamberPositionClaims.positionId, positions[1].id));
    expect(position1Claims).toHaveLength(1);
    expect(position1Claims[0].claimId).toBe(claimB.id);

    // No winner-ish content anywhere in the stored text fields.
    const forbidden = /winner|verdict|stronger|prevail|rank/i;
    for (const field of [chamber.question, chamber.sharedGround, chamber.pointOfDivergence, chamber.possibleReconciliation, chamber.unresolvedQuestion, chamber.missingEvidence, chamber.nextAction]) {
      expect(field).not.toMatch(forbidden);
    }
  });

  it("basis_hash idempotency: a repeat run over an UNCHANGED cluster makes zero new synthesis calls and inserts zero new rows", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A text.");
    const claimB = await seedClaim(userId, workB, "Claim B text.");
    const projectId = await seedProject(userId, [workA, workB]);
    const clusterId = await seedCluster(userId, projectId, [claimA.id, claimB.id]);

    const firstOpenai = new MockOpenAIChamberCaller(() => chamberResponse());
    const firstRequestId = await seedJobRequest(userId, projectId, clusterId);
    const first = await runChamber(firstRequestId, clusterId, firstOpenai);
    expect(first.synthesized).toBe(true);

    const secondOpenai = new FailingOpenAICaller(); // proves it's never called for an unchanged basis hash
    const secondRequestId = await seedJobRequest(userId, projectId, clusterId);
    const second = await runChamber(secondRequestId, clusterId, secondOpenai);

    expect(second.reused).toBe(true);
    expect(second.synthesized).toBe(false);
    expect(secondOpenai.calls).toBe(0);

    const chambers = await db.select().from(evidenceChambers).where(eq(evidenceChambers.clusterId, clusterId));
    expect(chambers).toHaveLength(1); // exactly one row total, not two

    // Zero new ai_usage_log rows attributed to the second (reused) request.
    const usageRows = await db.select().from(aiUsageLogs).where(eq(aiUsageLogs.researchRequestId, secondRequestId));
    expect(usageRows).toHaveLength(0);
  });

  it("a claim edit changes the basis hash and legitimately re-synthesizes", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Original claim text.");
    const claimB = await seedClaim(userId, workB, "Other claim text.");
    const projectId = await seedProject(userId, [workA, workB]);
    const clusterId = await seedCluster(userId, projectId, [claimA.id, claimB.id]);

    const firstOpenai = new MockOpenAIChamberCaller(() => chamberResponse());
    const firstRequestId = await seedJobRequest(userId, projectId, clusterId);
    await runChamber(firstRequestId, clusterId, firstOpenai);

    await db.update(researchClaims).set({ claimText: "Edited claim text — meaningfully different." }).where(eq(researchClaims.id, claimA.id));

    const secondOpenai = new MockOpenAIChamberCaller(() => chamberResponse({ question: "A revised question." }));
    const secondRequestId = await seedJobRequest(userId, projectId, clusterId);
    const second = await runChamber(secondRequestId, clusterId, secondOpenai);

    expect(second.synthesized).toBe(true);
    expect(secondOpenai.calls).toBe(1);

    const chambers = await db.select().from(evidenceChambers).where(eq(evidenceChambers.clusterId, clusterId));
    expect(chambers).toHaveLength(2); // both rows survive — never deleted
  });

  it("never fabricates: when both providers fail, no chamber is persisted", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A text.");
    const claimB = await seedClaim(userId, workB, "Claim B text.");
    const projectId = await seedProject(userId, [workA, workB]);
    const clusterId = await seedCluster(userId, projectId, [claimA.id, claimB.id]);

    const openai = new FailingOpenAICaller();
    const anthropic = new FailingAnthropicCaller();
    const requestId = await seedJobRequest(userId, projectId, clusterId);
    const outcome = await runChamber(requestId, clusterId, openai, anthropic);

    expect(outcome.synthesized).toBe(false);
    expect(outcome.coverage).toBe("partial");
    expect(outcome.concerns.some((c) => c.includes("never fabricated"))).toBe(true);

    const chambers = await db.select().from(evidenceChambers).where(eq(evidenceChambers.clusterId, clusterId));
    expect(chambers).toHaveLength(0);
  });

  it("never fabricates: an unmatchable position (label shares no words with any claim's work) is discarded, not guessed", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Nicomachean Ethics");
    const workB = await seedWork(userId, "Eudemian Ethics");
    const claimA = await seedClaim(userId, workA, "Claim A text.");
    const claimB = await seedClaim(userId, workB, "Claim B text.");
    const projectId = await seedProject(userId, [workA, workB]);
    const clusterId = await seedCluster(userId, projectId, [claimA.id, claimB.id]);

    const openai = new MockOpenAIChamberCaller(() =>
      chamberResponse({
        positions: [
          { label: "Zzyzx Nonexistent Treatise", summary: "s", method: "m", scope: "sc", stanceConfidence: "high" },
        ],
      }),
    );
    const requestId = await seedJobRequest(userId, projectId, clusterId);
    const outcome = await runChamber(requestId, clusterId, openai);

    expect(outcome.synthesized).toBe(false);
    expect(outcome.coverage).toBe("partial");
    expect(outcome.concerns.some((c) => c.includes("could not be confidently matched"))).toBe(true);

    const chambers = await db.select().from(evidenceChambers).where(eq(evidenceChambers.clusterId, clusterId));
    expect(chambers).toHaveLength(0);
  });

  it("transaction rollback: insertEvidenceChamber refuses (and writes nothing) when a position carries zero claims", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const claimA = await seedClaim(userId, workA, "Claim A text.");
    const projectId = await seedProject(userId, [workA]);
    const clusterId = await seedCluster(userId, projectId, [claimA.id]);

    await expect(
      repo.insertEvidenceChamber(userId, projectId, {
        clusterId,
        question: "q",
        sharedGround: "sg",
        pointOfDivergence: "pod",
        possibleReconciliation: "pr",
        unresolvedQuestion: "uq",
        missingEvidence: "me",
        nextAction: "na",
        basisHash: crypto.randomUUID(),
        promptVersion: "test-v1",
        provider: "test",
        model: "test-model",
        positions: [
          { ordinal: 0, label: "Work A", summary: "s", method: "m", scope: "sc", stanceConfidenceLabel: "high", stanceConfidence: 0.9, claims: [{ claimId: claimA.id, excerpt: "x" }] },
          { ordinal: 1, label: "Ungrounded", summary: "s", method: "m", scope: "sc", stanceConfidenceLabel: "low", stanceConfidence: 0.3, claims: [] },
        ],
      }),
    ).rejects.toThrow(/zero grounding claims/);

    // Nothing partial was left behind — the whole transaction rolled back.
    // Since `evidence_chamber_position.chamber_id` FKs to `evidence_chamber`,
    // proving no chamber row exists for this cluster is sufficient to prove
    // no orphaned position row exists for it either.
    const chambers = await db.select().from(evidenceChambers).where(eq(evidenceChambers.clusterId, clusterId));
    expect(chambers).toHaveLength(0);
  });

  it("rejects a cluster the requesting user does not own", async () => {
    const ownerId = await seedUser();
    const otherId = await seedUser();
    cleanupUsers.push(ownerId, otherId);
    const workId = await seedWork(ownerId, "Owner's Work");
    const claim = await seedClaim(ownerId, workId, "Claim text.");
    const projectId = await seedProject(ownerId, [workId]);
    const clusterId = await seedCluster(ownerId, projectId, [claim.id]);

    const [request] = await db
      .insert(researchJobRequests)
      .values({ userId: otherId, jobType: "synthesize_chamber", scope: { projectId, clusterId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
      .returning({ id: researchJobRequests.id });

    await expect(runChamber(request.id, clusterId, new UnavailableOpenAICaller())).rejects.toThrow(/does not belong to the requesting user/);
  });
});
