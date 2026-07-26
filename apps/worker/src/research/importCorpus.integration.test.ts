import {
  bibliographicRecords,
  db,
  researchCorpusItems,
  researchJobRequests,
  researchProjectMembers,
  researchProjects,
  users,
} from "@ice/db";
import type { CorpusProvider, ProviderAttempt, RawResource } from "@ice/research";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { importCorpusForScope, parseImportCorpusScope, type ImportCorpusScope } from "./importCorpus";
import { runResearchJob } from "./jobRunner";

/**
 * Integration tests for the import_corpus pipeline (Phase 28.2). Skipped
 * when DATABASE_URL is unset, matching every other `*.integration.test.ts`
 * file's convention. Every provider lookup is mocked — $0 cost, no network,
 * no real API call — matching the "no live calls in tests" requirement.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function resource(overrides: Partial<RawResource> & { provider: CorpusProvider }): RawResource {
  return {
    resourceType: "article",
    title: "A Corpus Item",
    authors: ["Some Author"],
    year: 2020,
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

function attempt(provider: CorpusProvider, status: ProviderAttempt["status"], error?: string): ProviderAttempt {
  return { provider, status, queries: ["id"], resultCount: status === "queried" ? 1 : 0, inspectionDepth: 0, latencyMs: 1, ...(error ? { error } : {}) };
}

/** A DI'd `lookupCorpusItemById`-shaped function keyed by `provider:externalId`
 *  — anything not listed answers an honest "not found". */
