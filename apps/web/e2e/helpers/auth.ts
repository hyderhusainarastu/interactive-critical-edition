import {
  cancelQueuedJobsForDocuments,
  db,
  documents,
  feedback,
  learningResources,
  passwordResetTokens,
  resourceRoles,
  usageEvents,
  userDeletionArchives,
  users,
  workIdentities,
  works,
} from "@ice/db";
import { deleteDocumentFile } from "@ice/ingestion";
import { generateToken } from "@/lib/tokens";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";

/**
 * Seeds a password-reset token exactly the way `requestPasswordReset` does
 * (same `generateToken()` hashing), so a test can drive the real
 * `/reset-password?token=...` UI end to end without needing the raw token
 * from the console-logged email (by design, only the SHA-256 hash is ever
 * stored — see `docs/PROJECT-LOG.md`'s tokens note). This is setup, not the
 * thing under test: token verification/expiry and the reset form itself are
 * exercised for real through the browser.
 */
export async function seedPasswordResetToken(email: string): Promise<string> {
  const { raw, hash } = generateToken();
  await db.insert(passwordResetTokens).values({
    identifier: email.toLowerCase(),
    token: hash,
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });
  return raw;
}

/**
 * E2E fixtures talk to the DB directly for setup/teardown that isn't
 * the thing under test (e.g. creating an already-verified user) — the
 * signup/verify/reset flow itself is covered separately (manually
 * verified end-to-end in Phase 1/2; not re-driven here since the raw
 * verification token is only ever available via the console-logged
 * email, not recoverable from the DB by design — tokens are stored
 * hashed, see lib/tokens.ts).
 */
export async function createVerifiedTestUser(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({ name: "E2E Test", email, passwordHash, emailVerified: new Date() })
    .returning({ id: users.id });
  return user.id;
}

/**
 * Deletes the test user AND the Storage files their documents point
 * to — the DB cascade (onDelete: cascade on documents.user_id) cleans
 * up rows fine, but Storage objects aren't part of that cascade at all
 * (Postgres has no idea Supabase Storage exists), so every test run
 * that uploads a file would otherwise leak it into the bucket forever.
 * Found this the hard way: 16 orphaned files accumulated in Storage
 * from earlier manual + first E2E test runs before this existed.
 * Same gap applies to pg-boss: any still-queued `extract-text`/
 * `analyze-work` job for one of this user's documents survives the
 * user delete (pgboss.job has no FK to document either) and later
 * fails noisily as "Document not found" once a worker dequeues it —
 * found via a local worker boot draining hours of these from prior
 * test runs during the Phase 19 backend/data audit (D-19-2).
 *
 * D-20-65: `work_identity`/`learning_resource` are shared, unscoped catalog
 * tables with no user FK at all (same design precedent as
 * `bibliographic_record` — see PROJECT-LOG Design Decisions), so nothing in
 * the user-delete cascade ever reaches them, and every seed helper below
 * that creates one leaks it into the shared local Postgres forever (found
 * at 1,500+/1,973+ rows respectively before this fix). Every one of those
 * helpers tags its rows with a recognizable test-only key so a sweep can
 * find them without guessing: `work:test:...`/`work:graph-test:...`
 * `work_identity.work_key`s, and `title:...`/`seeded-lr-...`
 * `learning_resource.normalized_key`s. Production's real identity keys
 * (`work:<hash>` from `apps/worker/src/analyze.ts`'s `identity.key`) never
 * match either pattern, so this sweep can never touch real canonical data
 * even if this helper were ever pointed at a non-test database.
 *
 * Workstream G (v.5): `usage_event`, `user_deletion_archive`, and
 * `feedback` ALSO don't cascade from `users` — `usage_event`/
 * `user_deletion_archive.user_id` are deliberately not foreign keys at all
 * (both need to survive the very account deletion this helper simulates in
 * some specs), and `feedback.user_id` is `set null` rather than cascade (a
 * submitted bug report should outlive the account that filed it in
 * production). All three are swept by user id BEFORE the user row is
 * deleted below — `feedback` specifically has to run first, since deleting
 * the user first would `set null` its `user_id` and this sweep would no
 * longer be able to find those rows by id at all.
 */
const TEST_WORK_IDENTITY_KEY_PATTERN = /^work:(test|graph-test):/;
const TEST_LEARNING_RESOURCE_KEY_PATTERN = /^(title:|seeded-lr-)/;

