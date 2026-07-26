import {
  aiUsageLogs,
  db,
  learningResources,
  researchCorpusItems,
  researchJobRequests,
  researchMonitorHits,
  researchMonitors,
  users,
} from "@ice/db";
import { normalizedKey, type CorpusSearchResult, type ProviderAttempt, type RawResource } from "@ice/research";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { runResearchJob } from "./jobRunner";
import { parseRunMonitorScope, runMonitorForScope, type RunMonitorDeps } from "./runMonitor";

/**
 * Integration tests for the run_monitor pipeline (Phase 29.1). Skipped when
 * DATABASE_URL is unset, matching every other `*.integration.test.ts` file's
 * convention. Every provider lookup is DI'd and mocked — $0 cost, no
 * network, no real API call.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function resource(overrides: Partial<RawResource>): RawResource {
  return {
    provider: "semanticscholar",
    resourceType: "article",
    title: "A Discovered Paper",
    authors: ["Some Author"],
    year: 2025,
    url: null,
    doi: null,
    isbn: null,
    snippet: null,
    venue: null,
    popularity: null,
    raw: {},
    ...overrides,
  };
}

function attempt(overrides: Partial<ProviderAttempt> = {}): ProviderAttempt {
  return { provider: "semanticscholar", status: "queried", queries: ["q"], resultCount: 1, inspectionDepth: 0, latencyMs: 1, ...overrides };
}

function depsWithTopicResults(resources: RawResource[], attempts?: ProviderAttempt[]): RunMonitorDeps {
  return {
    searchCorpusCandidates: async (): Promise<CorpusSearchResult> => ({
      candidates: resources,
      attempts: attempts ?? [attempt({ provider: "semanticscholar", resultCount: resources.length })],
    }),
    lookupCitations: async () => ({ resources: [], attempt: attempt({ status: "disabled", resultCount: 0 }) }),
    lookupAuthorRecentPapers: async () => ({ resources: [], attempt: attempt({ status: "disabled", resultCount: 0 }) }),
  };
}

function depsWithCitationResults(resources: RawResource[], overrideAttempt?: Partial<ProviderAttempt>): RunMonitorDeps {
  return {
    searchCorpusCandidates: async () => ({ candidates: [], attempts: [] }),
    lookupCitations: async () => ({ resources, attempt: attempt({ resultCount: resources.length, ...overrideAttempt }) }),
    lookupAuthorRecentPapers: async () => ({ resources: [], attempt: attempt({ status: "disabled", resultCount: 0 }) }),
  };
}

function depsWithAuthorResults(resources: RawResource[]): RunMonitorDeps {
  return {
    searchCorpusCandidates: async () => ({ candidates: [], attempts: [] }),
    lookupCitations: async () => ({ resources: [], attempt: attempt({ status: "disabled", resultCount: 0 }) }),
    lookupAuthorRecentPapers: async () => ({ resources, attempt: attempt({ resultCount: resources.length }) }),
  };
}

function throwingDeps(message: string): RunMonitorDeps {
  return {
    searchCorpusCandidates: async () => {
      throw new Error(message);
    },
    lookupCitations: async () => ({ resources: [], attempt: attempt({ status: "disabled", resultCount: 0 }) }),
    lookupAuthorRecentPapers: async () => ({ resources: [], attempt: attempt({ status: "disabled", resultCount: 0 }) }),
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedUser() {
  const [user] = await db.insert(users).values({ email: `rm-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  return user.id;
}

async function seedMonitor(
  userId: string,
  overrides: Partial<{ monitorType: "topic" | "citation_alert" | "author_follow"; query: string; cadence: "daily" | "weekly" | "paused"; isActive: boolean; lastScannedAt: Date | null }> = {},
) {
  const [monitor] = await db
    .insert(researchMonitors)
    .values({
      userId,
      monitorType: overrides.monitorType ?? "topic",
      query: overrides.query ?? "phenomenology of care",
      cadence: overrides.cadence ?? "daily",
      isActive: overrides.isActive ?? true,
      lastScannedAt: overrides.lastScannedAt ?? null,
    })
    .returning({ id: researchMonitors.id });
  return monitor.id;
}

async function seedJobRequest(userId: string, scope: unknown) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({ userId, jobType: "run_monitor", scope: scope ?? {}, idempotencyKey: crypto.randomUUID(), status: "planned" })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("run_monitor (integration)", () => {
  const cleanupUsers: string[] = [];
  const cleanupLearningResources: string[] = [];
  afterEach(async () => {
    while (cleanupLearningResources.length) await db.delete(learningResources).where(eq(learningResources.id, cleanupLearningResources.pop()!));
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("scans a due topic monitor and records new hits", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const monitorId = await seedMonitor(userId, { monitorType: "topic", query: "care ethics" });
    const requestId = await seedJobRequest(userId, {});

    const deps = depsWithTopicResults([resource({ title: "New Paper on Care Ethics", doi: "10.1000/care1" })]);

    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, { monitorId: undefined });
      return outcome;
    });

    expect(outcome.monitorsScanned).toBe(1);
    expect(outcome.newHits).toBe(1);

    const hits = await db.select().from(researchMonitorHits).where(eq(researchMonitorHits.monitorId, monitorId));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "New Paper on Care Ethics", provider: "semanticscholar" });

    const [monitorRow] = await db.select().from(researchMonitors).where(eq(researchMonitors.id, monitorId));
    expect(monitorRow.lastScannedAt).not.toBeNull();

    // Zero AI cost end-to-end.
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.actualCostUsd).toBe(0);
    const usageRows = await db.select().from(aiUsageLogs).where(eq(aiUsageLogs.researchRequestId, requestId));
    expect(usageRows).toHaveLength(0);
  });

  it("skips a paused monitor in the all-due scan", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    await seedMonitor(userId, { cadence: "paused" });
    const requestId = await seedJobRequest(userId, {});

    const deps = depsWithTopicResults([resource({ title: "Should Never Appear" })]);
    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, {});
      return outcome;
    });

    expect(outcome.monitorsScanned).toBe(0);
    expect(outcome.newHits).toBe(0);
  });

  it("scans a not-yet-due monitor anyway when explicitly named by monitorId ('scan now')", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const monitorId = await seedMonitor(userId, { cadence: "daily", lastScannedAt: new Date() }); // scanned seconds ago — not due
    const requestId = await seedJobRequest(userId, { monitorId });

    const deps = depsWithTopicResults([resource({ title: "Explicit Scan Result", url: "https://example.com/explicit" })]);
    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, { monitorId });
      return outcome;
    });

    expect(outcome.monitorsScanned).toBe(1);
    expect(outcome.newHits).toBe(1);
  });

  it("dedups a candidate already in the user's own research_corpus_item (never resurfaces as a hit)", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const monitorId = await seedMonitor(userId, { monitorType: "topic" });
    const requestId = await seedJobRequest(userId, { monitorId });

    const doi = `10.5555/${crypto.randomUUID()}`;
    const dedupKey = normalizedKey({ doi, title: "Already In My Corpus" })!;
    await db.insert(researchCorpusItems).values({
      userId,
      source: "semanticscholar",
      externalId: "already-owned",
      dedupKey,
      title: "Already In My Corpus",
      authors: [],
      doi,
      raw: {},
    });

    const deps = depsWithTopicResults([resource({ title: "Already In My Corpus (should dedupe)", doi })]);
    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, { monitorId });
      return outcome;
    });

    expect(outcome.newHits).toBe(0);
    const hits = await db.select().from(researchMonitorHits).where(eq(researchMonitorHits.monitorId, monitorId));
    expect(hits).toHaveLength(0);
  });

  it("dedups a candidate already in the shared learning_resource Library catalog", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const monitorId = await seedMonitor(userId, { monitorType: "topic" });
    const requestId = await seedJobRequest(userId, { monitorId });

    const doi = `10.6666/${crypto.randomUUID()}`;
    const dedupKey = normalizedKey({ doi, title: "Already In The Library" })!;
    const [lr] = await db
      .insert(learningResources)
      .values({ title: "Already In The Library", normalizedKey: dedupKey, provider: "semanticscholar", doi })
      .returning({ id: learningResources.id });
    cleanupLearningResources.push(lr.id);

    const deps = depsWithTopicResults([resource({ title: "Already In The Library (should dedupe)", doi })]);
    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, { monitorId });
      return outcome;
    });

    expect(outcome.newHits).toBe(0);
  });

  it("re-scanning a monitor does not duplicate an already-recorded hit (monitor-level dedup)", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const monitorId = await seedMonitor(userId, { monitorType: "topic" });

    const deps = depsWithTopicResults([resource({ title: "Repeated Finding", doi: "10.1000/repeated" })]);

    const firstRequestId = await seedJobRequest(userId, { monitorId });
    let firstOutcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(firstRequestId, async (ctx) => {
      firstOutcome = await runMonitorForScope(deps, ctx, { monitorId });
      return firstOutcome;
    });
    expect(firstOutcome.newHits).toBe(1);

    const secondRequestId = await seedJobRequest(userId, { monitorId });
    let secondOutcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(secondRequestId, async (ctx) => {
      secondOutcome = await runMonitorForScope(deps, ctx, { monitorId });
      return secondOutcome;
    });
    expect(secondOutcome.newHits).toBe(0); // dedup hit against the monitor's own prior hit — nothing NEW

    const hits = await db.select().from(researchMonitorHits).where(eq(researchMonitorHits.monitorId, monitorId));
    expect(hits).toHaveLength(1);
  });

  it("citation_alert monitor: reports honest per-provider status in the note, even on a rate-limited attempt", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const monitorId = await seedMonitor(userId, { monitorType: "citation_alert", query: "10.1000/seed-paper" });
    const requestId = await seedJobRequest(userId, { monitorId });

    const deps = depsWithCitationResults([], { status: "rate_limited", resultCount: 0 });
    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, { monitorId });
      return outcome;
    });

    expect(outcome.newHits).toBe(0);
    expect(outcome.note).toContain("rate_limited");
  });

  it("author_follow monitor: records a new hit from an author's papers", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const monitorId = await seedMonitor(userId, { monitorType: "author_follow", query: "Jane Scholar" });
    const requestId = await seedJobRequest(userId, { monitorId });

    const deps = depsWithAuthorResults([resource({ title: "Janes Newest Paper", authors: ["Jane Scholar"], url: "https://example.com/janes-paper" })]);
    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, { monitorId });
      return outcome;
    });

    expect(outcome.newHits).toBe(1);
  });

  it("one monitor's unexpected failure does not abort the rest of an all-due batch", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    // Two topic monitors sharing the batch; the DI'd deps throw for every
    // call in this test, so both individually fail — proving neither one
    // aborts the OTHER (a single shared failing dep is enough to prove the
    // per-monitor try/catch isolation; a real mixed-outcome case would need
    // two separate deps objects, which the monitor loop doesn't support
    // since `runMonitorForScope` takes one `deps` for the whole batch).
    await seedMonitor(userId, { monitorType: "topic", query: "topic one" });
    await seedMonitor(userId, { monitorType: "topic", query: "topic two" });
    const requestId = await seedJobRequest(userId, {});

    const deps = throwingDeps("provider exploded");
    let outcome!: Awaited<ReturnType<typeof runMonitorForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await runMonitorForScope(deps, ctx, {});
      return outcome;
    });

    expect(outcome.monitorsScanned).toBe(2);
    expect(outcome.newHits).toBe(0);
    expect(outcome.note).toContain("failed");
    expect(outcome.note).toContain("provider exploded");
    // The whole job still completes — an honest degraded outcome, not a job
    // failure (the `import_corpus` per-item precedent, one level up).
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");
  });

  it("rejects a scope naming a monitorId that does not belong to the requesting user", async () => {
    const ownerId = await seedUser();
    cleanupUsers.push(ownerId);
    const otherId = await seedUser();
    cleanupUsers.push(otherId);
    const monitorId = await seedMonitor(ownerId, {});

    const requestId = await seedJobRequest(otherId, { monitorId });
    const deps = depsWithTopicResults([]);

    await expect(runResearchJob(requestId, async (ctx) => runMonitorForScope(deps, ctx, { monitorId }))).rejects.toThrow(/does not belong to the requesting user/);

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("failed");
  });
});

describe("parseRunMonitorScope", () => {
  it("accepts an empty scope (all-due) and a {monitorId} scope", () => {
    expect(parseRunMonitorScope({})).toEqual({});
    expect(parseRunMonitorScope({ monitorId: "m1" })).toEqual({ monitorId: "m1" });
  });

  it("rejects a malformed scope", () => {
    expect(parseRunMonitorScope(null)).toBeNull();
    expect(parseRunMonitorScope("not an object")).toBeNull();
    expect(parseRunMonitorScope([])).toBeNull();
    expect(parseRunMonitorScope({ monitorId: 5 })).toBeNull();
    expect(parseRunMonitorScope({ monitorId: "" })).toBeNull();
  });
});
