import { bibliographicRecords, db, workIdentities } from "@ice/db";
import {
  canonicalizeDoi,
  canonicalizeIsbn,
  type RawResource,
  type WorkIdentityKey,
} from "@ice/research";
import { eq, sql } from "drizzle-orm";

/** Project a scholarly book/article resource into the shared bibliographic
 *  catalogue, deduped by DOI/ISBN/normalized title (returns the record id). */
export async function findOrCreateBibFromResource(r: RawResource): Promise<string | null> {
  const doi = canonicalizeDoi(r.doi);
  const isbn = canonicalizeIsbn(r.isbn);
  if (doi) {
    const [ex] = await db.select({ id: bibliographicRecords.id }).from(bibliographicRecords).where(eq(bibliographicRecords.doi, doi)).limit(1);
    if (ex) return ex.id;
  }
  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: r.provider,
      externalId: isbn ?? null,
      title: r.title,
      authors: r.authors.join(", ") || null,
      year: r.year,
      doi,
      url: r.url,
      accessStatus: "metadata_only",
      raw: r.raw,
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

/**
 * Find-or-create the shared `work_identity` row for a computed identity key
 * (plan §34.4 9.5), upgraded in Phase 20.6 to run the canonical-identity
 * precedence chain BEFORE the title/author key: verified DOI, then verified
 * ISBN, then canonical provider id, then the `workKey` (normalized
 * title+author), then a verified upload content hash. Identifiers are only
 * ever accepted from PRIMARY-role records — a review carries its own DOI,
 * and storing it here is exactly how one work becomes five entries — and
 * only backfilled onto an existing identity when the column is still null,
 * never overwritten.
 *
 * Unlike `findOrCreateBibFromResource`'s catalogue, `work_identity.workKey`
 * carries a real unique constraint, so a plain select-then-insert can lose a
 * race between two concurrent runs that resolve to the same work —
 * `onConflictDoNothing` + re-select closes it.
 */
export async function findOrCreateWorkIdentity(
  identity: WorkIdentityKey,
  authors: string[],
  verified: { doi?: string | null; isbn?: string | null; externalId?: string | null; contentHash?: string | null; year?: number | null } = {},
): Promise<string | null> {
  const doi = canonicalizeDoi(verified.doi);
  const isbn = canonicalizeIsbn(verified.isbn);
  const externalId = verified.externalId?.trim().toLowerCase() || null;
  const contentHash = verified.contentHash?.trim() || null;

  const backfill = async (id: string) => {
    if (!doi && !isbn && !externalId && !contentHash) return;
    await db
      .update(workIdentities)
      .set({
        doi: sql`coalesce(${workIdentities.doi}, ${doi})`,
        isbn: sql`coalesce(${workIdentities.isbn}, ${isbn})`,
        externalId: sql`coalesce(${workIdentities.externalId}, ${externalId})`,
        contentHash: sql`coalesce(${workIdentities.contentHash}, ${contentHash})`,
        updatedAt: new Date(),
      })
      .where(eq(workIdentities.id, id));
  };

  // Precedence 1–3: a verified identifier outranks the title/author key.
  for (const clause of [
    doi ? eq(workIdentities.doi, doi) : null,
    isbn ? eq(workIdentities.isbn, isbn) : null,
    externalId ? eq(workIdentities.externalId, externalId) : null,
  ]) {
    if (!clause) continue;
    const [match] = await db.select({ id: workIdentities.id }).from(workIdentities).where(clause).limit(1);
    if (match) {
      await backfill(match.id);
      return match.id;
    }
  }

  // Precedence 4: the normalized title+author key (the unique `workKey`).
  const [byKey] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.workKey, identity.key)).limit(1);
  if (byKey) {
    await backfill(byKey.id);
    return byKey.id;
  }

  // Precedence 5: identical uploaded bytes — the same document re-uploaded
  // under a different filename can extract a slightly different title.
  if (contentHash) {
    const [byHash] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.contentHash, contentHash)).limit(1);
    if (byHash) {
      await backfill(byHash.id);
      return byHash.id;
    }
  }

  const inserted = await db
    .insert(workIdentities)
    .values({
      workKey: identity.key,
      canonicalTitle: identity.canonicalTitle,
      authorSurname: identity.authorSurname,
      authors,
      year: verified.year ?? null,
      doi,
      isbn,
      externalId,
      contentHash,
      evidence: identity.evidence,
    })
    .onConflictDoNothing({ target: workIdentities.workKey })
    .returning({ id: workIdentities.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.workKey, identity.key)).limit(1);
  if (existing) await backfill(existing.id);
  return existing?.id ?? null;
}
