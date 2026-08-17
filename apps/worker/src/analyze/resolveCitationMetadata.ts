import { citations, db, documents, works } from "@ice/db";
import { resolveCitation } from "@ice/bibliographic";
import {
  recognizeClassicalReference,
  type RawCitation,
} from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { eq } from "drizzle-orm";
import { applyResolvedCitation } from "./applyResolvedCitation";
import {
  disqualifiesCitationMatch,
  findCatalogMatchForQuery,
} from "./catalogMatching";
import { type CitationMatch } from "./citationRole";
import {
  applyClassicalCitationResolution,
  findOrCreateBibRecord,
} from "./classicalCitations";

/**
 * Worker-queue consumer for metadata resolution. It is intentionally
 * serialized by the worker queue; this makes external lookup rate-limited and
 * keeps the immediate citation projection independent from provider health.
 */
export async function resolveCitationMetadata(citationId: string): Promise<void> {
  const [citation] = await db
    .select({
      id: citations.id,
      documentId: citations.documentId,
      processingRunId: citations.processingRunId,
      rawText: citations.rawText,
      normalizedQuery: citations.normalizedQuery,
      sourceType: citations.sourceType,
      parserConfidence: citations.parserConfidence,
      sourceAnchor: citations.sourceAnchor,
      resolutionState: citations.resolutionState,
      workId: documents.workId,
      workIdentityId: works.workIdentityId,
      userId: documents.userId,
    })
    .from(citations)
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(citations.id, citationId))
    .limit(1);
  if (!citation) return;
  // Idempotent no-op (D-20-68): a duplicate/retried job (pg-boss retry, or
  // this same citation already having been linked by
  // `linkCitationsToRunDiscoveries` earlier in the same analysis run) must
  // never re-run a live lookup against an already-resolved citation — a
  // slow/failed SECOND attempt at the same external API can otherwise
  // downgrade a citation that was already correctly resolved back to
  // "unresolved". This is exactly the shape of the Annas 1977 canary
  // regression: identical input, resolved once, unresolved the next time.
  if (citation.resolutionState === "resolved") return;

  // Classical (Bekker/Stephanus) citations resolve deterministically from
  // the citation's own stored `rawText` — the recognizer is re-run here
  // rather than trusting a persisted flag (there isn't one; see
  // `RawCitation.classical`'s doc comment for why this stays derived, not
  // stored) so this branch is correct on a reprocess too. Zero provider
  // round-trips: this is the same anti-hallucination posture as every other
  // resolution path, just with a citation whose "catalogue" is a curated
  // page-range table instead of a live lookup. By the time this async job
  // runs, `createCitationLibraryProjection` has already linked the citation
  // to the correct canonical row (it runs synchronously, before this job is
  // even enqueued — see that function's call site), so
  // `applyClassicalCitationResolution`'s merge branch is a no-op here in
  // the normal flow; it only does real work for the maintenance script's
  // `--reproject` path against a citation still linked to a pre-fix stub.
  const classical = recognizeClassicalReference(citation.rawText);
  if (classical) {
    await applyClassicalCitationResolution({
      citationId,
      workId: citation.workId,
      workIdentityId: citation.workIdentityId,
      userId: citation.userId,
      sourceType: citation.sourceType,
      parserConfidence: citation.parserConfidence,
      sourceAnchor: citation.sourceAnchor as RawCitation["anchor"],
      match: classical,
      bridgeRunId: citation.processingRunId,
    });
    return;
  }

  let record: CitationMatch | null = null;
  let bibId: string | null = null;
  try {
    // D-20-81: rawText carries book-form signal (publisher/press/edition
    // words) that cleanQuery deliberately strips from normalizedQuery
    // upstream; resolveCitation still only ever looks UP against the
    // cleaned query, rawText is used solely to pick the provider order.
    const live = await resolveCitation(citation.normalizedQuery, { rawText: citation.rawText });
    // D-23-19: a live provider hit is accepted only if it survives the SAME
    // corroboration guards a catalogue/discovery match must (`bestOverlapMatch`
    // applies them; the live path previously did not). A year-conflicting or
    // review-notice hit is vetoed here, before `findOrCreateBibRecord` ever
    // creates a row for it, so the citation falls through to the catalogue
    // fallback below and then to unresolved — a wrong-work link is strictly
    // worse than staying unresolved (anti-hallucination, plan §11/§12).
    if (live && !disqualifiesCitationMatch(citation.normalizedQuery, live)) {
      record = live;
      bibId = await findOrCreateBibRecord(live);
    }
  } catch (error) {
    // Resolution availability is not a prerequisite for Library coverage.
    reportError(error, { scope: "worker.resolveCitationMetadata", citationId });
  }
  if (!record) {
    const catalogMatch = await findCatalogMatchForQuery(citation.normalizedQuery);
    if (catalogMatch) {
      record = catalogMatch.record;
      bibId = catalogMatch.id;
    }
  }
  if (!record || !bibId) {
    await db.update(citations).set({ resolutionState: "unresolved", resolutionSource: "unresolved" }).where(eq(citations.id, citationId));
    return;
  }

  await applyResolvedCitation({
    citationId,
    workId: citation.workId,
    workIdentityId: citation.workIdentityId,
    userId: citation.userId,
    rawText: citation.rawText,
    normalizedQuery: citation.normalizedQuery,
    sourceType: citation.sourceType,
    parserConfidence: citation.parserConfidence,
    sourceAnchor: citation.sourceAnchor as RawCitation["anchor"],
    record,
    bibId,
    // This IS the citation-resolution pathway (§2.3) — a live lookup or
    // catalogue-match reuse, not a same-run research_resource reuse — so it
    // gets bridged. `processingRunId` is null only for a legacy v1 citation
    // (which never enqueues this job in the first place, see
    // `enqueueCitationMetadataResolution`'s only call site), so this is
    // effectively always set for anything that reaches here.
    bridgeRunId: citation.processingRunId,
  });
}