function mockLookup(table: Record<string, { resource: RawResource | null; status?: ProviderAttempt["status"]; error?: string }>) {
  return async (provider: CorpusProvider, externalId: string) => {
    const entry = table[`${provider}:${externalId}`];
    if (!entry) return { resource: null, attempt: attempt(provider, "unavailable") };
    const status = entry.status ?? (entry.resource ? "queried" : "unavailable");
    return { resource: entry.resource, attempt: attempt(provider, status, entry.error) };
  };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function seedUser() {
  const [user] = await db.insert(users).values({ email: `ic-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  return user.id;
}

async function seedProject(userId: string) {
  const [project] = await db.insert(researchProjects).values({ userId, title: "Aristotle on vice" }).returning({ id: researchProjects.id });
  return project.id;
}

async function seedJobRequest(userId: string, scope: ImportCorpusScope) {
  const [request] = await db
    .insert(researchJobRequests)
    .values({ userId, jobType: "import_corpus", scope, idempotencyKey: crypto.randomUUID(), status: "planned" })
    .returning({ id: researchJobRequests.id });
  return request.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!hasDb)("import_corpus (integration)", () => {
  const cleanupUsers: string[] = [];
  const cleanupBibRecords: string[] = [];
  afterEach(async () => {
    while (cleanupBibRecords.length) await db.delete(bibliographicRecords).where(eq(bibliographicRecords.id, cleanupBibRecords.pop()!));
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
  });

  it("imports a new corpus item and records an honest 'imported' outcome", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const scope: ImportCorpusScope = { items: [{ provider: "arxiv", externalId: "2301.12345v2" }] };
    const requestId = await seedJobRequest(userId, scope);

    const lookup = mockLookup({
      "arxiv:2301.12345v2": {
        resource: resource({ provider: "arxiv", title: "A Study of Electrons", venue: "arXiv", doi: null, raw: { arxivId: "2301.12345v2" } }),
      },
    });

    let outcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await importCorpusForScope(lookup, ctx, scope);
      return outcome;
    });

    expect(outcome.imported).toBe(1);
    expect(outcome.itemOutcomes[0]).toContain("imported");

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");
    expect(request.coverage).toBe("full");
    expect(request.actualCostUsd).toBe(0); // zero AI cost by design

    const items = await db.select().from(researchCorpusItems).where(eq(researchCorpusItems.userId, userId));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "arxiv", externalId: "2301.12345v2", title: "A Study of Electrons" });
  });

  it("dedup idempotency: re-running the same item inserts zero new rows and reports 'already in corpus'", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const scope: ImportCorpusScope = { items: [{ provider: "openalex", externalId: "W2031754690" }] };
    const lookup = mockLookup({
      "openalex:W2031754690": { resource: resource({ provider: "openalex", title: "Being and Time", doi: "10.1000/abc", raw: { id: "https://openalex.org/W2031754690" } }) },
    });

    const firstRequestId = await seedJobRequest(userId, scope);
    let firstOutcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(firstRequestId, async (ctx) => {
      firstOutcome = await importCorpusForScope(lookup, ctx, scope);
      return firstOutcome;
    });
    expect(firstOutcome.imported).toBe(1);

    const afterFirst = await db.select().from(researchCorpusItems).where(eq(researchCorpusItems.userId, userId));
    expect(afterFirst).toHaveLength(1);

    const secondRequestId = await seedJobRequest(userId, scope);
    let secondOutcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(secondRequestId, async (ctx) => {
      secondOutcome = await importCorpusForScope(lookup, ctx, scope);
      return secondOutcome;
    });
    expect(secondOutcome.imported).toBe(0); // dedup hit — nothing NEW imported
    expect(secondOutcome.itemOutcomes[0]).toContain("already in corpus");

    const afterSecond = await db.select().from(researchCorpusItems).where(eq(researchCorpusItems.userId, userId));
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id); // same row, not a duplicate
  });

  it("links an imported item into a project as a corpus_item member (satisfies the 0039-widened typed-target CHECK)", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const projectId = await seedProject(userId);
    const scope: ImportCorpusScope = { projectId, items: [{ provider: "semanticscholar", externalId: "s2-paper-1" }] };
    const lookup = mockLookup({
      "semanticscholar:s2-paper-1": { resource: resource({ provider: "semanticscholar", title: "On Akrasia", raw: { paperId: "s2-paper-1" } }) },
    });

    const requestId = await seedJobRequest(userId, scope);
    let outcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await importCorpusForScope(lookup, ctx, scope);
      return outcome;
    });
    expect(outcome.itemOutcomes[0]).toContain("linked to project");

    const [item] = await db.select().from(researchCorpusItems).where(eq(researchCorpusItems.userId, userId));
    const members = await db
      .select()
      .from(researchProjectMembers)
      .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.corpusItemId, item.id)));
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ memberType: "corpus_item", workId: null, writerProjectId: null, ragConversationId: null });

    // Re-running the same scope must not duplicate the membership row —
    // the unique index + onConflictDoNothing idempotency the repository fn
    // relies on.
    const secondRequestId = await seedJobRequest(userId, scope);
    let secondOutcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(secondRequestId, async (ctx) => {
      secondOutcome = await importCorpusForScope(lookup, ctx, scope);
      return secondOutcome;
    });
    expect(secondOutcome.itemOutcomes[0]).toContain("already a project member");
    const membersAfter = await db
      .select()
      .from(researchProjectMembers)
      .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.corpusItemId, item.id)));
    expect(membersAfter).toHaveLength(1);
  });

  it("read-only-matches an existing bibliographic_record by DOI without creating a new one", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const doi = `10.1234/${crypto.randomUUID()}`;
    const [existing] = await db
      .insert(bibliographicRecords)
      .values({ source: "crossref", title: "Nicomachean Ethics (a prior resolution)", doi })
      .returning({ id: bibliographicRecords.id });
    cleanupBibRecords.push(existing.id);

    const scope: ImportCorpusScope = { items: [{ provider: "arxiv", externalId: "9999.00001" }] };
    const lookup = mockLookup({
      "arxiv:9999.00001": { resource: resource({ provider: "arxiv", title: "A Paper Citing the Same DOI", doi, raw: { arxivId: "9999.00001" } }) },
    });

    const requestId = await seedJobRequest(userId, scope);
    let outcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await importCorpusForScope(lookup, ctx, scope);
      return outcome;
    });
    expect(outcome.itemOutcomes[0]).toContain(`matched existing bibliographic_record ${existing.id}`);

    // No new bibliographic_record row was created by this read-only match.
    const allMatchingDoi = await db.select().from(bibliographicRecords).where(eq(bibliographicRecords.doi, doi));
    expect(allMatchingDoi).toHaveLength(1);
    expect(allMatchingDoi[0].id).toBe(existing.id);
  });

  it("per-item failure honesty: one item not-found, one item errors, one succeeds — all three land in the outcome, no early abort", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const scope: ImportCorpusScope = {
      items: [
        { provider: "arxiv", externalId: "missing-id" },
        { provider: "openalex", externalId: "boom" },
        { provider: "semanticscholar", externalId: "s2-good" },
      ],
    };
    const lookup = async (provider: CorpusProvider, externalId: string) => {
      if (externalId === "missing-id") return { resource: null, attempt: attempt(provider, "unavailable") };
      if (externalId === "boom") throw new Error("provider blew up");
      return { resource: resource({ provider, title: "A Good Paper", raw: { paperId: "s2-good" } }), attempt: attempt(provider, "queried") };
    };

    const requestId = await seedJobRequest(userId, scope);
    let outcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await importCorpusForScope(lookup, ctx, scope);
      return outcome;
    });

    expect(outcome.itemOutcomes).toHaveLength(3);
    expect(outcome.itemOutcomes[0]).toContain("not found");
    expect(outcome.itemOutcomes[1]).toContain("failed");
    expect(outcome.itemOutcomes[1]).toContain("provider blew up");
    expect(outcome.itemOutcomes[2]).toContain("imported");
    expect(outcome.imported).toBe(1);

    // The whole job still completes — an honest degraded outcome, not a job
    // failure, matching extract_claims's "dropped chunk" precedent.
    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("complete");
  });

  it("skips an item naming an unsupported provider rather than aborting the whole request", async () => {
    const userId = await seedUser();
    cleanupUsers.push(userId);
    const scope: ImportCorpusScope = { items: [{ provider: "tavily", externalId: "x" }, { provider: "arxiv", externalId: "2301.12345" }] };
    const lookup = mockLookup({
      "arxiv:2301.12345": { resource: resource({ provider: "arxiv", title: "A Paper", raw: { arxivId: "2301.12345" } }) },
    });

    const requestId = await seedJobRequest(userId, scope);
    let outcome!: Awaited<ReturnType<typeof importCorpusForScope>>;
    await runResearchJob(requestId, async (ctx) => {
      outcome = await importCorpusForScope(lookup, ctx, scope);
      return outcome;
    });

    expect(outcome.itemOutcomes[0]).toContain("unsupported provider");
    expect(outcome.itemOutcomes[1]).toContain("imported");
    expect(outcome.imported).toBe(1);
  });

  it("rejects a scope whose projectId does not belong to the requesting user", async () => {
    const ownerId = await seedUser();
    cleanupUsers.push(ownerId);
    const otherId = await seedUser();
    cleanupUsers.push(otherId);
    const projectId = await seedProject(ownerId);

    const scope: ImportCorpusScope = { projectId, items: [{ provider: "arxiv", externalId: "2301.12345" }] };
    const lookup = mockLookup({});
    const requestId = await seedJobRequest(otherId, scope);

    await expect(
      runResearchJob(requestId, async (ctx) => importCorpusForScope(lookup, ctx, scope)),
    ).rejects.toThrow(/does not belong to the requesting user/);

    const [request] = await db.select().from(researchJobRequests).where(eq(researchJobRequests.id, requestId));
    expect(request.status).toBe("failed");
  });
});

describe("parseImportCorpusScope", () => {
  it("parses a valid scope with and without a projectId", () => {
    expect(parseImportCorpusScope({ items: [{ provider: "arxiv", externalId: "2301.12345" }] })).toEqual({
      projectId: undefined,
      items: [{ provider: "arxiv", externalId: "2301.12345" }],
    });
    expect(parseImportCorpusScope({ projectId: "p1", items: [{ provider: "openalex", externalId: "W1" }] })).toEqual({
      projectId: "p1",
      items: [{ provider: "openalex", externalId: "W1" }],
    });
  });

  it("rejects a missing/empty items array", () => {
    expect(parseImportCorpusScope({})).toBeNull();
    expect(parseImportCorpusScope({ items: [] })).toBeNull();
    expect(parseImportCorpusScope(null)).toBeNull();
    expect(parseImportCorpusScope("not an object")).toBeNull();
  });

  it("rejects an item missing provider or externalId", () => {
    expect(parseImportCorpusScope({ items: [{ provider: "arxiv" }] })).toBeNull();
    expect(parseImportCorpusScope({ items: [{ externalId: "x" }] })).toBeNull();
    expect(parseImportCorpusScope({ items: [{ provider: "arxiv", externalId: "" }] })).toBeNull();
  });
});