export async function deleteTestUser(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return;

  const docs = await db
    .select({ id: documents.id, storagePath: documents.storagePath })
    .from(documents)
    .where(eq(documents.userId, user.id));

  await Promise.all(docs.map((d) => deleteDocumentFile(d.storagePath).catch(() => {})));
  await cancelQueuedJobsForDocuments(docs.map((d) => d.id));

  // Collect every work_identity this user's own works reference, BEFORE the
  // cascading delete removes those works — this is the only place they're
  // still reachable via `works.work_identity_id`.
  const ownedIdentityRows = await db
    .selectDistinct({ id: workIdentities.id })
    .from(works)
    .innerJoin(workIdentities, eq(works.workIdentityId, workIdentities.id))
    .where(eq(works.userId, user.id));
  const candidateIdentityIds = new Set(ownedIdentityRows.map((r) => r.id));

  // A recommended (not-owned) learning_resource carries its OWN canonical
  // identity directly on `learning_resource.work_identity_id`, reached only
  // via `resource_role.work_identity_id` pointing at one of the identities
  // above (see `seedLibraryItemForSourceAttach`) — collect both directions
  // before anything is deleted.
  let candidateLearningResourceIds: string[] = [];
  if (candidateIdentityIds.size > 0) {
    const roleRows = await db
      .selectDistinct({ id: resourceRoles.learningResourceId })
      .from(resourceRoles)
      .where(inArray(resourceRoles.workIdentityId, [...candidateIdentityIds]));
    candidateLearningResourceIds = roleRows.map((r) => r.id);

    if (candidateLearningResourceIds.length > 0) {
      const ownIdentityRows = await db
        .select({ id: learningResources.workIdentityId })
        .from(learningResources)
        .where(inArray(learningResources.id, candidateLearningResourceIds));
      for (const row of ownIdentityRows) if (row.id) candidateIdentityIds.add(row.id);
    }
  }

  // Workstream J/H (v.5): none of these three tables cascade on user
  // delete by design (feedback.user_id is `set null`, not cascade — meant
  // to outlive the account; usage_event/user_deletion_archive have no FK
  // at all — see schema.ts). feedback specifically MUST be swept before
  // the delete below: once the user row is gone, `set null` fires and
  // these rows can no longer be found by userId at all. The other two
  // would work either order (no FK to null out), but are grouped here for
  // one clear sweep rather than splitting pre/post for no reason.
  await db.delete(feedback).where(eq(feedback.userId, user.id));
  await db.delete(usageEvents).where(eq(usageEvents.userId, user.id));
  await db.delete(userDeletionArchives).where(eq(userDeletionArchives.userId, user.id));

  await db.delete(users).where(eq(users.id, user.id));

  // Only delete a candidate if (a) its key still matches the test-only
  // pattern and (b) no work anywhere still references it — the second
  // check is what keeps a concurrent test's still-live fixture (same key
  // pattern, different random suffix) safe from this sweep.
  for (const identityId of candidateIdentityIds) {
    const [identity] = await db.select({ workKey: workIdentities.workKey }).from(workIdentities).where(eq(workIdentities.id, identityId)).limit(1);
    if (!identity || !TEST_WORK_IDENTITY_KEY_PATTERN.test(identity.workKey)) continue;
    const [stillOwned] = await db.select({ id: works.id }).from(works).where(eq(works.workIdentityId, identityId)).limit(1);
    if (stillOwned) continue;
    // Cascades any resource_role still pointing at this identity.
    await db.delete(workIdentities).where(eq(workIdentities.id, identityId));
  }

  for (const learningResourceId of candidateLearningResourceIds) {
    const [resource] = await db
      .select({ normalizedKey: learningResources.normalizedKey })
      .from(learningResources)
      .where(eq(learningResources.id, learningResourceId))
      .limit(1);
    if (!resource || !TEST_LEARNING_RESOURCE_KEY_PATTERN.test(resource.normalizedKey)) continue;
    const [stillReferenced] = await db.select({ id: resourceRoles.id }).from(resourceRoles).where(eq(resourceRoles.learningResourceId, learningResourceId)).limit(1);
    if (stillReferenced) continue;
    await db.delete(learningResources).where(eq(learningResources.id, learningResourceId));
  }
}
