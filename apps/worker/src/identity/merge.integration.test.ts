import { afterEach, describe, expect, it } from "vitest";
import {
  db,
  documents,
  learningResources,
  resourceRoles,
  users,
  workIdentities,
  workIdentityMerges,
  works,
} from "@ice/db";
import { eq, inArray } from "drizzle-orm";
import { auditWorkIdentityDuplicates, mergeWorkIdentities, revertWorkIdentityMerge } from "./merge";
import { findOrCreateWorkIdentity } from "../analyze";

/**
 * Phase 20.6 DB integration: the reversible merge state machine and the
 * write-time precedence chain, against the real local Postgres. Every row is
 * seeded with a unique run marker and deleted afterwards — including the
 * loser identities that merges deliberately do NOT delete.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const marker = `p206-${crypto.randomUUID().slice(0, 8)}`;
const cleanup = { userIds: [] as string[], identityIds: [] as string[], resourceIds: [] as string[] };

async function seedIdentity(over: Partial<typeof workIdentities.$inferInsert> & { workKey: string }): Promise<string> {
  const [row] = await db
    .insert(workIdentities)
    .values({ canonicalTitle: "Seeded identity", authorSurname: "seed", evidence: marker, ...over })
    .returning({ id: workIdentities.id });
  cleanup.identityIds.push(row.id);
  return row.id;
}

async function seedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: `${marker}-${crypto.randomUUID().slice(0, 6)}@integration.test`, passwordHash: "x" })
    .returning({ id: users.id });
  cleanup.userIds.push(user.id);
  return user.id;
}

async function seedResource(identityId: string | null, over: Partial<typeof learningResources.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(learningResources)
    .values({
      workIdentityId: identityId,
      title: `${marker} resource`,
      normalizedKey: `${marker}:${crypto.randomUUID()}`,
      resourceType: "book",
      provider: "seed",
      authors: [],
      ...over,
    })
    .returning({ id: learningResources.id });
  cleanup.resourceIds.push(row.id);
  return row.id;
}

describe.skipIf(!hasDb)("Phase 20.6 canonical identity (integration)", () => {
  afterEach(async () => {
    // Merge rows cascade from identity deletion; delete dependents first.
    if (cleanup.resourceIds.length) await db.delete(learningResources).where(inArray(learningResources.id, cleanup.resourceIds));
    if (cleanup.userIds.length) await db.delete(users).where(inArray(users.id, cleanup.userIds));
    if (cleanup.identityIds.length) await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
    cleanup.userIds = [];
    cleanup.identityIds = [];
    cleanup.resourceIds = [];
  });

  it("merges reversibly: repoints works/resources/roles, records reversal, and revert restores the exact prior state", async () => {
    const userId = await seedUser();
    const winnerId = await seedIdentity({ workKey: `work:${marker}:winner`, canonicalTitle: "Ethics with Aristotle", authorSurname: "broadie" });
    const loserId = await seedIdentity({ workKey: `work:${marker}:loser`, canonicalTitle: "Ethics with Aristotle", authorSurname: "broadie", doi: `10.1234/${marker}` });

    const [work] = await db.insert(works).values({ userId, title: `${marker} upload`, workIdentityId: loserId }).returning({ id: works.id });
    const movedResourceId = await seedResource(loserId);
    const sharedResourceId = await seedResource(winnerId);
    // Conflicting role: same (resource, level) judged against BOTH identities.
    await db.insert(resourceRoles).values([
      { learningResourceId: sharedResourceId, workIdentityId: winnerId, relationship: "prerequisite", readerLevel: null, rationale: "winner-side", confidence: 0.9, createdBy: "system" },
      { learningResourceId: sharedResourceId, workIdentityId: loserId, relationship: "interpretive_aid", readerLevel: null, rationale: "loser-side", confidence: 0.5, createdBy: "system" },
      { learningResourceId: movedResourceId, workIdentityId: loserId, relationship: "explicit_reference", readerLevel: null, rationale: "movable", confidence: 0.7, createdBy: "system" },
    ]);

    const applied = await mergeWorkIdentities({ winnerId, loserId, method: "title-author-year", evidence: "integration test" });
    expect(applied.reversal.workIds).toEqual([work.id]);
    expect(applied.reversal.learningResourceIds).toEqual([movedResourceId]);
    expect(applied.reversal.movedRoleIds).toHaveLength(1);
    expect(applied.reversal.displacedRoles).toHaveLength(1);
    expect(applied.reversal.displacedRoles[0].rationale).toBe("loser-side");
    expect(applied.reversal.backfilledColumns).toEqual(["doi"]);

    // Applied state: everything points at the winner; the loser row survives.
    const [movedWork] = await db.select({ id: works.workIdentityId }).from(works).where(eq(works.id, work.id));
    expect(movedWork.id).toBe(winnerId);
    const [movedResource] = await db.select({ id: learningResources.workIdentityId }).from(learningResources).where(eq(learningResources.id, movedResourceId));
    expect(movedResource.id).toBe(winnerId);
    const loserRoles = await db.select().from(resourceRoles).where(eq(resourceRoles.workIdentityId, loserId));
    expect(loserRoles).toHaveLength(0);
    const [survivingLoser] = await db.select().from(workIdentities).where(eq(workIdentities.id, loserId));
    expect(survivingLoser).toBeTruthy();
    const [winnerRow] = await db.select().from(workIdentities).where(eq(workIdentities.id, winnerId));
    expect(winnerRow.doi).toBe(`10.1234/${marker}`);

    // A second merge of the same loser is refused while the first is active.
    await expect(mergeWorkIdentities({ winnerId, loserId, method: "title-author-year" })).rejects.toThrow(/already merged away/);

    // Revert restores the exact prior state.
    await revertWorkIdentityMerge(applied.mergeId);
    const [revertedWork] = await db.select({ id: works.workIdentityId }).from(works).where(eq(works.id, work.id));
    expect(revertedWork.id).toBe(loserId);
    const [revertedResource] = await db.select({ id: learningResources.workIdentityId }).from(learningResources).where(eq(learningResources.id, movedResourceId));
    expect(revertedResource.id).toBe(loserId);
    const restoredLoserRoles = await db.select().from(resourceRoles).where(eq(resourceRoles.workIdentityId, loserId));
    expect(restoredLoserRoles).toHaveLength(2);
    expect(restoredLoserRoles.map((r) => r.rationale).sort()).toEqual(["loser-side", "movable"]);
    const [clearedWinner] = await db.select().from(workIdentities).where(eq(workIdentities.id, winnerId));
    expect(clearedWinner.doi).toBeNull();
    const [mergeRow] = await db.select().from(workIdentityMerges).where(eq(workIdentityMerges.id, applied.mergeId));
    expect(mergeRow.revertedAt).not.toBeNull();

    // A double revert is refused rather than corrupting state.
    await expect(revertWorkIdentityMerge(applied.mergeId)).rejects.toThrow(/already reverted/);
  });

  it("audit: DOI duplicates plan a merge, an already-merged loser drops out, and cross-work duplicate references stay one resource", async () => {
    const doi = `10.9999/${marker}-audit`;
    const a = await seedIdentity({ workKey: `work:${marker}:a`, canonicalTitle: "Vice and Reason", authorSurname: "irwin", doi });
    const b = await seedIdentity({ workKey: `work:${marker}:b`, canonicalTitle: "Vice and Reason in Aristotle", authorSurname: "irwin", doi });

    const before = await auditWorkIdentityDuplicates();
    const planned = before.plan.merges.find((m) => [m.winnerId, ...m.loserIds].includes(a) && [m.winnerId, ...m.loserIds].includes(b));
    expect(planned).toBeTruthy();
    expect(planned!.method).toBe("doi");

    const applied = await mergeWorkIdentities({ winnerId: planned!.winnerId, loserId: planned!.loserIds[0], method: planned!.method, evidence: planned!.evidence });
    const after = await auditWorkIdentityDuplicates();
    expect(after.candidates.some((c) => c.id === planned!.loserIds[0])).toBe(false);
    expect(after.plan.merges.some((m) => [m.winnerId, ...m.loserIds].includes(planned!.loserIds[0]))).toBe(false);

    await revertWorkIdentityMerge(applied.mergeId);
    const restored = await auditWorkIdentityDuplicates();
    expect(restored.candidates.some((c) => c.id === planned!.loserIds[0])).toBe(true);
  });

  it("audit: identical uploaded content hashes plan a content-hash merge (same uploaded bytes)", async () => {
    const userId = await seedUser();
    const hash = `${marker}-hash-${crypto.randomUUID().slice(0, 8)}`;
    // Unique titles: the shared local DB carries debris identities with
    // common fixture titles, and a title/author match would connect these two
    // BEFORE the content-hash rule — the group would then honestly report the
    // stronger method. Same bytes + unrelated titles isolates rule 5.
    const a = await seedIdentity({ workKey: `work:${marker}:hash-a`, canonicalTitle: `Hashwork Alpha ${marker}`, authorSurname: "irwin" });
    const b = await seedIdentity({ workKey: `work:${marker}:hash-b`, canonicalTitle: `Hashupload Beta ${marker}`, authorSurname: null });
    for (const identityId of [a, b]) {
      const [work] = await db.insert(works).values({ userId, title: `${marker} upload`, workIdentityId: identityId }).returning({ id: works.id });
      await db.insert(documents).values({
        userId,
        workId: work.id,
        storagePath: `${userId}/${work.id}/${marker}.pdf`,
        originalFilename: `${marker}.pdf`,
        mimeType: "application/pdf",
        fileSize: 10,
        processingStatus: "ready",
        contentHash: hash,
      });
    }

    const audit = await auditWorkIdentityDuplicates();
    const planned = audit.plan.merges.find((m) => [m.winnerId, ...m.loserIds].includes(a) && [m.winnerId, ...m.loserIds].includes(b));
    expect(planned).toBeTruthy();
    expect(planned!.method).toBe("content-hash");
  });

  it("findOrCreateWorkIdentity: a verified DOI outranks a different title/author key, and identifiers backfill once", async () => {
    const doi = `10.5555/${marker}-prec`;
    const existing = await seedIdentity({ workKey: `work:${marker}:doi-holder`, canonicalTitle: "Aristotle's Philosophy of Action", authorSurname: "charles", doi });

    const resolved = await findOrCreateWorkIdentity(
      { key: `work:${marker}:other-key`, canonicalTitle: "Philosophy of Action in Aristotle", authorSurname: "charles", role: "primary", evidence: "test" },
      ["David Charles"],
      { doi, isbn: "9780715623145" },
    );
    expect(resolved).toBe(existing);
    const [row] = await db.select().from(workIdentities).where(eq(workIdentities.id, existing));
    expect(row.isbn).toBe("9780715623145"); // backfilled because null
    expect(row.doi).toBe(doi); // never overwritten

    // No identifier and a new key still creates a fresh identity (precedence 4 fallback).
    const fresh = await findOrCreateWorkIdentity(
      { key: `work:${marker}:brand-new`, canonicalTitle: "A Brand New Work", authorSurname: "nobody", role: "primary", evidence: "test" },
      ["No Body"],
    );
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(existing);
    if (fresh) cleanup.identityIds.push(fresh);
  });

  it("findOrCreateWorkIdentity: the same uploaded bytes resolve to the same identity even when extracted titles differ", async () => {
    const hash = `${marker}-bytes-${crypto.randomUUID().slice(0, 8)}`;
    const first = await findOrCreateWorkIdentity(
      { key: `work:${marker}:bytes-a`, canonicalTitle: "Vice and Reason", authorSurname: "irwin", role: "primary", evidence: "test" },
      ["Terence Irwin"],
      { contentHash: hash },
    );
    expect(first).toBeTruthy();
    if (first) cleanup.identityIds.push(first);

    const second = await findOrCreateWorkIdentity(
      { key: `work:${marker}:bytes-b`, canonicalTitle: "Irwin ViceReason 2001", authorSurname: null, role: "primary", evidence: "test" },
      [],
      { contentHash: hash },
    );
    expect(second).toBe(first);
  });
});
