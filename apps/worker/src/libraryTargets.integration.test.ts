import { bibliographicRecords, db, learningResources, readingRecords, understandingRatings, users, workIdentities, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Migration 0018 (plan §34.4 9.5) adds a third polymorphic target
 * (`learningResourceId`) to `reading_record`/`understanding_rating`, alongside
 * the existing `workId`/`bibId`, and enforces "exactly one of the three" with
 * a DB CHECK constraint — not just an app-level convention, same precedent as
 * `passage_annotation`'s anchor-or-whole-work constraint (9.3). These tests
 * prove the constraint holds via the ORM, not just the raw-SQL check already
 * run manually against local Postgres before the migration was applied.
 * Skipped when DATABASE_URL is unset, same as passageAnnotations.integration.test.ts.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

async function seedUserWorkBibLearningResource() {
  const [user] = await db.insert(users).values({ email: `lt-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [work] = await db.insert(works).values({ userId: user.id, title: "Test Work" }).returning({ id: works.id });
  const [bib] = await db
    .insert(bibliographicRecords)
    .values({ source: "test", title: "Test Bib", accessStatus: "metadata_only" })
    .returning({ id: bibliographicRecords.id });
  const [resource] = await db
    .insert(learningResources)
    .values({ title: "Test Resource", normalizedKey: `lt:${crypto.randomUUID()}`, provider: "test" })
    .returning({ id: learningResources.id });
  return { userId: user.id, workId: work.id, bibId: bib.id, learningResourceId: resource.id };
}

describe.skipIf(!hasDb)("reading_record / understanding_rating exactly-one-target CHECK (integration)", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    while (cleanup.length) await db.delete(users).where(eq(users.id, cleanup.pop()!));
  });

  it("accepts exactly one target (learningResourceId) on reading_record", async () => {
    const { userId, learningResourceId } = await seedUserWorkBibLearningResource();
    cleanup.push(userId);
    await db.insert(readingRecords).values({ userId, learningResourceId, status: "planned" });
    const [row] = await db.select().from(readingRecords).where(eq(readingRecords.userId, userId));
    expect(row).toMatchObject({ learningResourceId, workId: null, bibId: null });
  });

  it("rejects a reading_record with zero targets set", async () => {
    const { userId } = await seedUserWorkBibLearningResource();
    cleanup.push(userId);
    await expect(db.insert(readingRecords).values({ userId, status: "planned" })).rejects.toThrow();
  });

  it("rejects a reading_record with two targets set (workId + bibId)", async () => {
    const { userId, workId, bibId } = await seedUserWorkBibLearningResource();
    cleanup.push(userId);
    await expect(db.insert(readingRecords).values({ userId, workId, bibId, status: "planned" })).rejects.toThrow();
  });

  it("rejects a reading_record with all three targets set", async () => {
    const { userId, workId, bibId, learningResourceId } = await seedUserWorkBibLearningResource();
    cleanup.push(userId);
    await expect(
      db.insert(readingRecords).values({ userId, workId, bibId, learningResourceId, status: "planned" }),
    ).rejects.toThrow();
  });

  it("rejects an understanding_rating with two targets set (bibId + learningResourceId)", async () => {
    const { userId, bibId, learningResourceId } = await seedUserWorkBibLearningResource();
    cleanup.push(userId);
    await expect(
      db.insert(understandingRatings).values({ userId, bibId, learningResourceId, score: 50 }),
    ).rejects.toThrow();
  });

  it("cascades reading_record deletion when its learning_resource is deleted", async () => {
    const { userId, learningResourceId } = await seedUserWorkBibLearningResource();
    cleanup.push(userId);
    await db.insert(readingRecords).values({ userId, learningResourceId, status: "reading" });
    await db.delete(learningResources).where(eq(learningResources.id, learningResourceId));
    const remaining = await db.select().from(readingRecords).where(eq(readingRecords.userId, userId));
    expect(remaining).toHaveLength(0);
  });

  it("nulls out work.workIdentityId when the linked work_identity is deleted", async () => {
    const [user] = await db.insert(users).values({ email: `lt-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanup.push(user.id);
    const [identity] = await db
      .insert(workIdentities)
      .values({ workKey: `work:test:${crypto.randomUUID()}`, canonicalTitle: "Test Identity" })
      .returning({ id: workIdentities.id });
    const [work] = await db
      .insert(works)
      .values({ userId: user.id, title: "Test Work", workIdentityId: identity.id })
      .returning({ id: works.id });
    await db.delete(workIdentities).where(eq(workIdentities.id, identity.id));
    const [row] = await db.select().from(works).where(eq(works.id, work.id));
    expect(row.workIdentityId).toBeNull();
  });
});
