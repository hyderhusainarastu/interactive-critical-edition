import {
  bibliographicRecords,
  citations,
  citationLibraryLinks,
  db,
  graphEdges,
  learningResources,
  researchResources,
  resourceRoles,
} from "@ice/db";
import { type ResolvedRecord } from "@ice/bibliographic";
import {
  type ClassicalReferenceMatch,
  type RawCitation,
} from "@ice/ingestion";
import { createHash } from "node:crypto";
import {
  canonicalizeDoi,
  canonicalizeIsbn,
  canonicalizeUrl,
  buildCitationBridgeResource,
  shouldBridgeCitationToResearchResource,
} from "@ice/research";
import { and, eq, sql } from "drizzle-orm";
import { ensureCitationRole } from "./citationRole";

export async function findOrCreateBibRecord(record: ResolvedRecord): Promise<string> {
  // Canonical identity has a deliberate, conservative precedence order. Do
  // not merge Aristotle/Plato works merely because their author matches: the
  // final fallback requires normalized title + author + year together.
  const doi = canonicalizeDoi(record.doi);
  const isbn = canonicalizeIsbn(record.externalId);
  const canonicalUrl = canonicalizeUrl(record.url);
  if (doi) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.doi, doi))
      .limit(1);
    if (existing) return existing.id;
  }
  if (isbn ?? record.externalId) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.externalId, isbn ?? record.externalId!))
      .limit(1);
    if (existing) return existing.id;
  }
  if (canonicalUrl || record.url) {
    const [existing] = await db.execute(sql`
      SELECT id FROM bibliographic_record
      WHERE url = ${canonicalUrl ?? record.url} OR url = ${record.url ?? canonicalUrl}
      LIMIT 1
    `) as unknown as { id: string }[];
    if (existing) return existing.id;
  }
  if (record.title.trim() && record.authors?.trim() && record.year != null) {
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
    const [existing] = await db.execute(sql`
      SELECT id FROM bibliographic_record
      WHERE regexp_replace(lower(title), '[^a-z0-9]', '', 'g') = ${normalize(record.title)}
        AND regexp_replace(lower(COALESCE(authors, '')), '[^a-z0-9]', '', 'g') = ${normalize(record.authors)}
        AND year = ${record.year}
      LIMIT 1
    `) as unknown as { id: string }[];
    if (existing) return existing.id;
  }

  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: record.source,
      externalId: isbn ?? record.externalId,
      title: record.title,
      authors: record.authors,
      year: record.year,
      doi,
      url: canonicalUrl ?? record.url,
      accessStatus: record.accessStatus,
      raw: record.raw,
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

export function citationIdentityKey(query: string): string {
  return `citation:${createHash("sha256").update(query.trim().toLocaleLowerCase()).digest("hex")}`;
}

/** "classical:aristotle:nicomachean-ethics" — one Library row per ancient
 *  work across every document by construction, regardless of which exact
 *  locus (1094a or 1151a) a given citation happens to point at. */
function slugifyWorkTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function classicalLibraryKey(match: ClassicalReferenceMatch): string {
  return `classical:${match.author}:${slugifyWorkTitle(match.work)}`;
}

/**
 * Find-or-create the ONE canonical `learning_resource` row for a classical
 * work, keyed by `classicalLibraryKey`. Shared by `createCitationLibraryProjection`
 * (extraction time), `resolveCitationMetadata`'s classical branch, and the
 * `cleanupClassicalCitationStubs` maintenance script's `--reproject` path —
 * every caller that needs to point a citation at the canonical row goes
 * through this single upsert rather than three copies of the same insert.
 */
export async function upsertClassicalLearningResource(match: ClassicalReferenceMatch): Promise<string> {
  const [resource] = await db
    .insert(learningResources)
    .values({
      normalizedKey: classicalLibraryKey(match),
      title: match.query,
      resourceType: "classical-primary-source",
      provider: "classical-citation",
      authors: [match.author === "aristotle" ? "Aristotle" : "Plato"],
    })
    .onConflictDoUpdate({
      target: learningResources.normalizedKey,
      set: {
        title: match.query,
        resourceType: "classical-primary-source",
        provider: "classical-citation",
        updatedAt: new Date(),
      },
    })
    .returning({ id: learningResources.id });
  return resource.id;
}

/**
 * Bekker/Stephanus citations never carry a doi/isbn/url/year, so the
 * generic `findOrCreateBibRecord` identity checks above (all of which
 * require one of those) would create a fresh `bibliographic_record` row
 * per citation instead of converging on one canonical row per ancient
 * work. Deliberately narrow and separate rather than widening that
 * function's identity rules for a case they were never meant to cover:
 * identity here is simply "same source + same canonical title".
 */
