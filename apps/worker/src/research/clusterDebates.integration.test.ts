import type { StructuredCaller } from "@ice/research";
import {
  claimRelationships,
  db,
  debateClusterMembers,
  debateClusterRelationships,
  debateClusters,
  researchClaims,
  researchJobRequests,
  researchProjectMembers,
  researchProjects,
  users,
  works,
} from "@ice/db";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { clusterDebatesForProject } from "./clusterDebates";
import type { JudgeAnthropicCaller } from "./detectRelationships";
import { runResearchJob } from "./jobRunner";

/**
 * Integration tests for the cluster_debates pipeline (Phase 26.3): BFS
 * connected components over judged `claim_relationship` edges, named via a
 * mocked LLM call. Skipped when DATABASE_URL is unset, matching every other
 * `*.integration.test.ts` file's convention. Every test injects an explicit
 * mock (or an explicitly UNAVAILABLE one) for both naming providers — never
 * `clusterDebates()`'s own production wrapper, which constructs real
 * clients reading ambient `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` — so this
 * suite costs exactly $0 regardless of what real provider keys happen to be
 * exported in whatever shell runs it (e.g. during a paid canary session
 * elsewhere in this same repo).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Mocks (the detectRelationships.integration.test.ts precedent).
// ---------------------------------------------------------------------------

class MockOpenAINamingCaller implements StructuredCaller {
  available = true;
  calls = 0;
  constructor(private readonly responder: (callIndex: number) => unknown) {}
  async call<T>(params: { model: string; validate: (parsed: unknown) => T }) {
    const parsed = this.responder(this.calls);
    this.calls += 1;
    const data = params.validate(parsed);
    return { data, promptTokens: 60, completionTokens: 30, model: params.model };
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

function namingResponse(overrides: Record<string, unknown> = {}) {
  return {
    name: "Akrasia and Practical Knowledge",
    researchQuestion: "Does the akratic agent know what they are doing?",
    description: "Two readings of NE 7 disagree on whether akrasia involves ignorance.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedUser() {
  const [user] = await db.insert(users).values({ email: `cd-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
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

async function seedJobRequest(userId: string, projectId: string) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({ userId, jobType: "cluster_debates", scope: { projectId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

/** Directly seeds an ALREADY-JUDGED relationship — this suite tests
 *  clustering over pre-existing edges, not the judge stage itself (that's
 *  `detectRelationships.integration.test.ts`'s job). */
async function seedRelationship(
  userId: string,
  projectId: string,
  claimAId: string,
  claimBId: string,
  valence: "contradiction" | "support" | "nuance" | "unrelated" = "contradiction",
  opts: { hidden?: boolean } = {},
) {
  const [claimLoId, claimHiId] = [claimAId, claimBId].sort();
  await db.insert(claimRelationships).values({
    userId,
    projectId,
    claimLoId,
    claimHiId,
    valence,
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
    hidden: opts.hidden ?? false,
  });
}

