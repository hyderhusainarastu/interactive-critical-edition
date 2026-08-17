import {
  bibliographicRecords,
  citations,
  db,
  documents,
  researchResources,
  works,
} from "@ice/db";
import { type RawCitation } from "@ice/ingestion";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { applyResolvedCitation } from "./applyResolvedCitation";
import { bestOverlapMatch } from "./catalogMatching";

/**
 * D-20-68 (the Irwin canary case): the explicit-citation discovery lane can
 * surface a resource in THIS SAME RUN — via a provider @ice/bibliographic's
 * narrower live lookup never queries at all (e.g. Google Books) — that the
 * matching structural citation never gets linked to. The reason is ordering,
 * not coverage: `resolveCitationMetadata` runs as an independent,
 * asynchronously-queued job enqueued right when the citation is first
 * inserted (near the START of `analyzeEditionRun`), while `research_resource`
 * rows for this run are only written much later in the SAME function call —
 * so the async job frequently has nothing of this run's own to see even in
 * principle, and nothing ever revisits it afterward. This closes that gap
 * synchronously, called only once discovery has actually finished inserting
 * this run's `research_resource` rows, so the link never races the async
 * queue's own timing. Citations already `resolved` (by the async path, or a
 * prior call to this function on reprocess) are left untouched.
 */
export async function linkCitationsToRunDiscoveries(documentId: string, runId: string): Promise<void> {
  const candidates = await db
    .select({
      title: researchResources.title,
      bibRecordId: researchResources.bibRecordId,
      provider: researchResources.provider,
      year: researchResources.year,
    })
    .from(researchResources)
    .where(and(eq(researchResources.runId, runId), isNotNull(researchResources.bibRecordId)));
  if (!candidates.length) return;

  const pending = await db
    .select({
      id: citations.id,
      workId: documents.workId,
      workIdentityId: works.workIdentityId,
      userId: documents.userId,
      rawText: citations.rawText,
      normalizedQuery: citations.normalizedQuery,
      sourceType: citations.sourceType,
      parserConfidence: citations.parserConfidence,
      sourceAnchor: citations.sourceAnchor,
    })
    .from(citations)
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(and(eq(citations.documentId, documentId), ne(citations.resolutionState, "resolved")));
  if (!pending.length) return;

  for (const citation of pending) {
    const match = bestOverlapMatch(citation.normalizedQuery, candidates);
    if (!match?.bibRecordId) continue;
    const [bibRow] = await db
      .select()
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.id, match.bibRecordId))
      .limit(1);
    if (!bibRow) continue;
    await applyResolvedCitation({
      citationId: citation.id,
      workId: citation.workId,
      workIdentityId: citation.workIdentityId,
      userId: citation.userId,
      rawText: citation.rawText,
      normalizedQuery: citation.normalizedQuery,
      sourceType: citation.sourceType,
      parserConfidence: citation.parserConfidence,
      sourceAnchor: citation.sourceAnchor as RawCitation["anchor"],
      record: {
        source: `research:${match.provider}`,
        externalId: bibRow.externalId,
        title: bibRow.title,
        authors: bibRow.authors,
        year: bibRow.year,
        doi: bibRow.doi,
        url: bibRow.url,
        accessStatus: bibRow.accessStatus,
      },
      bibId: match.bibRecordId,
      // Deliberately NOT bridged (no `bridgeRunId`): `match` came FROM this
      // exact run's own `researchResources` query above, so a
      // `research_resource` row already exists for it — bridging again would
      // be pure redundancy (§2.3's bridge is only for the OTHER pathway).
    });
  }
}
