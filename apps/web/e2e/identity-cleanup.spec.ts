import { expect, test } from "@playwright/test";
import { db, learningResources, resourceRoles, workIdentities, works } from "@ice/db";
import { eq } from "drizzle-orm";
import {
  createVerifiedTestUser,
  deleteTestUser,
  seedLibraryItemForSourceAttach,
  seedWorkWithLibraryItem,
} from "./helpers";

/**
 * D-20-65 regression: `work_identity`/`learning_resource` are shared,
 * unscoped catalog tables (no user FK — same design precedent as
 * `bibliographic_record`, see PROJECT-LOG Design Decisions), so a plain
 * cascading user delete never touches rows an E2E seed helper created for
 * them. Before the fix, this local DB had accumulated 1,500+ `work_identity`
 * and 1,973+ `learning_resource` rows purely from prior test runs never
 * being cleaned up.
 *
 * `deleteTestUser` must sweep the test-only-tagged rows (recognizable
 * `work:test:...`/`work:graph-test:...` workKeys and `title:...`/
 * `seeded-lr-...` normalizedKeys) reachable from the deleted user's own
 * works, while leaving any still-live fixture from a concurrent test alone.
 */
test.describe("D-20-65: deleteTestUser cleans up its own work_identity/learning_resource rows", () => {
  test("workIdentity + learningResource + resourceRole created by seedWorkWithLibraryItem are gone after deleteTestUser", async () => {
    const email = `e2e-d20-65-a-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, "password123");

    const { workId, resourceId } = await seedWorkWithLibraryItem(userId, {});

    const [before] = await db.select({ id: works.workIdentityId }).from(works).where(eq(works.id, workId)).limit(1);
    const identityId = before?.id;
    expect(identityId).toBeTruthy();

    await deleteTestUser(email);

    const [identityAfter] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.id, identityId!)).limit(1);
    expect(identityAfter, "work_identity row should be swept once its only owning work is gone").toBeUndefined();

    const [resourceAfter] = await db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
    expect(resourceAfter, "learning_resource row should be swept once no resource_role references it").toBeUndefined();

    const roleRows = await db.select({ id: resourceRoles.id }).from(resourceRoles).where(eq(resourceRoles.learningResourceId, resourceId));
    expect(roleRows.length, "resource_role rows should be gone too (cascaded from the identity delete)").toBe(0);
  });

  test("a resource's own canonical identity (not directly owned by any work) is also swept", async () => {
    const email = `e2e-d20-65-b-${Date.now()}@example.com`;
    const userId = await createVerifiedTestUser(email, "password123");

    const { resourceId, resourceWorkIdentityId, recommendingWorkId } = await seedLibraryItemForSourceAttach(userId, {});

    await deleteTestUser(email);

    const [identityAfter] = await db
      .select({ id: workIdentities.id })
      .from(workIdentities)
      .where(eq(workIdentities.id, resourceWorkIdentityId))
      .limit(1);
    expect(identityAfter, "the resource's own work_identity (reachable only via learning_resource.work_identity_id, not a work) should be swept").toBeUndefined();

    const [resourceAfter] = await db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
    expect(resourceAfter, "the learning_resource row should be swept").toBeUndefined();

    const [recommendingWork] = await db.select({ id: works.id }).from(works).where(eq(works.id, recommendingWorkId)).limit(1);
    expect(recommendingWork, "the owning user's work row should already be gone via the normal cascade").toBeUndefined();
  });

  test("a concurrent test's still-live fixture using the same key patterns is left untouched", async () => {
    const emailA = `e2e-d20-65-c-a-${Date.now()}@example.com`;
    const emailB = `e2e-d20-65-c-b-${Date.now()}@example.com`;
    const userIdA = await createVerifiedTestUser(emailA, "password123");
    const userIdB = await createVerifiedTestUser(emailB, "password123");

    await seedWorkWithLibraryItem(userIdA, {});
    const b = await seedWorkWithLibraryItem(userIdB, {});

    await deleteTestUser(emailA);

    const [bIdentity] = await db.select({ id: works.workIdentityId }).from(works).where(eq(works.id, b.workId)).limit(1);
    expect(bIdentity?.id, "user B's still-live work_identity must survive user A's cleanup").toBeTruthy();
    const [bResource] = await db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.id, b.resourceId)).limit(1);
    expect(bResource, "user B's still-live learning_resource must survive user A's cleanup").toBeTruthy();

    await deleteTestUser(emailB);
  });
});
