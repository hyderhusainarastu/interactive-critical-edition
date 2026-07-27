import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { bibliographicRecords, citations, db, documents, works } from "@ice/db";

/**
 * Deterministic, $0 citation-graph engagement between two works (Phase
 * 26.2a, plan §Improvements "Citation-graph-aware disagreement judgment" /
 * §Pipeline "Citation-graph engagement"): resolves whether one of a claim
 * pair's two source works cites the other, via `citation.resolved_bib_id` →
 * `bibliographic_record` → normalized-title match against the OTHER work's
 * own title.
 *
 * WORKER-LOCAL by design (do not move to `apps/web`): `apps/web/src/lib/
 * graph.ts`'s `buildGraph()` and `apps/web/src/lib/roadmap.ts` both already
 * perform a structurally identical normalized-title "is this bibliographic
 * record actually one of the user's own works" join, in raw SQL, on the web
 * side. A future shared extraction of that join into one cross-app helper
 * (used by web's graph/roadmap AND the worker's claim engagement) is
 * desirable, but `apps/web` is owned by other lanes in this program — this
 * module deliberately duplicates the JOIN LOGIC (not the SQL) in plain
 * TypeScript on the worker side rather than reaching into web's code, and
 * is intentionally scoped to that duplication being acceptable for now.
 */

export type ClaimEngagementKind = "direct_citation" | "reciprocal_citation" | "shared_citation" | "none_detected";

export interface EngagementResult {
  engagement: ClaimEngagementKind;
  /** Audit/display evidence for the deterministic join above — never
   *  model-authored. Null exactly when `engagement === "none_detected"`. */
  evidence: Record<string, unknown> | null;
}

export interface WorkCitationProfile {
  /** Every `bibliographic_record.id` this work has a RESOLVED citation to. */
  citedBibIds: Set<string>;
  /** Normalized titles (`normalizeTitle`) of those same records — what a
   *  direct-citation check against another work's own title is matched
   *  against. */
  citedNormTitles: Set<string>;
}

/** Same normalization the `apps/web/src/lib/graph.ts`/`roadmap.ts`
 *  `NORM`/`NORM_TITLE` SQL helpers apply (`regexp_replace(lower(x),
 *  '[^a-z0-9]', '', 'g')`), reimplemented in plain JS since this module
 *  compares titles in memory rather than in SQL. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Loads, for each of `workIds`, the set of bibliographic records its
 * document's RESOLVED citations point to. A citation only counts once it has
 * `resolutionState = 'resolved'` and a non-null `resolvedBibId` — an
 * unresolved/pending citation is not evidence of engagement with anything.
 */
export async function loadCitationEngagementProfiles(workIds: string[]): Promise<Map<string, WorkCitationProfile>> {
  const profiles = new Map<string, WorkCitationProfile>();
  for (const id of workIds) profiles.set(id, { citedBibIds: new Set(), citedNormTitles: new Set() });
  if (workIds.length === 0) return profiles;

  const rows = await db
    .select({ workId: documents.workId, bibId: citations.resolvedBibId, bibTitle: bibliographicRecords.title })
    .from(citations)
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(bibliographicRecords, eq(bibliographicRecords.id, citations.resolvedBibId))
    .where(and(inArray(documents.workId, workIds), eq(citations.resolutionState, "resolved"), isNotNull(citations.resolvedBibId)));

  for (const row of rows) {
    if (!row.bibId) continue;
    const profile = profiles.get(row.workId);
    if (!profile) continue;
    profile.citedBibIds.add(row.bibId);
    const normTitle = normalizeTitle(row.bibTitle);
    if (normTitle) profile.citedNormTitles.add(normTitle);
  }
  return profiles;
}

/** Normalized titles for a set of works — the "am I the target of one of
 *  the other work's citations" half of the join. Empty/whitespace-only
 *  titles normalize to `""` and are never inserted (the D-23-37 empty-
 *  pseudo-key lesson: an empty string must never become a matchable key). */
export async function loadWorkNormalizedTitles(workIds: string[]): Promise<Map<string, string>> {
  if (workIds.length === 0) return new Map();
  const rows = await db.select({ id: works.id, title: works.title }).from(works).where(inArray(works.id, workIds));
  const out = new Map<string, string>();
  for (const row of rows) {
    const normTitle = normalizeTitle(row.title);
    if (normTitle) out.set(row.id, normTitle);
  }
  return out;
}

/**
 * The pure decision core over two already-loaded profiles/titles — kept
 * separate from the DB loaders above so it is unit-testable without a
 * database. `direct_citation`/`reciprocal_citation` take priority over
 * `shared_citation`: direct engagement (one work explicitly cites the
 * other) is always the strongest, most specific signal, checked first.
 */
