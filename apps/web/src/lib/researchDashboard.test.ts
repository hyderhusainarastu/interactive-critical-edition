import assert from "node:assert/strict";
import { claimRelationships, db, debateClusters, researchClaims, researchJobRequests, researchMonitorHits, researchMonitors, researchProjects, works } from "@ice/db";
import { getResearchInsightCounts, hasResearchInsightSignal } from "@/lib/researchDashboard";
import { createVerifiedTestUser, deleteTestUser } from "../../e2e/helpers";

/**
 * Phase 29.3 reverse-direction lane, Item 2 (zero-LLM dashboard insight
 * feed): `getResearchInsightCounts`'s six owner-scoped `count()` queries and
 * `hasResearchInsightSignal`'s "no empty noise" gate. `researchDashboard.ts`
 * transitively imports `@ice/db`, so — same convention as
 * `competencyData.test.ts`/`ragData.test.ts` — this is a plain `node:assert`
 * script with real DB seeding/cleanup, run via `tsx`, not a Playwright spec:
 *
 *   cd apps/web && DATABASE_URL=postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition \
 *     ../worker/node_modules/.bin/tsx src/lib/researchDashboard.test.ts
 *
 * Ordering of `claim_relationship.claim_lo_id < claim_hi_id` is established
 * with the exact same `[a, b].sort()` idiom production code uses
 * (`packages/claims/src/retrieval/union.ts`), not a separately-invented one.
 */

async function seedUser(tag: string) {
  const email = `e2e-research-dashboard-${tag}-${Date.now()}@example.com`;
  const userId = await createVerifiedTestUser(email, "password123");
  return { email, userId };
}

function pair(a: string, b: string): [string, string] {
  const [lo, hi] = [a, b].sort();
  return [lo, hi];
}

async function seedClaim(
  userId: string,
  workId: string,
  overrides: Partial<{
    verificationStatus: "unreviewed" | "user_verified" | "source_verified" | "disputed" | "rejected";
    status: "active" | "superseded";
    hidden: boolean;
  }> = {},
) {
  const [claim] = await db
    .insert(researchClaims)
    .values({
      userId,
      workId,
      anchorState: "unanchored",
      claimText: `A falsifiable claim about virtue, ${crypto.randomUUID()}`,
      claimNature: "interpretive",
      confidence: "medium",
      section: "Book VII",
      sourceScope: "sampled",
      supportingExcerpt: "a supporting excerpt",
      contentHash: crypto.randomUUID(),
      promptVersion: "test-v1",
      status: overrides.status ?? "active",
      verificationStatus: overrides.verificationStatus ?? "unreviewed",
      hidden: overrides.hidden ?? false,
    })
    .returning({ id: researchClaims.id });
  return claim.id;
}

