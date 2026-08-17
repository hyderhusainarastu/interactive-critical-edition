import {
  citationLibraryLinks,
  db,
  learningResources,
  resourceRoles,
} from "@ice/db";
import { type ResolvedRecord } from "@ice/bibliographic";
import { type RawCitation } from "@ice/ingestion";
import { reportEvent } from "@ice/observability";
import { canonicalizeDoi, canonicalizeUrl } from "@ice/research";
import { eq } from "drizzle-orm";
import {
  citationIdentityKey,
  citationRoleRationale,
  upsertClassicalLearningResource,
} from "./classicalCitations";

export async function ensureCitationRole(input: {
  learningResourceId: string;
  workIdentityId: string;
  citation: RawCitation;
  /**
   * The citation this role belongs to. Set on the concurrency-prone
   * resolution paths (`applyResolvedCitation`, `createCitationLibraryProjection`)
   * so a role whose target learning_resource was concurrently MERGED AWAY
   * can be re-pointed to the citation's CURRENT surviving row instead of
   * crashing the whole edition run on a phantom FK. See the 23503 handling
   * below for the full rationale. Omit only when the caller provably holds a
   * freshly-created, non-mergeable target.
   */
  citationId?: string;
}): Promise<void> {
  const insertRole = (learningResourceId: string) =>
    db
      .insert(resourceRoles)
      .values({
        learningResourceId,
        workIdentityId: input.workIdentityId,
        relationship: "explicit_reference",
        readerLevel: null,
        rationale: citationRoleRationale(input.citation),
        confidence: input.citation.parserConfidence ?? 0,
        createdBy: "system",
      })
      .onConflictDoUpdate({
        target: [resourceRoles.learningResourceId, resourceRoles.workIdentityId, resourceRoles.readerLevel],
        set: {
          relationship: "explicit_reference",
          rationale: citationRoleRationale(input.citation),
          confidence: input.citation.parserConfidence ?? 0,
        },
      });

  try {
    await insertRole(input.learningResourceId);
  } catch (error) {
    // Phantom-FK guard (2026-07-23 resource_role FK-violation incident,
    // run b2750c63): `applyResolvedCitation` and `resolveCitationMetadata`
    // run CONCURRENTLY on separate pg-boss queues within one document's
    // pipeline, and both call this via a read-modify-write that is not atomic
    // across the two paths. One path can read a citation's target
    // learning_resource id, and — before this insert fires — a parallel path's
    // `applyResolvedCitation` merge (its stub delete, analyze.ts ~L631) can
    // delete exactly that row, having first repointed every citationLibraryLink
    // off it onto the surviving canonical row. The insert then violates the
    // learning_resource FK (Postgres 23503) with a genuinely-gone id. e48cb1a
    // unmasked this: before it, the research_resource duplicate-key crash
    // killed the run long before `linkCitationsToRunDiscoveries` ever ran, so
    // this pre-existing race was unreachable. This is a benign race, not
    // corruption, so recover rather than crash the whole edition. Drizzle
    // nests the driver error under `.cause` (documented pg/Drizzle gotcha).
    const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
    const isLearningResourceFk =
      cause?.code === "23503" && (!cause.constraint_name || cause.constraint_name.includes("learning_resource"));
    if (!isLearningResourceFk || !input.citationId) throw error;

    // Re-resolve to the citation's CURRENT link: the concurrent merge repoints
    // every citationLibraryLink off the deleted stub onto the surviving
    // canonical row BEFORE deleting the stub, so this is the live, non-phantom
    // target — exactly "re-resolve the existing row's id, not the phantom id".
    const [link] = await db
      .select({ id: citationLibraryLinks.learningResourceId })
      .from(citationLibraryLinks)
      .where(eq(citationLibraryLinks.citationId, input.citationId))
      .limit(1);
    if (link && link.id !== input.learningResourceId) {
      try {
        await insertRole(link.id);
        return;
      } catch (retryError) {
        const rc = (retryError as { cause?: { code?: string } }).cause;
        if (rc?.code !== "23503") throw retryError;
      }
    }
    // Even the re-resolved target is gone (or unchanged): the surviving row the
    // merge kept already carries this (resource, work) role — it is keyed on
    // exactly (learning_resource, work_identity, reader_level) — so dropping
    // this now-redundant one is correct. Stay visible without crashing,
    // mirroring e48cb1a's research_resource duplicate-skip pattern.
    reportEvent("citation_role_target_merged_away", {
      scope: "worker.ensureCitationRole",
      citationId: input.citationId,
      workIdentityId: input.workIdentityId,
      deletedLearningResourceId: input.learningResourceId,
    });
  }
}