export function resolveEngagement(
  workAId: string,
  workBId: string,
  profiles: Map<string, WorkCitationProfile>,
  normalizedTitles: Map<string, string>,
): EngagementResult {
  const profileA = profiles.get(workAId);
  const profileB = profiles.get(workBId);
  const titleA = normalizedTitles.get(workAId);
  const titleB = normalizedTitles.get(workBId);

  const aCitesB = Boolean(profileA && titleB && profileA.citedNormTitles.has(titleB));
  const bCitesA = Boolean(profileB && titleA && profileB.citedNormTitles.has(titleA));

  if (aCitesB && bCitesA) {
    return { engagement: "reciprocal_citation", evidence: { direction: "both", workAId, workBId } };
  }
  if (aCitesB) {
    return { engagement: "direct_citation", evidence: { direction: "a_cites_b", citingWorkId: workAId, citedWorkId: workBId } };
  }
  if (bCitesA) {
    return { engagement: "direct_citation", evidence: { direction: "b_cites_a", citingWorkId: workBId, citedWorkId: workAId } };
  }

  if (profileA && profileB) {
    const shared = [...profileA.citedBibIds].filter((id) => profileB.citedBibIds.has(id));
    if (shared.length > 0) {
      return { engagement: "shared_citation", evidence: { sharedBibliographicRecordIds: shared.slice(0, 5) } };
    }
  }

  return { engagement: "none_detected", evidence: null };
}

// ---------------------------------------------------------------------------
// Work <-> corpus-item engagement (Phase 30 fix lane, D-25-13). A corpus item
// was only ever imported by its ABSTRACT (`research_corpus_item.abstract`,
// plan §Pipeline "corpus items = source_scope 'abstract'") — no reference
// list was ever parsed for it, so a corpus item's own OUTBOUND citations are
// never knowable. The only thing derivable at all is the reverse direction:
// does one of the user's uploaded WORKS have a resolved citation whose
// bibliographic_record DOI matches this corpus item's own DOI. Honest by
// construction: no DOI on either side, or no match, is `none_detected` —
// never a guessed/title-matched substitute the way work<->work direct
// citation is (that channel has real full-text citation data to match
// against; a corpus item never does).
// ---------------------------------------------------------------------------

/** DOIs (lowercased) a set of works' RESOLVED citations point to, keyed by
 *  work id — the work-side half of the work<->corpus-item DOI join
 *  (`loadCorpusItemDois` in `repository.ts` is the corpus-item-side half).
 *  Reuses the exact `resolutionState = 'resolved'` / non-null `resolvedBibId`
 *  gate `loadCitationEngagementProfiles` above applies. */
export async function loadCitationEngagementDoisForWorks(workIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const id of workIds) out.set(id, new Set());
  if (workIds.length === 0) return out;

  const rows = await db
    .select({ workId: documents.workId, doi: bibliographicRecords.doi })
    .from(citations)
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(bibliographicRecords, eq(bibliographicRecords.id, citations.resolvedBibId))
    .where(and(inArray(documents.workId, workIds), eq(citations.resolutionState, "resolved"), isNotNull(citations.resolvedBibId), isNotNull(bibliographicRecords.doi)));

  for (const row of rows) {
    if (!row.doi) continue;
    const set = out.get(row.workId);
    if (!set) continue;
    set.add(row.doi.toLowerCase());
  }
  return out;
}

/** The pure decision core for a work<->corpus-item pair — only `direct_citation`
 *  (work cites the corpus item) or `none_detected` are ever possible; never
 *  `reciprocal_citation`/`shared_citation`, which both require citation data
 *  from BOTH sides that a corpus item never has. */
function resolveWorkCorpusItemEngagement(
  workId: string,
  corpusItemId: string,
  workCitedDois: Map<string, Set<string>>,
  corpusItemDois: Map<string, string | null>,
): EngagementResult {
  const doi = corpusItemDois.get(corpusItemId);
  if (!doi) return { engagement: "none_detected", evidence: null };
  const cited = workCitedDois.get(workId);
  if (cited?.has(doi)) {
    return { engagement: "direct_citation", evidence: { direction: "work_cites_corpus_item", citingWorkId: workId, citedCorpusItemId: corpusItemId, doi } };
  }
  return { engagement: "none_detected", evidence: null };
}

/** A claim's source, generalized over both `research_claim` source kinds —
 *  exactly one field is non-null (`research_claim_exactly_one_source`
 *  CHECK). */
export interface ClaimEngagementSource {
  workId: string | null;
  corpusItemId: string | null;
}

/**
 * Engagement resolution generalized over both claim source kinds
 * (`detectRelationships.ts`'s candidate-pair citation-engagement pre-join,
 * D-25-13's cross-source widening). Dispatches to the existing work<->work
 * `resolveEngagement` unchanged when both sides are works; to the DOI-only
 * `resolveWorkCorpusItemEngagement` when exactly one side is a corpus item
 * (regardless of which of the pair's lo/hi positions it's in); and to a flat
 * `none_detected` for a corpus-item<->corpus-item pair, since neither side
 * of that pair has any citation data at all to join against — the honest
 * "nothing derivable" outcome the plan's own §Pipeline note for this lane
 * calls for, not a guess.
 */
export function resolveEngagementForClaims(
  a: ClaimEngagementSource,
  b: ClaimEngagementSource,
  workProfiles: Map<string, WorkCitationProfile>,
  workNormalizedTitles: Map<string, string>,
  workCitedDois: Map<string, Set<string>>,
  corpusItemDois: Map<string, string | null>,
): EngagementResult {
  if (a.workId && b.workId) return resolveEngagement(a.workId, b.workId, workProfiles, workNormalizedTitles);
  if (a.workId && b.corpusItemId) return resolveWorkCorpusItemEngagement(a.workId, b.corpusItemId, workCitedDois, corpusItemDois);
  if (a.corpusItemId && b.workId) return resolveWorkCorpusItemEngagement(b.workId, a.corpusItemId, workCitedDois, corpusItemDois);
  return { engagement: "none_detected", evidence: null };
}
