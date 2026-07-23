import { db, readingRecords, roadmapOverrides, understandingRatings } from "@ice/db";
import {
  collapseDuplicateCandidates,
  countByReaderLevel,
  rankRoadmap,
  type OverrideEntry,
  type ProfileEntry,
  type RankOptions,
  type ReaderLevelFilter,
  type RelationshipCategory,
  type RoadmapCandidate,
} from "@ice/roadmap";
import { and, eq, sql } from "drizzle-orm";

/**
 * The DB/traversal half of the reading roadmap (plan §13). The pure
 * ranking lives in `@ice/roadmap` (unit-tested); this does the graph
 * traversal that feeds it and applies the user's saved profile/overrides,
 * then returns a ranked sequence recomputed fresh each request.
 *
 * Traversal is a recursive CTE over `graph_edges` rooted at the primary
 * work. Because analysis only produces work→bibliographic_record edges,
 * transitivity is realized by re-entering the graph whenever a reached
 * record corresponds (by normalized title) to another work the user has
 * uploaded and analyzed — so "Kant → Hume" surfaces only when the user
 * actually has the Kant work in their library, which is honest about what
 * the data supports (a documented limitation, not silent breakage).
 */

interface ReachRow {
  bib_id: string;
  category: string;
  confidence: number;
  depth: number;
}

interface DetailRow {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  access_status: string;
  source: string;
  in_library: boolean;
  centrality: number;
  matched_work_id: string | null;
}

const NORM_TITLE = (col: string) => sql.raw(`regexp_replace(lower(${col}), '[^a-z0-9]', '', 'g')`);

export interface RoadmapResult {
  rootWorkId: string;
  options: RankOptions;
  items: ReturnType<typeof rankRoadmap>;
  totalReached: number;
  /** How many items each reader level (plus "all") would show for these same
   *  candidates — plan §34.4 9.4's always-visible per-level counts. */
  levelCounts: Record<ReaderLevelFilter, number>;
  /** Targets the reader explicitly hid (plan §22.5 "restore/un-hide",
   *  D-22-3) — kept out of `items` but listed here so the UI has something
   *  to offer a "Restore" control for. */
  hiddenItems: Array<{ bibId: string; title: string; authors: string | null; year: number | null }>;
}

