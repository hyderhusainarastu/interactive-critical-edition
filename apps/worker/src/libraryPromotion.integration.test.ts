import { db, learningResources, resourceRoles, users, workIdentities, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Integration tests proving the exact Library-promotion write shape
 * `analyze.ts`'s v3-only promotion block uses (plan §34.4 9.5) round-trips
 * through Drizzle against real Postgres, and specifically that its two
 * idempotency safeguards hold on a repeat run over the same work/resource:
 * `work_identity` is found-or-created by `workKey` (not duplicated — mirrors
 * `findOrCreateWorkIdentity` in analyze.ts, including the
 * onConflictDoNothing-then-reselect race guard `work_identity.workKey`'s
 * unique constraint requires, unlike `bibliographic_records`), and
 * `learning_resource`/`resource_role` are upserted by their own unique keys
 * (`normalizedKey`, and `(learningResourceId, workIdentityId, readerLevel)`
 * respectively) rather than accumulating duplicate rows. Skipped when
 * DATABASE_URL is unset, same as `concepts.integration.test.ts`.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

async function seedUserAndWork() {
  const [user] = await db.insert(users).values({ email: `lib-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [work] = await db.insert(works).values({ userId: user.id, title: "Test Work", authorName: "Test Author" }).returning({ id: works.id });
  return { userId: user.id, workId: work.id };
}

/** Mirrors analyze.ts's findOrCreateWorkIdentity. */
async function findOrCreateWorkIdentity(input: { workKey: string; canonicalTitle: string; authorSurname: string | null; authors: string[]; evidence: string }) {
  const inserted = await db
    .insert(workIdentities)
    .values({
      workKey: input.workKey,
      canonicalTitle: input.canonicalTitle,
      authorSurname: input.authorSurname,
      authors: input.authors,
      evidence: input.evidence,
    })
    .onConflictDoNothing({ target: workIdentities.workKey })
    .returning({ id: workIdentities.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.workKey, input.workKey)).limit(1);
  return existing!.id;
}

/** Mirrors analyze.ts's per-resource learning_resource/resource_role upsert. */
async function promoteResource(input: {
  normalizedKey: string;
  title: string;
  resourceWorkIdentityId: string | null;
  primaryWorkIdentityId: string;
  relationship: "interpretive_aid" | "prerequisite";
  confidence: number;
}) {
  const libraryFields = {
    workIdentityId: input.resourceWorkIdentityId,
    title: input.title,
    provider: "test",
    resourceType: "article",
  };
  const [learningResource] = await db
    .insert(learningResources)
    .values({ ...libraryFields, normalizedKey: input.normalizedKey })
    .onConflictDoUpdate({ target: learningResources.normalizedKey, set: { ...libraryFields, updatedAt: new Date() } })
    .returning({ id: learningResources.id });

  await db
    .insert(resourceRoles)
    .values({
      learningResourceId: learningResource.id,
      workIdentityId: input.primaryWorkIdentityId,
      relationship: input.relationship,
      readerLevel: null,
      confidence: input.confidence,
      createdBy: "system",
    })
    .onConflictDoUpdate({
      target: [resourceRoles.learningResourceId, resourceRoles.workIdentityId, resourceRoles.readerLevel],
      set: { relationship: input.relationship, confidence: input.confidence },
    });

  return learningResource.id;
}

describe.skipIf(!hasDb)("Library promotion — work_identity/learning_resource/resource_role (integration)", () => {
  const cleanupUsers: string[] = [];
  const cleanupIdentities: string[] = [];
  const cleanupResources: string[] = [];
  afterEach(async () => {
    while (cleanupUsers.length) await db.delete(users).where(eq(users.id, cleanupUsers.pop()!));
    while (cleanupResources.length) await db.delete(learningResources).where(eq(learningResources.id, cleanupResources.pop()!));
    while (cleanupIdentities.length) await db.delete(workIdentities).where(eq(workIdentities.id, cleanupIdentities.pop()!));
  });

  it("creates a work_identity row with the given key", async () => {
    const key = `work:test:${crypto.randomUUID()}`;
    const id = await findOrCreateWorkIdentity({ workKey: key, canonicalTitle: "Test Work", authorSurname: "author", authors: ["Test Author"], evidence: "title/author match" });
    cleanupIdentities.push(id);

    const [row] = await db.select().from(workIdentities).where(eq(workIdentities.id, id));
    expect(row).toMatchObject({ workKey: key, canonicalTitle: "Test Work", authorSurname: "author" });
  });

  it("reuses an existing work_identity by workKey rather than duplicating it, keeping the first run's data", async () => {
    const key = `work:test:${crypto.randomUUID()}`;
    const firstId = await findOrCreateWorkIdentity({ workKey: key, canonicalTitle: "First Run Title", authorSurname: "author", authors: ["Test Author"], evidence: "e1" });
    cleanupIdentities.push(firstId);

    const secondId = await findOrCreateWorkIdentity({ workKey: key, canonicalTitle: "Second Run Title", authorSurname: "author", authors: ["Test Author"], evidence: "e2" });
    expect(secondId).toBe(firstId);

    const rows = await db.select().from(workIdentities).where(eq(workIdentities.workKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0].canonicalTitle).toBe("First Run Title"); // untouched — the find-or-create never overwrites
  });

  it("upserts a learning_resource by normalizedKey, refreshing fields rather than duplicating the row", async () => {
    const { userId, workId } = await seedUserAndWork();
    cleanupUsers.push(userId);
    const primaryId = await findOrCreateWorkIdentity({ workKey: `work:primary:${crypto.randomUUID()}`, canonicalTitle: "Primary Work", authorSurname: null, authors: [], evidence: "e" });
    cleanupIdentities.push(primaryId);
    await db.update(works).set({ workIdentityId: primaryId }).where(eq(works.id, workId));

    const key = `title:${crypto.randomUUID()}`;
    const firstId = await promoteResource({ normalizedKey: key, title: "First Run Title", resourceWorkIdentityId: null, primaryWorkIdentityId: primaryId, relationship: "interpretive_aid", confidence: 0.5 });
    cleanupResources.push(firstId);

    const secondId = await promoteResource({ normalizedKey: key, title: "Second Run Title", resourceWorkIdentityId: null, primaryWorkIdentityId: primaryId, relationship: "prerequisite", confidence: 0.9 });
    expect(secondId).toBe(firstId);

    const resourceRows = await db.select().from(learningResources).where(eq(learningResources.normalizedKey, key));
    expect(resourceRows).toHaveLength(1);
    expect(resourceRows[0].title).toBe("Second Run Title"); // upsert refreshes — "a later run has better data"

    const roleRows = await db.select().from(resourceRoles).where(eq(resourceRoles.learningResourceId, firstId));
    expect(roleRows).toHaveLength(1); // not duplicated on the resource_role unique constraint either
    expect(roleRows[0]).toMatchObject({ relationship: "prerequisite", confidence: 0.9 });
  });

  it("cascades resource_role deletion when its learning_resource is deleted", async () => {
    const { userId, workId } = await seedUserAndWork();
    cleanupUsers.push(userId);
    const primaryId = await findOrCreateWorkIdentity({ workKey: `work:primary:${crypto.randomUUID()}`, canonicalTitle: "Primary Work", authorSurname: null, authors: [], evidence: "e" });
    cleanupIdentities.push(primaryId);
    await db.update(works).set({ workIdentityId: primaryId }).where(eq(works.id, workId));

    const resourceId = await promoteResource({ normalizedKey: `title:${crypto.randomUUID()}`, title: "R", resourceWorkIdentityId: null, primaryWorkIdentityId: primaryId, relationship: "interpretive_aid", confidence: 0.5 });
    await db.delete(learningResources).where(eq(learningResources.id, resourceId));

    const remaining = await db.select().from(resourceRoles).where(eq(resourceRoles.learningResourceId, resourceId));
    expect(remaining).toHaveLength(0);
  });
});
