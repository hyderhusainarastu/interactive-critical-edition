import {
  annotations,
  bibliographicRecords,
  bookmarks,
  db,
  documents,
  highlights,
  notes,
  users,
  works,
} from "@ice/db";
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

/**
 * Seeds a ready work + document plus one of every per-user reader/analysis
 * record for the given user, returning the ids — so the authorization
 * matrix (security.spec.ts) has real resources to try to reach as a
 * different user. No Storage upload (the storage path is a placeholder;
 * these tests never fetch the file).
 */
export async function seedOwnedWork(userId: string): Promise<{
  workId: string;
  documentId: string;
  highlightId: string;
  noteId: string;
  bookmarkId: string;
  annotationId: string;
}> {
  const [work] = await db
    .insert(works)
    .values({ userId, title: "Owner's Private Work", authorName: "Owner" })
    .returning({ id: works.id });
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: work.id,
      storagePath: `${userId}/${work.id}/none.txt`,
      originalFilename: "none.txt",
      mimeType: "text/plain",
      fileSize: 100,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: "Private text. Kant is referenced here.",
    })
    .returning({ id: documents.id });
  const [hl] = await db
    .insert(highlights)
    .values({ userId, documentId: doc.id, anchor: { kind: "text", paragraphIndex: 0, quote: "Private", prefix: "", suffix: " text" }, color: "gold" })
    .returning({ id: highlights.id });
  const [note] = await db
    .insert(notes)
    .values({ userId, documentId: doc.id, body: "owner note" })
    .returning({ id: notes.id });
  const [bm] = await db
    .insert(bookmarks)
    .values({ userId, documentId: doc.id, position: { kind: "text", paragraphIndex: 0 }, label: "Paragraph 1" })
    .returning({ id: bookmarks.id });
  const [bib] = await db
    .insert(bibliographicRecords)
    .values({ source: "openalex", title: "Critique of Pure Reason", authors: "Kant", accessStatus: "open" })
    .returning({ id: bibliographicRecords.id });
  const [ann] = await db
    .insert(annotations)
    .values({
      userId,
      documentId: doc.id,
      relationshipCategory: "explicit_reference",
      targetBibId: bib.id,
      targetLabel: "Critique of Pure Reason",
      explanation: "owner annotation",
      confidence: 0.6,
      createdBy: "system",
    })
    .returning({ id: annotations.id });

  return {
    workId: work.id,
    documentId: doc.id,
    highlightId: hl.id,
    noteId: note.id,
    bookmarkId: bm.id,
    annotationId: ann.id,
  };
}