async function runCluster(requestId: string, projectId: string, openai: StructuredCaller, anthropic: JudgeAnthropicCaller = new UnavailableAnthropicCaller()) {
  let outcome!: Awaited<ReturnType<typeof clusterDebatesForProject>>;
  await runResearchJob(requestId, async (ctx) => {
    outcome = await clusterDebatesForProject(ctx, projectId, openai, anthropic);
    return outcome;
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("cluster_debates (integration)", () => {
  const cleanupUsers: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("clusters two connected claims and names the cluster via the LLM", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Akrasia involves a failure of knowledge.");
    const claimB = await seedClaim(userId, workB, "Akrasia involves a failure of desire, not knowledge.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, "contradiction");

    const openai = new MockOpenAINamingCaller(() => namingResponse());
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runCluster(requestId, projectId, openai);

    expect(outcome.clustersFound).toBe(1);
    expect(outcome.clustersNamed).toBe(1);
    expect(outcome.clustersSkippedNaming).toBe(0);
    expect(outcome.clustersFallbackNamed).toBe(0);
    expect(openai.calls).toBe(1);

    const [cluster] = await db.select().from(debateClusters).where(eq(debateClusters.projectId, projectId));
    expect(cluster).toBeDefined();
    expect(cluster.name).toBe("Akrasia and Practical Knowledge");
    expect(cluster.status).toBe("active");
    expect(cluster.provider).toBe("openai");
    expect(cluster.edgeCount).toBe(1);
    expect(cluster.counts).toMatchObject({ contradiction: 1 });

    const members = await db.select().from(debateClusterMembers).where(eq(debateClusterMembers.clusterId, cluster.id));
    expect(members).toHaveLength(2);
    const relEdges = await db.select().from(debateClusterRelationships).where(eq(debateClusterRelationships.clusterId, cluster.id));
    expect(relEdges).toHaveLength(1);
  });

  it("unrelated edges never form a cluster (BFS excludes them)", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, "unrelated");

    const openai = new MockOpenAINamingCaller(() => namingResponse());
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runCluster(requestId, projectId, openai);

    expect(outcome.clustersFound).toBe(0);
    expect(openai.calls).toBe(0);
    const clusters = await db.select().from(debateClusters).where(eq(debateClusters.projectId, projectId));
    expect(clusters).toHaveLength(0);
  });

  it("member_hash naming skip: a repeat run over an UNCHANGED relationship set makes zero new naming calls", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, "nuance");

    const firstOpenai = new MockOpenAINamingCaller(() => namingResponse());
    const firstRequestId = await seedJobRequest(userId, projectId);
    const first = await runCluster(firstRequestId, projectId, firstOpenai);
    expect(first.clustersNamed).toBe(1);

    const secondOpenai = new FailingOpenAICaller(); // proves it's never called for an unchanged membership
    const secondRequestId = await seedJobRequest(userId, projectId);
    const second = await runCluster(secondRequestId, projectId, secondOpenai);

    expect(second.clustersNamed).toBe(0);
    expect(second.clustersSkippedNaming).toBe(1);
    expect(secondOpenai.calls).toBe(0);

    const clusters = await db.select().from(debateClusters).where(eq(debateClusters.projectId, projectId));
    expect(clusters).toHaveLength(1); // exactly one row total, not two
  });

  it("stale-cluster transition: membership shrinking marks the old cluster stale and creates a new one for the smaller component", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const workC = await seedWork(userId, "Work C");
    const claimA = await seedClaim(userId, workA, "Claim A.");
    const claimB = await seedClaim(userId, workB, "Claim B.");
    const claimC = await seedClaim(userId, workC, "Claim C.");
    const projectId = await seedProject(userId, [workA, workB, workC]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, "contradiction");
    await seedRelationship(userId, projectId, claimB.id, claimC.id, "nuance");

    const firstOpenai = new MockOpenAINamingCaller(() => namingResponse({ name: "Three-Way Debate" }));
    const firstRequestId = await seedJobRequest(userId, projectId);
    const first = await runCluster(firstRequestId, projectId, firstOpenai);
    expect(first.clustersFound).toBe(1); // one component: {A, B, C}

    const [originalCluster] = await db.select().from(debateClusters).where(eq(debateClusters.projectId, projectId));
    expect(originalCluster.status).toBe("active");

    // Hide the B-C edge — the BFS component shrinks to just {A, B}, a
    // DIFFERENT member_hash, so the original {A,B,C} row must go stale.
    await db
      .update(claimRelationships)
      .set({ hidden: true })
      .where(and(eq(claimRelationships.userId, userId), eq(claimRelationships.projectId, projectId), eq(claimRelationships.valence, "nuance")));

    const secondOpenai = new MockOpenAINamingCaller(() => namingResponse({ name: "Two-Way Debate" }));
    const secondRequestId = await seedJobRequest(userId, projectId);
    const second = await runCluster(secondRequestId, projectId, secondOpenai);

    expect(second.clustersFound).toBe(1); // one component now: {A, B}
    expect(second.clustersMarkedStale).toBe(1);

    const allClusters = await db.select().from(debateClusters).where(eq(debateClusters.projectId, projectId));
    expect(allClusters).toHaveLength(2); // the old row survives (stale), the new one is additive
    const original = allClusters.find((c) => c.id === originalCluster.id)!;
    expect(original.status).toBe("stale");
    const fresh = allClusters.find((c) => c.id !== originalCluster.id)!;
    expect(fresh.status).toBe("active");
    expect(fresh.name).toBe("Two-Way Debate");

    const freshMembers = await db.select().from(debateClusterMembers).where(eq(debateClusterMembers.clusterId, fresh.id));
    expect(freshMembers.map((m) => m.claimId).sort()).toEqual([claimA.id, claimB.id].sort());
  });

  it("fallback naming: a new cluster is still created with a deterministic name when both naming providers fail", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const workA = await seedWork(userId, "Work A");
    const workB = await seedWork(userId, "Work B");
    const claimA = await seedClaim(userId, workA, "The virtuous agent acts from settled character, not calculation.");
    const claimB = await seedClaim(userId, workB, "Virtue requires deliberate calculation in the moment of action.");
    const projectId = await seedProject(userId, [workA, workB]);
    await seedRelationship(userId, projectId, claimA.id, claimB.id, "contradiction");

    const openai = new FailingOpenAICaller();
    const requestId = await seedJobRequest(userId, projectId);
    const outcome = await runCluster(requestId, projectId, openai, new UnavailableAnthropicCaller());

    expect(outcome.clustersFound).toBe(1);
    expect(outcome.clustersNamed).toBe(0);
    expect(outcome.clustersFallbackNamed).toBe(1);
    expect(outcome.coverage).toBe("partial");

    const [cluster] = await db.select().from(debateClusters).where(eq(debateClusters.projectId, projectId));
    expect(cluster.status).toBe("active"); // still created and active, just plainly named
    expect(cluster.name).toMatch(/^Debate: /);
    expect(cluster.promptVersion).toBeNull();
    expect(cluster.provider).toBeNull();
    expect(cluster.model).toBeNull();
  });

  it("rejects a project the requesting user does not own", async () => {
    const ownerId = await seedUser();
    const otherId = await seedUser();
    cleanupUsers.push(ownerId, otherId);
    const workId = await seedWork(ownerId, "Owner's Work");
    const projectId = await seedProject(ownerId, [workId]);

    const [request] = await db
      .insert(researchJobRequests)
      .values({ userId: otherId, jobType: "cluster_debates", scope: { projectId }, idempotencyKey: crypto.randomUUID(), status: "planned" })
      .returning({ id: researchJobRequests.id });

    await expect(runCluster(request.id, projectId, new UnavailableOpenAICaller())).rejects.toThrow(/does not belong to the requesting user/);
  });
});
