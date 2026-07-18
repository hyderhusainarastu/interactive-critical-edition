import { db, documents, users } from "@ice/db";
import { deleteDocumentFile } from "@ice/ingestion";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

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
 */
export async function deleteTestUser(email: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return;

  const docs = await db
    .select({ storagePath: documents.storagePath })
    .from(documents)
    .where(eq(documents.userId, user.id));

  await Promise.all(docs.map((d) => deleteDocumentFile(d.storagePath).catch(() => {})));
  await db.delete(users).where(eq(users.id, user.id));
}