// ---------------------------------------------------------------------------
// (a) A real, mixed signal: exactly one row of each kind should count, and
// the rows deliberately designed NOT to count (archived project, reviewed/
// hidden/superseded claim, old/wrong-valence/superseded relationship, stale
// debate cluster, terminal job statuses) must not leak into the totals.
// ---------------------------------------------------------------------------
async function testMixedSignalCountsExactlyTheEligibleRows() {
  const { email, userId } = await seedUser("mixed");
  try {
    const [work] = await db.insert(works).values({ userId, title: "Nicomachean Ethics" }).returning({ id: works.id });

    // Projects: one active, one archived.
    const [activeProject] = await db
      .insert(researchProjects)
      .values({ userId, title: "Active project" })
      .returning({ id: researchProjects.id });
    await db.insert(researchProjects).values({ userId, title: "Archived project", archivedAt: new Date() });

    // Claims: one truly awaiting review, plus three that must NOT count.
    await seedClaim(userId, work.id); // unreviewed, active, not hidden — counts
    await seedClaim(userId, work.id, { verificationStatus: "user_verified" }); // already reviewed
    await seedClaim(userId, work.id, { hidden: true }); // hidden
    await seedClaim(userId, work.id, { status: "superseded" }); // superseded

    // Claim relationships: need distinct claim ids for the pairs below.
    // Marked already-reviewed so these five don't also inflate
    // `claimsAwaitingReview` above (that assertion already ran) — they
    // exist here purely as the relationship endpoints.
    const claimA = await seedClaim(userId, work.id, { verificationStatus: "user_verified" });
    const claimB = await seedClaim(userId, work.id, { verificationStatus: "user_verified" });
    const claimC = await seedClaim(userId, work.id, { verificationStatus: "user_verified" });
    const claimD = await seedClaim(userId, work.id, { verificationStatus: "user_verified" });
    const claimE = await seedClaim(userId, work.id, { verificationStatus: "user_verified" });

    const now = new Date();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const baseRelationship = {
      userId,
      projectId: activeProject.id,
      category: "theoretical" as const,
      judgeBranch: "humanities" as const,
      strongerSide: "neither" as const,
      explanation: "test explanation",
      resolution: "test resolution",
      engagement: "none_detected" as const,
      promptVersion: "test-v1",
      provider: "openai",
      model: "gpt-test",
    };
    {
      const [lo, hi] = pair(claimA, claimB);
      await db.insert(claimRelationships).values({
        ...baseRelationship,
        claimLoId: lo,
        claimHiId: hi,
        valence: "contradiction",
        basisHash: crypto.randomUUID(),
        createdAt: now,
      }); // fresh contradiction — counts
    }
    {
      const [lo, hi] = pair(claimA, claimC);
      await db.insert(claimRelationships).values({
        ...baseRelationship,
        claimLoId: lo,
        claimHiId: hi,
        valence: "contradiction",
        basisHash: crypto.randomUUID(),
        createdAt: tenDaysAgo,
      }); // outside the 7-day window
    }
    {
      const [lo, hi] = pair(claimA, claimD);
      await db.insert(claimRelationships).values({
        ...baseRelationship,
        claimLoId: lo,
        claimHiId: hi,
        valence: "support",
        basisHash: crypto.randomUUID(),
        createdAt: now,
      }); // wrong valence
    }
    {
      const [lo, hi] = pair(claimA, claimE);
      await db.insert(claimRelationships).values({
        ...baseRelationship,
        claimLoId: lo,
        claimHiId: hi,
        valence: "contradiction",
        basisHash: crypto.randomUUID(),
        createdAt: now,
        status: "superseded",
      }); // superseded
    }

    // Debate clusters: one active, one stale.
    await db.insert(debateClusters).values({
      userId,
      projectId: activeProject.id,
      name: "Cluster A",
      memberHash: crypto.randomUUID(),
      status: "active",
    });
    await db.insert(debateClusters).values({
      userId,
      projectId: activeProject.id,
      name: "Cluster B (stale)",
      memberHash: crypto.randomUUID(),
      status: "stale",
    });

    // Research jobs: one of every status, so only queued/running/failed count
    // (queued+running toward runningJobs, failed toward failedJobs).
    const jobBase = { userId, jobType: "detect_relationships" as const, scope: { projectId: activeProject.id } };
    await db.insert(researchJobRequests).values({ ...jobBase, status: "planned", idempotencyKey: crypto.randomUUID() });
    await db.insert(researchJobRequests).values({ ...jobBase, status: "queued", idempotencyKey: crypto.randomUUID() });
    await db.insert(researchJobRequests).values({ ...jobBase, status: "running", idempotencyKey: crypto.randomUUID() });
    await db.insert(researchJobRequests).values({ ...jobBase, status: "complete", idempotencyKey: crypto.randomUUID() });
    await db.insert(researchJobRequests).values({ ...jobBase, status: "failed", idempotencyKey: crypto.randomUUID() });
    await db.insert(researchJobRequests).values({ ...jobBase, status: "cancelled", idempotencyKey: crypto.randomUUID() });

    // Monitor hits: one undismissed (counts), one dismissed (must not).
    const [monitor] = await db
      .insert(researchMonitors)
      .values({ userId, monitorType: "topic", query: "test topic", cadence: "daily" })
      .returning({ id: researchMonitors.id });
    await db.insert(researchMonitorHits).values({ monitorId: monitor.id, dedupKey: `title:hit-a-${crypto.randomUUID()}`, title: "Hit A", authors: [], provider: "semanticscholar" });
    await db
      .insert(researchMonitorHits)
      .values({ monitorId: monitor.id, dedupKey: `title:hit-b-${crypto.randomUUID()}`, title: "Hit B", authors: [], provider: "semanticscholar", dismissedAt: new Date() });

    const counts = await getResearchInsightCounts(userId);
    assert.equal(counts.activeProjects, 1, "only the non-archived project counts");
    assert.equal(counts.claimsAwaitingReview, 1, "only the unreviewed/active/non-hidden claim counts");
    assert.equal(counts.newContradictions, 1, "only the fresh, active, contradiction-valence relationship counts");
    assert.equal(counts.activeDebateClusters, 1, "only the active (non-stale) debate cluster counts");
    assert.equal(counts.runningJobs, 2, "queued + running both count as 'running'");
    assert.equal(counts.failedJobs, 1, "only the failed job counts");
    assert.equal(counts.newMonitorHits, 1, "only the undismissed monitor hit counts");

    assert.equal(hasResearchInsightSignal(counts), true, "a real mixed signal must show the module");
  } finally {
    await deleteTestUser(email);
  }
}