export async function computeRoadmap(
  userId: string,
  rootWorkId: string,
  options: RankOptions = {},
): Promise<RoadmapResult> {
  // 1) Reachable targets from the root work (transitive through matched works).
  const reach = (await db.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT e.target_id AS bib_id,
             (e.evidence->>'category') AS category,
             e.confidence AS confidence,
             1 AS depth,
             ARRAY[e.source_id] AS work_path
      FROM graph_edge e
      WHERE e.user_id = ${userId}
        AND e.source_type = 'work' AND e.source_id = ${rootWorkId}
        AND e.target_type = 'bibliographic_record'
      UNION ALL
      SELECT e2.target_id,
             (e2.evidence->>'category'),
             LEAST(r.confidence, e2.confidence),
             r.depth + 1,
             r.work_path || w.id
      FROM reach r
      JOIN bibliographic_record br ON br.id = r.bib_id
      JOIN work w ON w.user_id = ${userId} AND w.deleted_at IS NULL
        AND ${NORM_TITLE("w.title")} = ${NORM_TITLE("br.title")}
      JOIN graph_edge e2 ON e2.user_id = ${userId}
        AND e2.source_type = 'work' AND e2.source_id = w.id
        AND e2.target_type = 'bibliographic_record'
      WHERE r.depth < 4 AND NOT (w.id = ANY(r.work_path))
    )
    SELECT bib_id, category, MAX(confidence) AS confidence, MIN(depth) AS depth
    FROM reach
    GROUP BY bib_id, category
  `)) as unknown as ReachRow[];

  const emptyLevelCounts: Record<ReaderLevelFilter, number> = {
    beginner: 0,
    undergraduate: 0,
    advanced: 0,
    research: 0,
    all: 0,
  };

  // Overrides are fetched before the reach-empty check, not after, because
  // a manually added target (D-22-3 "manual add") may be the ONLY reason
  // this roadmap has anything to show at all — by definition it isn't
  // reached by the graph traversal above.
  const overrides = await db
    .select()
    .from(roadmapOverrides)
    .where(and(eq(roadmapOverrides.userId, userId), eq(roadmapOverrides.rootWorkId, rootWorkId)));
  const manuallyAddedIds = overrides.filter((o) => o.addedManually).map((o) => o.bibId);

  const reachedIds = [...new Set(reach.map((r) => r.bib_id))];
  const bibIds = [...new Set([...reachedIds, ...manuallyAddedIds])];

  if (bibIds.length === 0) {
    return { rootWorkId, options, items: [], totalReached: 0, levelCounts: emptyLevelCounts, hiddenItems: [] };
  }

  // 2) Details + centrality + in-library flag + matched owned work (for
  // direct navigation, D-22-4) for those targets.
  const details = (await db.execute(sql`
    SELECT br.id, br.title, br.authors, br.year, br.doi, br.access_status, br.source,
      EXISTS (
        SELECT 1 FROM work w
        WHERE w.user_id = ${userId} AND w.deleted_at IS NULL
          AND ${NORM_TITLE("w.title")} = ${NORM_TITLE("br.title")}
      ) AS in_library,
      (
        SELECT COUNT(DISTINCT ge.source_id)::int FROM graph_edge ge
        WHERE ge.user_id = ${userId} AND ge.source_type = 'work'
          AND ge.target_type = 'bibliographic_record' AND ge.target_id = br.id
      ) AS centrality,
      (
        SELECT w.id FROM work w
        WHERE w.user_id = ${userId} AND w.deleted_at IS NULL
          AND ${NORM_TITLE("w.title")} = ${NORM_TITLE("br.title")}
        ORDER BY w.created_at ASC
        LIMIT 1
      ) AS matched_work_id
    FROM bibliographic_record br
    WHERE br.id IN ${bibIds}
  `)) as unknown as DetailRow[];
  const detailById = new Map(details.map((d) => [d.id, d]));

  // 3) User profile (ratings + reading status) for these targets.
  const [ratings, records] = await Promise.all([
    db
      .select({ bibId: understandingRatings.bibId, score: understandingRatings.score })
      .from(understandingRatings)
      .where(eq(understandingRatings.userId, userId)),
    db
      .select({ bibId: readingRecords.bibId, status: readingRecords.status })
      .from(readingRecords)
      .where(eq(readingRecords.userId, userId)),
  ]);

  const profile = new Map<string, ProfileEntry>();
  for (const r of ratings) if (r.bibId) profile.set(r.bibId, { ...profile.get(r.bibId), score: r.score });
  for (const r of records) if (r.bibId) profile.set(r.bibId, { ...profile.get(r.bibId), status: r.status });

  const overrideMap = new Map<string, OverrideEntry>();
  for (const o of overrides) {
    overrideMap.set(o.bibId, {
      hidden: o.hidden,
      manualTier: o.manualTier ?? undefined,
      manualPosition: o.manualPosition ?? undefined,
    });
  }

  // A target the reader explicitly hid (D-22-3 "restore/un-hide") — kept
  // out of the ranked items, but listed separately with just enough detail
  // (title/authors/year) for a "Restore" control to identify it.
  const hiddenItems = bibIds
    .filter((id) => overrideMap.get(id)?.hidden)
    .map((id) => {
      const d = detailById.get(id);
      return { bibId: id, title: d?.title ?? "Untitled", authors: d?.authors ?? null, year: d?.year ?? null };
    });

  // 4) Build candidates (aggregate categories per target) and rank.
  const catsByBib = new Map<string, RelationshipCategory[]>();
  const confByBib = new Map<string, number>();
  const depthByBib = new Map<string, number>();
  for (const r of reach) {
    const list = catsByBib.get(r.bib_id) ?? [];
    if (r.category) list.push(r.category as RelationshipCategory);
    catsByBib.set(r.bib_id, list);
    confByBib.set(r.bib_id, Math.max(confByBib.get(r.bib_id) ?? 0, r.confidence));
    depthByBib.set(r.bib_id, Math.min(depthByBib.get(r.bib_id) ?? Infinity, r.depth));
  }

  const candidates: RoadmapCandidate[] = bibIds.map((id) => {
    const d = detailById.get(id);
    return {
      bibId: id,
      title: d?.title ?? "Untitled",
      authors: d?.authors ?? null,
      year: d?.year ?? null,
      // A manually added target the traversal never reached has no
      // detected category — fall back to "ai_inferred" (the existing
      // unclassified default this function already used for any
      // no-category case) rather than implying evidence that doesn't exist.
      categories: catsByBib.get(id) ?? ["ai_inferred"],
      confidence: confByBib.get(id) ?? 0.5,
      centrality: d?.centrality ?? 0,
      // Same reasoning: a target with no reach entry wasn't found at any
      // depth, so it gets a large depth rather than the misleading "1" a
      // directly-referenced target would have.
      depth: depthByBib.get(id) ?? 99,
      // No DOI (or an Open Library record) reads as a book; a DOI reads as
      // an article — a rough length signal for the time estimate.
      isBook: !d?.doi || d?.source === "openlibrary",
      inLibrary: d?.in_library ?? false,
      addedManually: manuallyAddedIds.includes(id),
      workId: d?.matched_work_id ?? null,
    };
  });

  const collapsed = collapseDuplicateCandidates(candidates);
  const items = rankRoadmap(collapsed, profile, overrideMap, options);
  const { readerLevel: _readerLevel, ...countBaseOptions } = options;
  void _readerLevel;
  const levelCounts = countByReaderLevel(collapsed, profile, overrideMap, countBaseOptions);
  return { rootWorkId, options, items, totalReached: bibIds.length, levelCounts, hiddenItems };
}