/** Shared tail of `createCitationLibraryProjection`'s two branches: give the
 *  citation its role against the work and link it into the Library. */
async function linkCitationToLearningResource(input: {
  citationId: string;
  citation: RawCitation;
  workIdentityId: string;
  learningResourceId: string;
}): Promise<string> {
  await ensureCitationRole({
    learningResourceId: input.learningResourceId,
    workIdentityId: input.workIdentityId,
    citation: input.citation,
    citationId: input.citationId,
  });
  await db
    .insert(citationLibraryLinks)
    .values({ citationId: input.citationId, learningResourceId: input.learningResourceId })
    .onConflictDoUpdate({
      target: citationLibraryLinks.citationId,
      set: { learningResourceId: input.learningResourceId },
    });
  return input.learningResourceId;
}

/**
 * Citation projection deliberately happens before any catalogue lookup or AI
 * stage. The exact source citation becomes a visible Library item immediately;
 * a later resolver may enrich it, but a provider failure can never erase it.
 *
 * A recognized classical (Bekker/Stephanus) citation skips the
 * "Needs bibliographic resolution" placeholder entirely — there is nothing
 * to resolve later that isn't already known now, and every such citation
 * across every document converges on the SAME canonical Library row (keyed
 * by `classicalLibraryKey`, not by this citation's own exact locus text).
 */
export async function createCitationLibraryProjection(input: {
  citationId: string;
  citation: RawCitation;
  workIdentityId: string;
}): Promise<string> {
  if (input.citation.classical) {
    const resourceId = await upsertClassicalLearningResource(input.citation.classical);
    return linkCitationToLearningResource({ ...input, learningResourceId: resourceId });
  }

  const normalizedKey = citationIdentityKey(input.citation.query);
  const [resource] = await db
    .insert(learningResources)
    .values({
      normalizedKey,
      title: `Needs bibliographic resolution — ${input.citation.text}`.slice(0, 2_000),
      resourceType: "unresolved-citation",
      provider: "citation-extraction",
      authors: [],
    })
    .onConflictDoUpdate({
      target: learningResources.normalizedKey,
      set: {
        title: `Needs bibliographic resolution — ${input.citation.text}`.slice(0, 2_000),
        resourceType: "unresolved-citation",
        provider: "citation-extraction",
        updatedAt: new Date(),
      },
    })
    .returning({ id: learningResources.id });

  return linkCitationToLearningResource({ ...input, learningResourceId: resource.id });
}

/**
 * A citation match's minimal shape, satisfied by a live @ice/bibliographic
 * `ResolvedRecord`, a shared-catalogue row, or a same-run `research_resource`
 * row — the three sources `resolveCitationMetadata` and
 * `linkCitationsToRunDiscoveries` can now resolve a citation from. Widened
 * from `ResolvedRecord.source` (which is only the three live-lookup provider
 * names) to a plain `string` so a catalogue/same-run reuse can honestly
 * record ITS OWN provenance (`catalog:<original source>` /
 * `research:<provider>`) instead of masquerading as a fresh live lookup.
 */
export type CitationMatch = Omit<ResolvedRecord, "source" | "raw"> & { source: string };

export function resolvedCitationLibraryFields(record: CitationMatch) {
  const authors = record.authors
    ? record.authors.split(/\s*;\s*|\s+and\s+|\s*,\s*/).map((author) => author.trim()).filter(Boolean)
    : [];
  return {
    title: record.title,
    url: record.url,
    canonicalUrl: canonicalizeUrl(record.url),
    doi: canonicalizeDoi(record.doi),
    isbn: null,
    resourceType: "bibliographic",
    provider: record.source,
    year: record.year,
    authors,
    venue: null,
    peerReviewed: null,
  };
}
