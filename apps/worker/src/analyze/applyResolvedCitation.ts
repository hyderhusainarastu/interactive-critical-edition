import {
  citations,
  citationLibraryLinks,
  db,
  graphEdges,
  learningResources,
  researchResources,
  resourceRoles,
} from "@ice/db";
import { type RawCitation } from "@ice/ingestion";
import {
  normalizedKey,
  buildCitationBridgeResource,
  shouldBridgeCitationToResearchResource,
} from "@ice/research";
import { and, eq } from "drizzle-orm";
import {
  ensureCitationRole,
  resolvedCitationLibraryFields,
  type CitationMatch,
} from "./citationRole";

/**
 * Everything a resolved match — live, catalogue-reused, or same-run-linked —
 * needs applied to a citation: the Library projection merge, the citation row
 * itself, and the `cites` graph edge. Factored out of `resolveCitationMetadata`
 * so `linkCitationsToRunDiscoveries` (a different caller, a different source
 * of the match) shares the exact same downstream behavior rather than a
 * second hand-copied version of it.
 */
export async function applyResolvedCitation(input: {
  citationId: string;
  workId: string;
  workIdentityId: string | null;
  userId: string;
  rawText: string;
  normalizedQuery: string;
  sourceType: "bibliography" | "footnote" | "endnote" | "inline";
  parserConfidence: number;
  sourceAnchor: RawCitation["anchor"];
  record: CitationMatch;
  bibId: string;
  /**
   * Floors-capability-proposal §2.3 bridge: set ONLY when this resolution
   * came from the independent citation-resolution pathway (a live lookup or
   * catalogue-match reuse) and is genuinely not yet reflected in this run's
   * own `research_resource` rows — i.e. `resolveCitationMetadata`'s call,
   * never `linkCitationsToRunDiscoveries`'s (whose match is, by
   * construction, already a `research_resource` row in this exact run).
   * Left undefined/null, no bridge row is written — the pre-existing
   * behavior for every other caller.
   */
  bridgeRunId?: string | null;
}): Promise<void> {
  const { citationId, workId, workIdentityId, userId, record, bibId } = input;
  const [link] = await db
    .select({ learningResourceId: citationLibraryLinks.learningResourceId })
    .from(citationLibraryLinks)
    .where(eq(citationLibraryLinks.citationId, citationId))
    .limit(1);
  const citationMention: RawCitation = {
    text: input.rawText,
    query: input.normalizedQuery,
    kind: input.sourceType === "inline" ? "inline" : "reference",
    sourceType: input.sourceType,
    parserConfidence: input.parserConfidence,
    anchor: input.sourceAnchor,
  };
  const fields = resolvedCitationLibraryFields(record);
  const canonicalKey = normalizedKey({
    doi: fields.doi,
    isbn: fields.isbn,
    url: fields.url,
    title: fields.title,
    authors: fields.authors,
    year: fields.year,
  });

  if (link && canonicalKey) {
    const [existing] = await db
      .select({ id: learningResources.id })
      .from(learningResources)
      .where(eq(learningResources.normalizedKey, canonicalKey))
      .limit(1);
    const targetId = existing?.id ?? link.learningResourceId;
    if (workIdentityId) await ensureCitationRole({ learningResourceId: targetId, workIdentityId, citation: citationMention, citationId });
    if (existing && existing.id !== link.learningResourceId) {
      // Merge every provenance link before removing the temporary stub. This
      // makes DOI/ISBN/URL/title identity canonical without duplicate rows.
      await db.update(citationLibraryLinks).set({ learningResourceId: existing.id }).where(eq(citationLibraryLinks.learningResourceId, link.learningResourceId));
      await db.delete(resourceRoles).where(eq(resourceRoles.learningResourceId, link.learningResourceId));
      await db.delete(learningResources).where(eq(learningResources.id, link.learningResourceId));
    } else {
      await db.update(learningResources).set({ ...fields, normalizedKey: canonicalKey, bibRecordId: bibId, updatedAt: new Date() }).where(eq(learningResources.id, link.learningResourceId));
    }
  }

  await db.update(citations).set({ resolvedBibId: bibId, resolutionSource: record.source, resolutionState: "resolved" }).where(eq(citations.id, citationId));
  const [existingEdge] = await db
    .select({ id: graphEdges.id })
    .from(graphEdges)
    .where(and(
      eq(graphEdges.userId, userId),
      eq(graphEdges.sourceType, "work"),
      eq(graphEdges.sourceId, workId),
      eq(graphEdges.targetType, "bibliographic_record"),
      eq(graphEdges.targetId, bibId),
      eq(graphEdges.edgeType, "cites"),
    ))
    .limit(1);
  if (!existingEdge) {
    await db.insert(graphEdges).values({
      userId,
      sourceType: "work",
      sourceId: workId,
      targetType: "bibliographic_record",
      targetId: bibId,
      edgeType: "cites",
      weight: 1,
      confidence: input.parserConfidence,
      evidence: { citationId, sourceType: input.sourceType, anchor: input.sourceAnchor },
      createdBy: "system",
    });
  }

  // Floors-capability-proposal §2.3: this citation resolved through the
  // independent citation-resolution pathway, not this run's own
  // discovery/acceptance loop — bridge it into `research_resource`, the ONLY
  // table the direct-source-floor gate counts, using ONLY data already
  // verified above (no new lookup, no new AI cost). `onConflictDoNothing`
  // covers the (unlikely but real) race against that same run's own
  // discovery loop independently finding and inserting the identical
  // resource: whichever writer commits first wins, the other is a safe no-op
  // rather than a unique-constraint crash, and either way a
  // `research_resource` row ends up present, which is the only thing this
  // bridge exists to guarantee.
  if (input.bridgeRunId && shouldBridgeCitationToResearchResource(input.sourceType)) {
    const bridged = buildCitationBridgeResource({
      runId: input.bridgeRunId,
      citationId,
      bibId,
      match: record,
    });
    await db
      .insert(researchResources)
      .values(bridged)
      .onConflictDoNothing({ target: [researchResources.runId, researchResources.normalizedKey] });
  }
}
