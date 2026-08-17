import { bibliographicRecords, db, researchClaims, researchCorpusItems } from "@ice/db";
import { and, eq, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// import_corpus writes (Phase 28.2). Zero AI cost — every write below is
// either a real-provider-payload insert or a read-only lookup/link.
// ---------------------------------------------------------------------------

export interface NewCorpusItem {
  source: string;
  externalId: string;
  dedupKey: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  venue: string | null;
  raw: unknown;
}

export interface UpsertCorpusItemResult {
  id: string;
  /** False when this exact `(user_id, dedup_key)` already existed — the
   *  dedup-idempotency case ("import the same paper twice" reuses the row
   *  rather than duplicating it). */
  wasNew: boolean;
}

/** Inserts one corpus item, respecting the `(user_id, dedup_key)` unique
 *  index. On a dedup hit, re-selects and returns the EXISTING row's id
 *  (never a second insert) — the caller still needs an id to link into a
 *  project even when nothing new was written. */
export async function upsertResearchCorpusItem(userId: string, item: NewCorpusItem): Promise<UpsertCorpusItemResult> {
  const [inserted] = await db
    .insert(researchCorpusItems)
    .values({
      userId,
      source: item.source as (typeof researchCorpusItems.$inferInsert)["source"],
      externalId: item.externalId,
      dedupKey: item.dedupKey,
      title: item.title,
      authors: item.authors,
      year: item.year,
      doi: item.doi,
      url: item.url,
      abstract: item.abstract,
      venue: item.venue,
      raw: item.raw,
    })
    .onConflictDoNothing({ target: [researchCorpusItems.userId, researchCorpusItems.dedupKey] })
    .returning({ id: researchCorpusItems.id });
  if (inserted) return { id: inserted.id, wasNew: true };

  const [existing] = await db
    .select({ id: researchCorpusItems.id })
    .from(researchCorpusItems)
    .where(and(eq(researchCorpusItems.userId, userId), eq(researchCorpusItems.dedupKey, item.dedupKey)))
    .limit(1);
  if (!existing) {
    // Unreachable in practice (the conflict that just happened proves a
    // matching row exists), but never silently swallow a genuine anomaly.
    throw new Error(`Corpus item upsert conflicted on dedupKey ${item.dedupKey} but no existing row was found.`);
  }
  return { id: existing.id, wasNew: false };
}

/** Read-only DOI match against the shared `bibliographic_record` catalog —
 *  "link if an existing one matches", never a creation (plan §28.2's own
 *  scope: no new `bibliographic_record` is written by corpus import). DOI
 *  comparison is case-insensitive since `bibliographic_record.doi` isn't
 *  guaranteed to have been stored through the same `canonicalizeDoi()` path
 *  every provider payload was. */
export async function findBibliographicRecordByDoi(doi: string): Promise<{ id: string; title: string } | null> {
  const [row] = await db
    .select({ id: bibliographicRecords.id, title: bibliographicRecords.title })
    .from(bibliographicRecords)
    .where(sql`lower(${bibliographicRecords.doi}) = ${doi.toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

/** Every DOI a set of corpus items carry (lowercased, `null` when a corpus
 *  item has none) — `detectRelationships.ts`'s work↔corpus-item citation
 *  engagement pre-join input (the other half is `loadCitationEngagementDoisForWorks`
 *  in `citationEngagement.ts`). No corpus↔corpus engagement is ever derived
 *  from this alone (a corpus item's own outbound citations are never known —
 *  only its abstract was ever fetched, never a references list). */
export async function loadCorpusItemDois(corpusItemIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (corpusItemIds.length === 0) return out;
  const rows = await db
    .select({ id: researchCorpusItems.id, doi: researchCorpusItems.doi })
    .from(researchCorpusItems)
    .where(inArray(researchCorpusItems.id, corpusItemIds));
  for (const row of rows) out.set(row.id, row.doi ? row.doi.toLowerCase() : null);
  return out;
}

// ---------------------------------------------------------------------------
// extract_claims — corpus-item (abstract-source) path (Phase 30 fix lane,
// D-25-13). Sibling of the "Work extraction scope"/"research_claim writes"
// sections above, scoped to a single `research_corpus_item` instead of an
// uploaded work's published run.
// ---------------------------------------------------------------------------

export interface CorpusItemExtractionScope {
  userId: string;
  corpusItemId: string;
  title: string;
  /** Null when the provider never supplied one — the caller's honest
   *  "nothing to extract from" failure, not this loader's concern. */
  abstract: string | null;
}

export async function loadCorpusItemForExtraction(corpusItemId: string): Promise<CorpusItemExtractionScope | null> {
  const [row] = await db
    .select({ userId: researchCorpusItems.userId, title: researchCorpusItems.title, abstract: researchCorpusItems.abstract })
    .from(researchCorpusItems)
    .where(eq(researchCorpusItems.id, corpusItemId))
    .limit(1);
  if (!row) return null;
  return { userId: row.userId, corpusItemId, title: row.title, abstract: row.abstract };
}

export interface NewCorpusResearchClaim {
  userId: string;
  corpusItemId: string;
  claimText: string;
  claimNature: string;
  confidence: string;
  section: string;
  supportingExcerpt: string;
  contentHash: string;
  promptVersion: string;
}

/**
 * Inserts one corpus-item-sourced claim — the abstract-source sibling of
 * `insertResearchClaim` below. Per `research_claim`'s own schema doc comment,
 * a corpus-item claim is grounded via `source_scope = 'abstract'` alone
 * (`research_claim_grounded` CHECK) with no `text_block_id` to anchor to (no
 * text_block exists for an abstract) — `anchor_state` is `unanchored`, the
 * exact case that enum value's own doc comment names ("a corpus-item-sourced
 * claim was never anchored to any block at all"), distinct from the
 * lost-anchor-after-reprocess case work-sourced claims use it for.
 * `quote`/`prefix`/`suffix` stay SQL NULL (never a fabricated anchor).
 * Dedup respects `research_claim_corpus_item_dedup_unique`
 * (`corpus_item_id, content_hash, prompt_version`), the exact partial-unique
 * counterpart to `insertResearchClaim`'s work-scoped one.
 */
export async function insertResearchClaimForCorpusItem(claim: NewCorpusResearchClaim): Promise<string | null> {
  const [inserted] = await db
    .insert(researchClaims)
    .values({
      userId: claim.userId,
      corpusItemId: claim.corpusItemId,
      anchorState: "unanchored",
      claimText: claim.claimText,
      claimNature: claim.claimNature as (typeof researchClaims.$inferInsert)["claimNature"],
      confidence: claim.confidence,
      section: claim.section,
      sourceScope: "abstract",
      supportingExcerpt: claim.supportingExcerpt,
      excerptVerified: true,
      contentHash: claim.contentHash,
      promptVersion: claim.promptVersion,
    })
    .onConflictDoNothing({
      target: [researchClaims.corpusItemId, researchClaims.contentHash, researchClaims.promptVersion],
      where: sql`${researchClaims.corpusItemId} is not null`,
    })
    .returning({ id: researchClaims.id });
  return inserted?.id ?? null;
}