async function findOrCreateClassicalBibRecord(match: ClassicalReferenceMatch): Promise<string> {
  const [existing] = await db
    .select({ id: bibliographicRecords.id })
    .from(bibliographicRecords)
    .where(and(eq(bibliographicRecords.source, "classical-canon"), eq(bibliographicRecords.title, match.query)))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: "classical-canon",
      externalId: null,
      title: match.query,
      authors: match.author === "aristotle" ? "Aristotle" : "Plato",
      year: null,
      doi: null,
      url: null,
      accessStatus: "metadata_only",
      raw: { classical: true, work: match.work },
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

function citationSourceLabel(sourceType: "bibliography" | "footnote" | "endnote" | "inline"): string {
  return sourceType === "bibliography" ? "Bibliography" : sourceType === "footnote" ? "Footnote" : sourceType === "endnote" ? "Endnote" : "Direct citation";
}

export function citationRoleRationale(citation: RawCitation): string {
  const anchor = citation.anchor;
  const page = anchor?.pageIndex != null ? ` page ${anchor.pageIndex + 1}` : "";
  const marker = anchor?.marker ? ` note ${anchor.marker}` : "";
  return `${citationSourceLabel(citation.sourceType ?? "inline")}${page}${marker}: ${citation.text}`.slice(0, 2_000);
}

/**
 * The classical-citation counterpart to `applyResolvedCitation`, kept as a
 * SEPARATE function rather than a branch inside it — reusing
 * `applyResolvedCitation` directly here would be a real bug, not just
 * duplication: that function's merge logic computes its "canonical key" via
 * `@ice/research`'s generic `normalizedKey()` (derived from doi/isbn/url/
 * title), which will never match `classicalLibraryKey`'s
 * "classical:aristotle:nicomachean-ethics" format. It would find no
 * existing row under that generic key and fall into its own "no merge
 * needed" branch, which overwrites the CURRENT link's row — the shared
 * canonical classical row every other citation to the same work also
 * points at — with `normalizedKey` set to the wrong (generic) format,
 * silently breaking `upsertClassicalLearningResource`'s upsert target for
 * every future citation to that work. This function's merge branch instead
 * always targets the correct canonical row via `upsertClassicalLearningResource`.
 *
 * Reachable from two callers: `resolveCitationMetadata`'s classical branch
 * (the citation is already linked to the correct canonical row by the time
 * this runs — see that call site's comment — so the merge branch below is a
 * no-op there), and the `cleanupClassicalCitationStubs` maintenance
 * script's `--reproject` path (where the citation is still linked to an
 * OLD junk "Needs bibliographic resolution" stub predating this fix, and
 * the merge branch is what re-points it onto the canonical row and removes
 * the stub).
 */
export async function applyClassicalCitationResolution(input: {
  citationId: string;
  workId: string;
  workIdentityId: string | null;
  userId: string;
  sourceType: "bibliography" | "footnote" | "endnote" | "inline";
  parserConfidence: number;
  sourceAnchor: RawCitation["anchor"];
  match: ClassicalReferenceMatch;
  bridgeRunId?: string | null;
}): Promise<void> {
  const { citationId, workId, workIdentityId, userId, match } = input;
  const resourceId = await upsertClassicalLearningResource(match);

  const citationMention: RawCitation = {
    text: match.locus,
    query: match.query,
    kind: input.sourceType === "inline" ? "inline" : "reference",
    sourceType: input.sourceType,
    parserConfidence: input.parserConfidence,
    anchor: input.sourceAnchor,
    classical: match,
  };
  if (workIdentityId) {
    await ensureCitationRole({ learningResourceId: resourceId, workIdentityId, citation: citationMention, citationId });
  }

  const [link] = await db
    .select({ learningResourceId: citationLibraryLinks.learningResourceId })
    .from(citationLibraryLinks)
    .where(eq(citationLibraryLinks.citationId, citationId))
    .limit(1);
  if (link && link.learningResourceId !== resourceId) {
    // Merge every provenance link onto the canonical row before removing
    // the stale one (same shape as `applyResolvedCitation`'s merge branch,
    // just always targeting the RIGHT row — see the doc comment above).
    await db.update(citationLibraryLinks).set({ learningResourceId: resourceId }).where(eq(citationLibraryLinks.learningResourceId, link.learningResourceId));
    await db.delete(resourceRoles).where(eq(resourceRoles.learningResourceId, link.learningResourceId));
    await db.delete(learningResources).where(eq(learningResources.id, link.learningResourceId));
  } else if (!link) {
    await db
      .insert(citationLibraryLinks)
      .values({ citationId, learningResourceId: resourceId })
      .onConflictDoUpdate({ target: citationLibraryLinks.citationId, set: { learningResourceId: resourceId } });
  }

  const bibId = await findOrCreateClassicalBibRecord(match);
  await db.update(citations).set({ resolvedBibId: bibId, resolutionSource: "classical-canon", resolutionState: "resolved" }).where(eq(citations.id, citationId));

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

  if (input.bridgeRunId && shouldBridgeCitationToResearchResource(input.sourceType)) {
    const bridged = buildCitationBridgeResource({
      runId: input.bridgeRunId,
      citationId,
      bibId,
      match: {
        source: "classical-canon",
        title: match.query,
        authors: match.author === "aristotle" ? "Aristotle" : "Plato",
        year: null,
        doi: null,
        url: null,
      },
    });
    await db
      .insert(researchResources)
      .values(bridged)
      .onConflictDoNothing({ target: [researchResources.runId, researchResources.normalizedKey] });
  }
}