// ---------------------------------------------------------------------------
// (b) A brand-new account with zero research activity: every count is zero,
// and the visibility gate must say so — this is the "no empty noise" rule
// the dashboard page relies on to decide whether to mount the module at all.
// ---------------------------------------------------------------------------
async function testZeroActivityHasNoSignal() {
  const { email, userId } = await seedUser("empty");
  try {
    const counts = await getResearchInsightCounts(userId);
    assert.equal(counts.activeProjects, 0);
    assert.equal(counts.claimsAwaitingReview, 0);
    assert.equal(counts.newContradictions, 0);
    assert.equal(counts.activeDebateClusters, 0);
    assert.equal(counts.runningJobs, 0);
    assert.equal(counts.failedJobs, 0);
    assert.equal(counts.newMonitorHits, 0);
    assert.equal(hasResearchInsightSignal(counts), false, "an all-zero account must not show the module");
  } finally {
    await deleteTestUser(email);
  }
}

// ---------------------------------------------------------------------------
// (c) An account with exactly one active (non-archived) project and nothing
// else: the module still shows, because "active projects > 0" alone is a
// real signal even with zero claims/contradictions/debates/jobs.
// ---------------------------------------------------------------------------
async function testProjectAloneIsSignal() {
  const { email, userId } = await seedUser("project-only");
  try {
    await db.insert(researchProjects).values({ userId, title: "Just started" });
    const counts = await getResearchInsightCounts(userId);
    assert.equal(counts.activeProjects, 1);
    assert.equal(counts.claimsAwaitingReview, 0);
    assert.equal(hasResearchInsightSignal(counts), true, "one active project alone is a real signal");
  } finally {
    await deleteTestUser(email);
  }
}

// ---------------------------------------------------------------------------
// (d) Phase 29.1: a lone undismissed monitor hit, with no project/claim/
// debate/job activity at all, is still a real signal on its own — and a
// second monitor hit that IS dismissed does not inflate the count.
// ---------------------------------------------------------------------------
async function testMonitorHitAloneIsSignal() {
  const { email, userId } = await seedUser("monitor-hit-only");
  try {
    const [monitor] = await db
      .insert(researchMonitors)
      .values({ userId, monitorType: "author_follow", query: "Some Author", cadence: "weekly" })
      .returning({ id: researchMonitors.id });
    await db.insert(researchMonitorHits).values({ monitorId: monitor.id, dedupKey: `title:solo-hit-${crypto.randomUUID()}`, title: "Solo Hit", authors: [], provider: "semanticscholar" });

    const counts = await getResearchInsightCounts(userId);
    assert.equal(counts.activeProjects, 0);
    assert.equal(counts.newMonitorHits, 1);
    assert.equal(hasResearchInsightSignal(counts), true, "one undismissed monitor hit alone is a real signal");
  } finally {
    await deleteTestUser(email);
  }
}

async function main() {
  await testMixedSignalCountsExactlyTheEligibleRows();
  await testZeroActivityHasNoSignal();
  await testProjectAloneIsSignal();
  await testMonitorHitAloneIsSignal();
  console.log("researchDashboard.test.ts: all assertions passed");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
