import { afterEach, describe, expect, it } from "vitest";
import {
  bibliographicRecords,
  citationLibraryLinks,
  citations,
  db,
  documents,
  graphEdges,
  learningResources,
  users,
  workIdentities,
  workIdentityMerges,
  works,
} from "@ice/db";
import { eq, inArray } from "drizzle-orm";
import { runAllConsistencyChecks, type ConsistencyMismatch, type ConsistencyRepair } from "@ice/consistency";
import { applyConsistencyRepairs } from "./apply";
import { fetchConsistencySnapshot } from "./snapshot";

/**
 * Phase 20.7 DB integration: proves `applyConsistencyRepairs` against the
 * real local Postgres — transactional (an in-batch failure rolls back
 * everything, not just the failing repair) and idempotent (re-applying the
 * identical repair set a second time changes nothing further and never
 * errors) — properties the pure-package unit tests (`@ice/consistency`)
 * cannot exercise since they never touch a real transaction or a real unique
 * constraint.
 *
 * `fetchConsistencySnapshot`/`runAllConsistencyChecks` read the WHOLE local
 * database (by design — these are cross-surface integrity checks, not
 * per-user reads), which in this shared local dev environment can contain
 * other concurrent agents' live fixtures. Every test here therefore filters
 * the resulting mismatches/repairs down to ONLY the ones whose `entityId` is
 * a row this test itself seeded before ever calling
 * `applyConsistencyRepairs` — never applying the unfiltered whole-DB repair
 * set, which could otherwise mutate rows this task does not own.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const marker = `p207-apply-${crypto.randomUUID().slice(0, 8)}`;

const cleanup = {
  userIds: [] as string[],
  workIds: [] as string[],
  documentIds: [] as string[],
  bibIds: [] as string[],
  citationIds: [] as string[],
  linkIds: [] as string[],
  resourceIds: [] as string[],
  identityIds: [] as string[],
  edgeIds: [] as string[],
};

async function seedUser(): Promise<string> {
  const [user] = await db.insert(users).values({ email: `${marker}-${crypto.randomUUID().slice(0, 6)}@integration.test`, passwordHash: "x" }).returning({ id: users.id });
  cleanup.userIds.push(user.id);
  return user.id;
}

async function seedWork(userId: string, over: Partial<typeof works.$inferInsert> = {}): Promise<string> {
  const [work] = await db.insert(works).values({ userId, title: `${marker} work`, ...over }).returning({ id: works.id });
  cleanup.workIds.push(work.id);
  return work.id;
}

describe.skipIf(!hasDb)("applyConsistencyRepairs (integration)", () => {
  afterEach(async () => {
    if (cleanup.edgeIds.length) await db.delete(graphEdges).where(inArray(graphEdges.id, cleanup.edgeIds));
    if (cleanup.linkIds.length) await db.delete(citationLibraryLinks).where(inArray(citationLibraryLinks.id, cleanup.linkIds));
    if (cleanup.citationIds.length) await db.delete(citations).where(inArray(citations.id, cleanup.citationIds));
    if (cleanup.resourceIds.length) await db.delete(learningResources).where(inArray(learningResources.id, cleanup.resourceIds));
    if (cleanup.documentIds.length) await db.delete(documents).where(inArray(documents.id, cleanup.documentIds));
    if (cleanup.workIds.length) await db.delete(works).where(inArray(works.id, cleanup.workIds));
    if (cleanup.identityIds.length) await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
    if (cleanup.bibIds.length) await db.delete(bibliographicRecords).where(inArray(bibliographicRecords.id, cleanup.bibIds));
    if (cleanup.userIds.length) await db.delete(users).where(inArray(users.id, cleanup.userIds));
    cleanup.userIds = [];
    cleanup.workIds = [];
    cleanup.documentIds = [];
    cleanup.bibIds = [];
    cleanup.citationIds = [];
    cleanup.linkIds = [];
    cleanup.resourceIds = [];
    cleanup.identityIds = [];
    cleanup.edgeIds = [];
  });

  /** Runs the real end-to-end pass (fetch snapshot -> check -> filter to my
   *  own seeded ids) so every test proves detection against a live DB, not
   *  just against the applier called directly with a hand-built repair. */
  async function findMyMismatches(myEntityIds: Set<string>): Promise<ConsistencyMismatch[]> {
    const snapshot = await fetchConsistencySnapshot();
    const report = runAllConsistencyChecks(snapshot);
    return report.mismatches.filter((m) => myEntityIds.has(m.entityId));
  }

  it("detects and repairs (red-first) a missing citation_library_link, then is idempotent on re-apply", async () => {
    const userId = await seedUser();
    const workId = await seedWork(userId);
    const [document] = await db
      .insert(documents)
      .values({ userId, workId, storagePath: `${marker}/doc.txt`, originalFilename: "doc.txt", mimeType: "text/plain", fileSize: 10 })
      .returning({ id: documents.id });
    cleanup.documentIds.push(document.id);
    const [bib] = await db.insert(bibliographicRecords).values({ source: "crossref", title: `${marker} bib` }).returning({ id: bibliographicRecords.id });
    cleanup.bibIds.push(bib.id);
    const [citation] = await db
      .insert(citations)
      .values({ documentId: document.id, rawText: `${marker} raw`, normalizedQuery: marker, resolvedBibId: bib.id, resolutionSource: "crossref", resolutionState: "resolved" })
      .returning({ id: citations.id });
    cleanup.citationIds.push(citation.id);
    const [resource] = await db
      .insert(learningResources)
      .values({ title: `${marker} resource`, normalizedKey: `${marker}:lr`, resourceType: "book", provider: "crossref", authors: [], bibRecordId: bib.id })
      .returning({ id: learningResources.id });
    cleanup.resourceIds.push(resource.id);

    // RED: the link is genuinely missing before any repair runs.
    expect(await db.select().from(citationLibraryLinks).where(eq(citationLibraryLinks.citationId, citation.id))).toHaveLength(0);

    const mine = await findMyMismatches(new Set([citation.id]));
    expect(mine).toHaveLength(1);
    expect(mine[0].checkId).toBe("citation-library-item");
    const repairs = mine.map((m) => m.repair).filter((r): r is ConsistencyRepair => r !== null);
    expect(repairs).toHaveLength(1);

    const first = await applyConsistencyRepairs(repairs);
    expect(first.applied).toBe(1);
    expect(first.skipped).toHaveLength(0);

    const linksAfterFirst = await db.select().from(citationLibraryLinks).where(eq(citationLibraryLinks.citationId, citation.id));
    expect(linksAfterFirst).toHaveLength(1);
    expect(linksAfterFirst[0].learningResourceId).toBe(resource.id);
    cleanup.linkIds.push(linksAfterFirst[0].id);

    // GREEN: re-running the checks against the live DB no longer finds it.
    expect(await findMyMismatches(new Set([citation.id]))).toHaveLength(0);

    // IDEMPOTENT: re-applying the exact same repair batch must not error
    // (the unique citation_id constraint would reject a bare re-insert) and
    // must not create a second row.
    const second = await applyConsistencyRepairs(repairs);
    expect(second.applied).toBe(1); // the applier ran the statement; onConflictDoNothing made it a no-op
    const linksAfterSecond = await db.select().from(citationLibraryLinks).where(eq(citationLibraryLinks.citationId, citation.id));
    expect(linksAfterSecond).toHaveLength(1);
    expect(linksAfterSecond[0].id).toBe(linksAfterFirst[0].id);
  });

  it("detects and repairs (deletes) a graph_edge with a dangling source endpoint, red-first", async () => {
    const userId = await seedUser();
    const [bib] = await db.insert(bibliographicRecords).values({ source: "crossref", title: `${marker} bib2` }).returning({ id: bibliographicRecords.id });
    cleanup.bibIds.push(bib.id);
    const danglingWorkId = crypto.randomUUID(); // never inserted — a genuinely gone endpoint
    const [edge] = await db
      .insert(graphEdges)
      .values({ userId, sourceType: "work", sourceId: danglingWorkId, targetType: "bibliographic_record", targetId: bib.id, edgeType: "cites" })
      .returning({ id: graphEdges.id });
    cleanup.edgeIds.push(edge.id);

    const mine = await findMyMismatches(new Set([edge.id]));
    expect(mine).toHaveLength(1);
    expect(mine[0].checkId).toBe("graph-edge-endpoints");
    expect(mine[0].severity).toBe("critical");
    const repairs = mine.map((m) => m.repair).filter((r): r is ConsistencyRepair => r !== null);
    expect(repairs).toHaveLength(1);

    const first = await applyConsistencyRepairs(repairs);
    expect(first.applied).toBe(1);
    expect(await db.select().from(graphEdges).where(eq(graphEdges.id, edge.id))).toHaveLength(0);

    // IDEMPOTENT: deleting an already-deleted row by id affects 0 rows, not an error.
    const second = await applyConsistencyRepairs(repairs);
    expect(second.applied).toBe(1);
    expect(second.skipped).toHaveLength(0);
    expect(await db.select().from(graphEdges).where(eq(graphEdges.id, edge.id))).toHaveLength(0);

    cleanup.edgeIds = cleanup.edgeIds.filter((id) => id !== edge.id); // already gone, nothing left to clean up
  });

  it("detects and repairs a learning_resource pointing at a merged-away work_identity, red-first", async () => {
    const [winner] = await db.insert(workIdentities).values({ workKey: `work:${marker}:winner`, canonicalTitle: "Winner", evidence: marker }).returning({ id: workIdentities.id });
    const [loser] = await db.insert(workIdentities).values({ workKey: `work:${marker}:loser`, canonicalTitle: "Loser", evidence: marker }).returning({ id: workIdentities.id });
    cleanup.identityIds.push(winner.id, loser.id);
    await db.insert(workIdentityMerges).values({ winnerIdentityId: winner.id, loserIdentityId: loser.id, method: "title-author-year", reversal: {} });
    const [resource] = await db
      .insert(learningResources)
      .values({ title: `${marker} resource2`, normalizedKey: `${marker}:lr2`, resourceType: "book", provider: "crossref", authors: [], workIdentityId: loser.id })
      .returning({ id: learningResources.id });
    cleanup.resourceIds.push(resource.id);

    // RED: still pointing at the loser before any repair.
    const [before] = await db.select({ workIdentityId: learningResources.workIdentityId }).from(learningResources).where(eq(learningResources.id, resource.id));
    expect(before.workIdentityId).toBe(loser.id);

    const mine = await findMyMismatches(new Set([resource.id]));
    expect(mine).toHaveLength(1);
    expect(mine[0].checkId).toBe("library-item-canonical-work");
    const repairs = mine.map((m) => m.repair).filter((r): r is ConsistencyRepair => r !== null);
    expect(repairs).toHaveLength(1);

    await applyConsistencyRepairs(repairs);
    const [after] = await db.select({ workIdentityId: learningResources.workIdentityId }).from(learningResources).where(eq(learningResources.id, resource.id));
    expect(after.workIdentityId).toBe(winner.id);

    // GREEN + IDEMPOTENT: no longer reported, and re-applying the stale
    // repair batch (still naming the loser -> winner patch) leaves the
    // already-correct row unchanged rather than erroring.
    expect(await findMyMismatches(new Set([resource.id]))).toHaveLength(0);
    await applyConsistencyRepairs(repairs);
    const [afterSecond] = await db.select({ workIdentityId: learningResources.workIdentityId }).from(learningResources).where(eq(learningResources.id, resource.id));
    expect(afterSecond.workIdentityId).toBe(winner.id);
  });

  it("backfills a work_identity's null year from its own primary learning_resource, red-first and idempotent", async () => {
    const [identity] = await db.insert(workIdentities).values({ workKey: `work:${marker}:year`, canonicalTitle: `${marker} Sample Primary Text`, evidence: marker }).returning({ id: workIdentities.id });
    cleanup.identityIds.push(identity.id);
    const [resource] = await db
      .insert(learningResources)
      .values({ title: `${marker} Sample Primary Text`, normalizedKey: `${marker}:lr3`, resourceType: "book", provider: "crossref", authors: [], workRole: "primary", workIdentityId: identity.id, year: 1999 })
      .returning({ id: learningResources.id });
    cleanup.resourceIds.push(resource.id);

    const [before] = await db.select({ year: workIdentities.year }).from(workIdentities).where(eq(workIdentities.id, identity.id));
    expect(before.year).toBeNull();

    const mine = await findMyMismatches(new Set([identity.id]));
    expect(mine.some((m) => m.checkId === "title-author-year-agreement" && (m.repair as { patch?: { year: number } } | null)?.patch?.year === 1999)).toBe(true);
    const repairs = mine.map((m) => m.repair).filter((r): r is ConsistencyRepair => r !== null);

    await applyConsistencyRepairs(repairs);
    const [after] = await db.select({ year: workIdentities.year }).from(workIdentities).where(eq(workIdentities.id, identity.id));
    expect(after.year).toBe(1999);

    await applyConsistencyRepairs(repairs); // idempotent: same year written again is a no-op in effect
    const [afterSecond] = await db.select({ year: workIdentities.year }).from(workIdentities).where(eq(workIdentities.id, identity.id));
    expect(afterSecond.year).toBe(1999);
  });

  it("is transactional: a batch containing one valid update and one FK-violating update rolls back BOTH, not just the failing one", async () => {
    const [identity] = await db.insert(workIdentities).values({ workKey: `work:${marker}:tx`, canonicalTitle: `${marker} tx identity`, evidence: marker }).returning({ id: workIdentities.id });
    cleanup.identityIds.push(identity.id);
    const [resource] = await db
      .insert(learningResources)
      .values({ title: `${marker} tx resource`, normalizedKey: `${marker}:lr-tx`, resourceType: "book", provider: "crossref", authors: [], workRole: "primary", workIdentityId: identity.id, year: 2005 })
      .returning({ id: learningResources.id });
    cleanup.resourceIds.push(resource.id);

    const [before] = await db.select({ year: workIdentities.year }).from(workIdentities).where(eq(workIdentities.id, identity.id));
    expect(before.year).toBeNull();

    const validBackfill: ConsistencyRepair = {
      kind: "update",
      table: "work_identity",
      id: identity.id,
      patch: { year: 2005 },
      reason: "integration test valid repair",
    };
    const fkViolating: ConsistencyRepair = {
      kind: "update",
      table: "learning_resource",
      id: resource.id,
      // A work_identity id that was never inserted -> FK violation on apply.
      patch: { workIdentityId: crypto.randomUUID() },
      reason: "integration test deliberately invalid repair",
    };

    await expect(applyConsistencyRepairs([validBackfill, fkViolating])).rejects.toThrow();

    // The valid repair in the SAME batch must have been rolled back too.
    const [afterFailedBatch] = await db.select({ year: workIdentities.year }).from(workIdentities).where(eq(workIdentities.id, identity.id));
    expect(afterFailedBatch.year).toBeNull();
    const [resourceAfter] = await db.select({ workIdentityId: learningResources.workIdentityId }).from(learningResources).where(eq(learningResources.id, resource.id));
    expect(resourceAfter.workIdentityId).toBe(identity.id); // unchanged
  });

  it("never applies a repair it did not itself detect (report-only mismatches stay report-only)", async () => {
    const [identity] = await db.insert(workIdentities).values({ workKey: `work:${marker}:guess`, canonicalTitle: "Zorbathian Quixotic Mysteries", evidence: marker }).returning({ id: workIdentities.id });
    cleanup.identityIds.push(identity.id);
    const userId = await seedUser();
    const workId = await seedWork(userId, { title: "Wholly Unconnected Fragmentary Notebook", workIdentityId: identity.id });

    const mine = await findMyMismatches(new Set([workId]));
    // title-author-year-agreement fires (report-only) but must carry repair: null.
    const titleMismatch = mine.find((m) => m.checkId === "title-author-year-agreement");
    expect(titleMismatch).toBeDefined();
    expect(titleMismatch?.repair).toBeNull();

    // Applying "nothing" (the empty repair projection) must leave the work's
    // own title exactly as uploaded — never silently overwritten to match
    // the identity's canonical title.
    const repairs = mine.map((m) => m.repair).filter((r): r is ConsistencyRepair => r !== null);
    expect(repairs).toHaveLength(0);
    await applyConsistencyRepairs(repairs);
    const [work] = await db.select({ title: works.title }).from(works).where(eq(works.id, workId));
    expect(work.title).toBe("Wholly Unconnected Fragmentary Notebook");
  });
});
