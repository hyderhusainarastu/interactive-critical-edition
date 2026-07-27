import type { EmbeddingProvider } from "@ice/ai-adapters";
import { computeConflictWatermark, computeIdempotencyKey } from "@ice/claims";
import type { StructuredCaller } from "@ice/research";
import {
  aiUsageLogs,
  claimRelationships,
  db,
  debateClusterMembers,
  debateClusterRelationships,
  debateClusters,
  researchClaimEmbeddings,
  researchClaims,
  researchGaps,
  researchHypotheses,
  researchHypothesisSources,
  researchHypothesisSupport,
  researchJobRequests,
  researchProjectMembers,
  researchProjects,
  researchRevisions,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { JudgeAnthropicCaller } from "./detectRelationships";
import { HYPOTHESIS_JOB_VERSIONS, generateHypothesesForProject, hypothesisJobScope } from "./generateHypotheses";
import { runResearchJob } from "./jobRunner";

/**
 * Integration tests for the generate_hypotheses pipeline (Phase 27.2): the
 * `[CONFLICT_N]` label-then-validate hypothesis generation over undisputed
 * conflicts, computed (never self-asserted) novelty, and the deterministic
 * $0 research_gap derivation. Skipped when DATABASE_URL is unset, matching
 * every other `*.integration.test.ts` file's convention. Every test injects
 * an explicit mock (or an explicitly UNAVAILABLE one) for both generation
 * providers and the embedder — never the production wrapper's own real
 * clients — so this suite costs exactly $0.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Mocks (the clusterDebates.integration.test.ts / detectRelationships.integration.test.ts precedent).
// ---------------------------------------------------------------------------

class MockOpenAIHypothesisCaller implements StructuredCaller {
  available = true;
  calls = 0;
  constructor(private readonly responder: (callIndex: number) => unknown) {}
  async call<T>(params: { model: string; validate: (parsed: unknown) => T }) {
    const parsed = this.responder(this.calls);
    this.calls += 1;
    const data = params.validate(parsed);
    return { data, promptTokens: 200, completionTokens: 150, model: params.model };
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

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock";
  readonly dim = 1536;
  calls = 0;
  constructor(
    readonly model: string = "text-embedding-3-small",
    readonly available: boolean = true,
    private readonly vector: number[] = new Array(1536).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
  ) {}
  async embedBatch(texts: string[]) {
    this.calls += 1;
    return { vectors: texts.map(() => this.vector), model: this.model, inputTokens: texts.length * 5 };
  }
  estimateCostUsd(): number {
    return 0;
  }
}

class UnavailableEmbeddingProvider implements EmbeddingProvider {
  readonly id = "none";
  readonly model = "none";
  readonly dim = 0;
  readonly available = false;
  async embedBatch(): Promise<never> {
    throw new Error("UnavailableEmbeddingProvider must never be called — check `available` first.");
  }
  estimateCostUsd(): number {
    return 0;
  }
}

/** Wrapped `{hypotheses: [...]}` — the shape the OpenAI structured-output
 *  branch expects (`HYPOTHESIS_OUTPUT_SCHEMA`'s own top-level object
 *  requirement), which every mock in this suite exercises via
 *  `MockOpenAIHypothesisCaller` (a `StructuredCaller`, the openai rung). */
function hypothesisResponse(overrides: Record<string, unknown>[] = []) {
  if (overrides.length > 0) return { hypotheses: overrides };
  return {
    hypotheses: [
      {
        statement: "Practical wisdom mediates between conflicting accounts of virtuous action.",
        rationale: "Both readings converge if virtue is understood as context-sensitive judgment.",
        sourceConflictLabels: ["CONFLICT_1"],
        methodology: "Compare Aristotle's usage of phronesis across both texts.",
        challenges: ["Requires reconciling divergent translations."],
      },
    ],
  };
}

/** A 1536-dim vector (the fixed `research_claim_embedding.embedding` column
 *  width) with a single 1.0 at `index` and zeros elsewhere — cosine
 *  similarity between two such vectors is 1.0 at the same index and 0.0 at
 *  different indices, giving fully controllable distances in tests without
 *  needing a real embedding call. */
function unitVector(index: number): number[] {
  const v = new Array(1536).fill(0);
  v[index] = 1;
  return v;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedUser() {
  const [user] = await db.insert(users).values({ email: `gh-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
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

async function seedJobRequest(userId: string, projectId: string, idempotencyKey?: string) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "generate_hypotheses",
      scope: { projectId },
      idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
      status: "planned",
    })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

async function seedRelationship(
  userId: string,
  projectId: string,
  claimAId: string,
  claimBId: string,
  opts: { valence?: "contradiction" | "support" | "nuance" | "unrelated"; verificationStatus?: string; hidden?: boolean } = {},
) {
  const [claimLoId, claimHiId] = [claimAId, claimBId].sort();
  const [rel] = await db
    .insert(claimRelationships)
    .values({
      userId,
      projectId,
      claimLoId,
      claimHiId,
      valence: opts.valence ?? "contradiction",
      category: "theoretical",
      judgeBranch: "empirical",
      strongerSide: "neither",
      explanation: "Test relationship.",
      resolution: "Test resolution.",
      engagement: "none_detected",
      basisHash: crypto.randomUUID(),
      promptVersion: "test-v1",
      provider: "test",
      model: "test-model",
      hidden: opts.hidden ?? false,
      verificationStatus: (opts.verificationStatus as "unreviewed" | "disputed" | undefined) ?? "unreviewed",
    })
    .returning({ id: claimRelationships.id });
  return rel.id;
}

async function seedClaimEmbedding(claimId: string, model: string, vector: number[]) {
  await db.insert(researchClaimEmbeddings).values({ claimId, model, inputHash: crypto.randomUUID(), embedding: vector, dim: vector.length });
}

async function seedDebateCluster(
  userId: string,
  projectId: string,
  input: { name: string; researchQuestion?: string | null; memberClaimIds: string[]; relationshipIds: string[]; contradictionCount: number },
) {
  const [cluster] = await db
    .insert(debateClusters)
    .values({
      userId,
      projectId,
      name: input.name,
      researchQuestion: input.researchQuestion ?? null,
      memberHash: crypto.randomUUID(),
      edgeCount: input.relationshipIds.length,
      counts: { contradiction: input.contradictionCount, support: 0, nuance: 0 },
      status: "active",
    })
    .returning({ id: debateClusters.id });
  if (input.memberClaimIds.length > 0) {
    await db.insert(debateClusterMembers).values(input.memberClaimIds.map((claimId) => ({ clusterId: cluster.id, claimId })));
  }
  if (input.relationshipIds.length > 0) {
    await db.insert(debateClusterRelationships).values(input.relationshipIds.map((claimRelationshipId) => ({ clusterId: cluster.id, claimRelationshipId })));
  }
  return cluster.id;
}

async function run(
  requestId: string,
  projectId: string,
  question: string | null,
  maxHypotheses: number,
  openai: StructuredCaller,
  anthropic: JudgeAnthropicCaller = new UnavailableAnthropicCaller(),
  embedder: EmbeddingProvider = new UnavailableEmbeddingProvider(),
) {
  let outcome!: Awaited<ReturnType<typeof generateHypothesesForProject>>;
  await runResearchJob(requestId, async (ctx) => {
    outcome = await generateHypothesesForProject(ctx, projectId, question, maxHypotheses, embedder, openai, anthropic);
    return outcome;
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("generate_hypotheses (integration)", () => {
  const cleanupUsers: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("generates a hypothesis grounded in a real conflict and persists source/support/revision rows", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Akrasia involves a failure of knowledge.");
    const claimB = await seedClaim(userId, workB, "Akrasia involves a failure of desire, not knowledge.");
    const projectId = await seedProject(userId, [workA, workB]);
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });

    const openai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, openai);

    expect(outcome.conflictsInScope).toBe(1);
    expect(outcome.hypothesesGenerated).toBe(1);
    expect(outcome.hypothesesDroppedNoRealSource).toBe(0);
    expect(outcome.fabricatedLabelsDropped).toBe(0);
    expect(openai.calls).toBe(1);

    const [hyp] = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    expect(hyp).toBeDefined();
    expect(hyp.grounding).toBe("detected_conflicts");
    expect(hyp.provider).toBe("openai");

    const sources = await db.select().from(researchHypothesisSources).where(eq(researchHypothesisSources.hypothesisId, hyp.id));
    expect(sources.map((s) => s.claimRelationshipId)).toEqual([relId]);

    const support = await db.select().from(researchHypothesisSupport).where(eq(researchHypothesisSupport.hypothesisId, hyp.id));
    expect(support.map((s) => s.workId).sort()).toEqual([workA, workB].sort());
    expect(support.every((s) => s.corpusItemId === null)).toBe(true);

    const revisions = await db.select().from(researchRevisions).where(eq(researchRevisions.researchHypothesisId, hyp.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revision).toBe(0);
    expect(revisions[0].action).toBe("generated");
    expect(revisions[0].editor).toBe("system");
  });

  it("fabricated-label drop: a hypothesis citing a real label alongside a fabricated one keeps only the real source and counts the fabrication", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });

    const openai = new MockOpenAIHypothesisCaller(() =>
      hypothesisResponse([
        {
          statement: "A hypothesis citing one real and one fabricated conflict.",
          rationale: "x",
          sourceConflictLabels: ["CONFLICT_1", "CONFLICT_99"],
          methodology: "y",
          challenges: [],
        },
      ]),
    );
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, openai);

    expect(outcome.hypothesesGenerated).toBe(1);
    expect(outcome.fabricatedLabelsDropped).toBe(1);
    expect(outcome.hypothesesDroppedNoRealSource).toBe(0);

    const [hyp] = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    const sources = await db.select().from(researchHypothesisSources).where(eq(researchHypothesisSources.hypothesisId, hyp.id));
    expect(sources.map((s) => s.claimRelationshipId)).toEqual([relId]);
  });

  it("a hypothesis with ONLY fabricated labels is dropped entirely — never persisted ungrounded", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });

    const openai = new MockOpenAIHypothesisCaller(() =>
      hypothesisResponse([{ statement: "Ungrounded hypothesis.", rationale: "x", sourceConflictLabels: ["CONFLICT_99"], methodology: "y", challenges: [] }]),
    );
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, openai);

    expect(outcome.hypothesesGenerated).toBe(0);
    expect(outcome.hypothesesDroppedNoRealSource).toBe(1);
    expect(outcome.fabricatedLabelsDropped).toBe(1);

    const rows = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    expect(rows).toHaveLength(0);
  });

  it("run_hash repeat: an identical job-level scope makes ZERO new LLM calls on the second run", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });

    const key = computeIdempotencyKey(
      "hypothesis_generation",
      hypothesisJobScope([workA, workB], null, 5, computeConflictWatermark([relId])),
      HYPOTHESIS_JOB_VERSIONS,
    );

    const firstOpenai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const firstRequestId = await seedJobRequest(userId, projectId, key);
    const first = await run(firstRequestId, projectId, null, 5, firstOpenai);
    expect(first.hypothesesGenerated).toBe(1);
    expect(firstOpenai.calls).toBe(1);

    const secondOpenai = new FailingOpenAICaller(); // proves it's never called on the short-circuit path
    const secondRequestId = await seedJobRequest(userId, projectId, key);
    const second = await run(secondRequestId, projectId, null, 5, secondOpenai);

    expect(secondOpenai.calls).toBe(0);
    expect(second.hypothesesGenerated).toBe(0);
    expect(second.coverage).toBe("full");
    expect(second.note).toContain("already fully processed");

    // Still exactly one hypothesis row total, not two.
    const rows = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("a DIFFERENT question produces a different idempotency key, so a real second generation call is made", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });
    const watermark = computeConflictWatermark([relId]);

    const firstOpenai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const firstRequestId = await seedJobRequest(
      userId,
      projectId,
      computeIdempotencyKey("hypothesis_generation", hypothesisJobScope([workA, workB], "Question A", 5, watermark), HYPOTHESIS_JOB_VERSIONS),
    );
    await run(firstRequestId, projectId, "Question A", 5, firstOpenai);
    expect(firstOpenai.calls).toBe(1);

    const secondOpenai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const secondRequestId = await seedJobRequest(
      userId,
      projectId,
      computeIdempotencyKey("hypothesis_generation", hypothesisJobScope([workA, workB], "Question B", 5, watermark), HYPOTHESIS_JOB_VERSIONS),
    );
    const second = await run(secondRequestId, projectId, "Question B", 5, secondOpenai);
    expect(secondOpenai.calls).toBe(1);
    expect(second.hypothesesGenerated).toBe(1);
  });

  it("D-25-15: a completed zero-conflict run must NOT permanently block a later run once real conflicts exist (the owner's reproduced production sequence)", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);

    // --- Run 1: dispatched while the project has ZERO conflicts. ---
    const zeroConflictKey = computeIdempotencyKey(
      "hypothesis_generation",
      hypothesisJobScope([workA, workB], null, 5, computeConflictWatermark([])),
      HYPOTHESIS_JOB_VERSIONS,
    );
    const firstOpenai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const firstRequestId = await seedJobRequest(userId, projectId, zeroConflictKey);
    const first = await run(firstRequestId, projectId, null, 5, firstOpenai);
    expect(first.conflictsInScope).toBe(0);
    expect(first.hypothesesGenerated).toBe(0);
    expect(first.coverage).toBe("full");

    // --- A real contradiction is judged into existence after run 1 completed. ---
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });

    // The watermark (and therefore the idempotency key) for the IDENTICAL
    // workIds/question/maxHypotheses scope must now differ from run 1's —
    // this is the root fix: pre-fix, these two keys were identical because
    // the old key formula never depended on the conflict set at all.
    const oneConflictKey = computeIdempotencyKey(
      "hypothesis_generation",
      hypothesisJobScope([workA, workB], null, 5, computeConflictWatermark([relId])),
      HYPOTHESIS_JOB_VERSIONS,
    );
    expect(oneConflictKey).not.toBe(zeroConflictKey);

    // --- Run 2: re-dispatched with the IDENTICAL scope, now that a real
    // conflict exists — MUST run for real and generate, not reuse run 1's
    // stale "0 conflicts" completion. ---
    const secondOpenai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const secondRequestId = await seedJobRequest(userId, projectId, oneConflictKey);
    const second = await run(secondRequestId, projectId, null, 5, secondOpenai);
    expect(second.conflictsInScope).toBe(1);
    expect(secondOpenai.calls).toBe(1);
    expect(second.hypothesesGenerated).toBe(1);
    expect(second.note).not.toContain("already fully processed");

    // --- Run 3: re-dispatched again with the conflict set UNCHANGED since
    // run 2 — this one legitimately reuses at $0. ---
    const thirdOpenai = new FailingOpenAICaller(); // proves it's never called on the short-circuit path
    const thirdRequestId = await seedJobRequest(userId, projectId, oneConflictKey);
    const third = await run(thirdRequestId, projectId, null, 5, thirdOpenai);
    expect(thirdOpenai.calls).toBe(0);
    expect(third.coverage).toBe("full");
    expect(third.note).toContain("already fully processed");

    // Exactly two hypothesis rows total (run 1 generated none, run 2
    // generated one, run 3 reused — never a third, duplicate row).
    const rows = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    expect(rows).toHaveLength(1);
  });

  it("novelty model-mismatch: embeddings stored under a different model leave the corpus empty for the active model, yielding an 'unknown' tier and no fabricated distance", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });

    // Corpus embeddings exist, but under a STALE model — the active
    // embedder below uses a different one, so `loadClaimEmbeddingsForModel`
    // finds nothing for it.
    await seedClaimEmbedding(claimA.id, "text-embedding-3-large", unitVector(0));
    await seedClaimEmbedding(claimB.id, "text-embedding-3-large", unitVector(1));

    const openai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const embedder = new MockEmbeddingProvider("text-embedding-3-small", true, unitVector(2));
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, openai, new UnavailableAnthropicCaller(), embedder);

    expect(outcome.hypothesesGenerated).toBe(1);
    expect(embedder.calls).toBe(1); // embedding was attempted (the model itself is calibrated)

    const [hyp] = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    expect(hyp.noveltyTier).toBe("unknown");
    expect(hyp.noveltyDistance).toBeNull();
    expect(hyp.noveltyEmbeddingModel).toBe("text-embedding-3-small");
    expect(hyp.noveltyCorpus).toBe("project_claims:0");
  });

  it("novelty computed: a real corpus vector yields a real distance/tier, never self-asserted by the model", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });
    await seedClaimEmbedding(claimA.id, "text-embedding-3-small", unitVector(0));
    await seedClaimEmbedding(claimB.id, "text-embedding-3-small", unitVector(0));

    // The hypothesis's own embedding is orthogonal to the corpus — maximal
    // distance, so it should land in the "high" novelty tier under the
    // provisional thresholds (distance 1.0 > high=0.725).
    const openai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const embedder = new MockEmbeddingProvider("text-embedding-3-small", true, unitVector(1));
    const requestId = await seedJobRequest(userId, projectId);
    await run(requestId, projectId, null, 5, openai, new UnavailableAnthropicCaller(), embedder);

    const [hyp] = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    expect(hyp.noveltyTier).toBe("high");
    expect(hyp.noveltyDistance).toBeGreaterThan(0.9);
    expect(hyp.noveltyEmbeddingModel).toBe("text-embedding-3-small");
    expect(hyp.noveltyCorpus).toBe("project_claims:2");
  });

  it("disputed-relationship exclusion: a disputed conflict is never fed to the hypothesis prompt", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const workC = await seedWork(userId, "Work C");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const claimC = await seedClaim(userId, workC, "Claim C.");
    const projectId = await seedProject(userId, [workA, workB, workC]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction", verificationStatus: "disputed" });
    const undisputedId = await seedRelationship(userId, projectId, claimB.id, claimC.id, { valence: "nuance" });

    const openai = new MockOpenAIHypothesisCaller(() => hypothesisResponse());
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, openai);

    expect(outcome.conflictsInScope).toBe(1);
    const [hyp] = await db.select().from(researchHypotheses).where(eq(researchHypotheses.projectId, projectId));
    const sources = await db.select().from(researchHypothesisSources).where(eq(researchHypothesisSources.hypothesisId, hyp.id));
    expect(sources.map((s) => s.claimRelationshipId)).toEqual([undisputedId]);
  });

  it("zero undisputed conflicts: hypothesis generation is skipped honestly, never fabricated, with zero LLM calls", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction", verificationStatus: "disputed" });

    const openai = new UnavailableOpenAICaller();
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, openai);

    expect(outcome.conflictsInScope).toBe(0);
    expect(outcome.hypothesesGenerated).toBe(0);
    expect(outcome.concerns.some((c) => c.includes("No undisputed contradiction/nuance conflicts"))).toBe(true);
  });

  it("deterministic gap derivation: a cluster with unresolved contradictions produces a templated, $0 research_gap row with no LLM call", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });
    const clusterId = await seedDebateCluster(userId, projectId, {
      name: "Akrasia Debate",
      researchQuestion: "Does the akratic agent know what they are doing?",
      memberClaimIds: [claimA.id, claimB.id],
      relationshipIds: [relId],
      contradictionCount: 1,
    });

    const openai = new UnavailableOpenAICaller(); // no hypothesis generation path exercised here (relationship is disputed below)
    await db.update(claimRelationships).set({ verificationStatus: "disputed" }).where(eq(claimRelationships.id, relId));
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, openai);

    expect(outcome.gapsGenerated).toBe(1);
    expect(outcome.gapsRefreshed).toBe(0);

    const [gap] = await db.select().from(researchGaps).where(eq(researchGaps.debateClusterId, clusterId));
    expect(gap).toBeDefined();
    expect(gap.description).toContain("Akrasia Debate");
    expect(gap.description).toContain("1 unresolved contradiction ");
    expect(gap.description).toContain("Does the akratic agent know what they are doing?");
    expect(gap.unresolvedContradictionCount).toBe(1);

    const revisions = await db.select().from(researchRevisions).where(eq(researchRevisions.researchGapId, gap.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].action).toBe("generated");

    // A repeat run over the SAME cluster refreshes rather than duplicates.
    const requestId2 = await seedJobRequest(userId, projectId);
    const outcome2 = await run(requestId2, projectId, null, 5, new UnavailableOpenAICaller());
    expect(outcome2.gapsGenerated).toBe(0);
    expect(outcome2.gapsRefreshed).toBe(1);
    const gapsAfter = await db.select().from(researchGaps).where(eq(researchGaps.debateClusterId, clusterId));
    expect(gapsAfter).toHaveLength(1);
  });

  it("a cluster with zero contradictions (support/nuance only) never produces a gap", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "nuance" });
    await seedDebateCluster(userId, projectId, {
      name: "Nuance Only",
      memberClaimIds: [claimA.id, claimB.id],
      relationshipIds: [relId],
      contradictionCount: 0,
    });

    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await run(requestId, projectId, null, 5, new UnavailableOpenAICaller());

    expect(outcome.gapsGenerated).toBe(0);
    const gaps = await db.select().from(researchGaps).where(eq(researchGaps.projectId, projectId));
    expect(gaps).toHaveLength(0);
  });

  it("rejects a project the requesting user does not own", async () => {
    const ownerId = await seedUser();
    const otherId = await seedUser();
    cleanupUsers.push(ownerId, otherId);
    const workId = await seedWork(ownerId, "Owner's Work");
    const projectId = await seedProject(ownerId, [workId]);

    const [request] = await db
      .insert(researchJobRequests)
      .values({ userId: otherId, jobType: "generate_hypotheses", scope: { projectId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
      .returning({ id: researchJobRequests.id });

    await expect(run(request.id, projectId, null, 5, new UnavailableOpenAICaller())).rejects.toThrow(/does not belong to the requesting user/);
  });

  it("budget exhausted before the generation call: gap derivation still runs (it is $0) but hypotheses are honestly skipped", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    const relId = await seedRelationship(userId, projectId, claimA.id, claimB.id, { valence: "contradiction" });
    await seedDebateCluster(userId, projectId, { name: "X", memberClaimIds: [claimA.id, claimB.id], relationshipIds: [relId], contradictionCount: 1 });

    const requestId = await seedJobRequest(userId, projectId);
    await db.insert(aiUsageLogs).values({
      researchRequestId: requestId,
      task: "test-seed",
      provider: "test",
      model: "test-model",
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 1,
    });

    const openai = new FailingOpenAICaller(); // throws if ever called — proves the budget check short-circuits BEFORE any provider call
    const outcome = await run(requestId, projectId, null, 5, openai);

    expect(outcome.hypothesesGenerated).toBe(0);
    expect(openai.calls).toBe(0);
    expect(outcome.gapsGenerated).toBe(1);
    expect(outcome.coverage).toBe("partial");
    expect(outcome.concerns.some((c) => c.includes("cost budget reached"))).toBe(true);
  });
});
