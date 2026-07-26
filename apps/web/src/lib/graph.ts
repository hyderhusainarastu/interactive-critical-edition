import { conceptMastery, db, readingRecords, understandingRatings, workRelationshipJudgments } from "@ice/db";
import { phase25FeatureEnabled } from "@ice/config";
import { KNOWN_THRESHOLD, READER_LEVELS } from "@ice/roadmap";
import { and, eq, inArray, sql } from "drizzle-orm";
import { edgeTypeForRelationshipCategory, isDirectedEdgeType, type GraphLink, type GraphNode, type GraphPayload, type NodeState, type NodeType } from "@/components/graph/types";
import { deriveEdgeCategory } from "@/lib/graphEdgeCategory";
import { mapConceptConceptEdges, selectVisualNodes } from "@/lib/graphConnectivity";
import { loadDebateGraphAdditions } from "@/lib/graphDebate";

/**
 * Builds the per-user knowledge-graph data (plan §9/§16, extended by plan
 * §34.4 9.7) that feeds both the 3D visualizer and its accessible table
 * fallback. Nodes are the user's own works, the bibliographic records they
 * reference, the concepts/doctrines/people/traditions/debates those works
 * presuppose (plan §34.4 9.4's `concept` catalog, unified under one typed
 * table via `concept_kind` — reached via the same `graph_edge` mechanism as
 * references, not a second query shape), and — work-scoped only — the
 * primary work's own structural outline. Links are the analysis
 * `graphEdges` plus (work-scoped) synthetic, never-persisted outline edges.
 *
 * Every reference/concept node carries a state:
 *   read / reading / unread — from the user's reading record + rating
 *     (references) or concept mastery score (concepts)
 *   missing — referenced by the scholarship but NOT in the user's library
 *             (a "missing link", plan §9), i.e. no owned work matches it.
 *             Not applicable to concepts (nothing to "acquire").
 *   structural — outline/section nodes carry no read-state at all.
 * Per-user scoped throughout (never another user's works/status), which is
 * what makes the graph "unique to each user" as the brief requires. Concept
 * rows themselves are a shared, global catalog (like `bibliographic_record`)
 * — only which ones a user's OWN works presuppose, and their mastery score,
 * is per-user.
 *
 * **Sections are scoped honestly, not the way references/concepts are.**
 * Unlike concepts (a real, shared, cross-work catalog reached via a real
 * `graph_edge`), no cross-work "section" entity exists or should be
 * invented — a document's structure isn't a canonical, shared thing the way
 * a concept is. So section nodes are only ever produced for the work-scoped
 * graph (`rootWorkId` set), pulled directly from that one work's own
 * published run's `text_block` title/header rows (the same read-time-join
 * pattern `packages/curriculum`/`apps/web/src/lib/curriculum.ts` already
 * uses), connected to the primary work node by a synthetic `outline_section`
 * link that is computed here and never written to `graph_edge` — there is
 * nothing to persist, since a document's own structure is already the
 * source of truth in `text_block`.
 *
 * **Phase 21.2 (D-21-7):** two real, DB-invariant-backed relationship
 * sources the plan names were never read here at all — `resource_role`
 * (plan §34.4 9.5/9.6, a durable work-to-Library-resource role that
 * survives a run even after its `research_resource` row is superseded)
 * and `passage_annotation` (plan §34.4 9.3, a structurally anchored note
 * that reuses the same 10-category vocabulary as citation/classification
 * edges). Both are projected using `edgeTypeForRelationshipCategory()`
 * (`@/components/graph/types`), which maps `relationship_category` into
 * the SAME `edge_type` vocabulary the citation/classification edges
 * already use — so no new edge family, legend entry, or relation-filter
 * case is needed for either source.
 *
 * **Phase 28.4 (behind `phase25FeatureEnabled('graphDebateLayer')`):** the
 * knowledge-graph debate layer. See `@/lib/graphDebate`'s own doc comment —
 * `debate` cluster nodes are added here at default zoom, `claim` nodes only
 * via the dedicated per-cluster expansion route.
 */

// The node/edge shapes are the ONE shared graph contract (plan §21.1),
// declared in `@/components/graph/types` and consumed identically by this
// builder, the 3D scene, the accessible table, the inspector, and the
// filters. This module deliberately declares no parallel copies.
export type { GraphLink, GraphNode, GraphPayload, NodeState, NodeType } from "@/components/graph/types";

/** Node/link fields the contract requires but that are only computable once
 *  the full link set exists — filled in by the finalization pass at the end
 *  of `buildGraph()`, so intermediate construction can stay incremental. */
type DraftNode = Omit<GraphNode, "uploaded" | "associatedWorkIds" | "destination">;
type DraftLink = Omit<GraphLink, "id" | "directed" | "associatedWorkIds">;

interface WorkRow {
  id: string;
  title: string;
}
interface EdgeRow {
  source_id: string;
  target_id: string;
  edge_type: string;
  category: string | null;
  confidence: number;
}
interface RefRow {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  url: string | null;
  in_library: boolean;
}
interface ConceptRow {
  id: string;
  label: string;
  kind: string;
  summary: string | null;
  aliases: unknown;
}
interface SectionRow {
  id: string;
  text: string;
  kind: string;
  block_order: number;
}
interface SourceRow {
  id: string;
  run_id: string;
  work_id: string;
  bib_record_id: string | null;
  normalized_key: string | null;
  work_key: string | null;
  work_role: string;
  title: string;
  authors: unknown;
  year: number | null;
  url: string | null;
  doi: string | null;
  resource_type: string;
  provider: string;
  access_status: string;
  authority: string | null;
  score: number | null;
  peer_reviewed: boolean | null;
  content_status: string | null;
  license: string | null;
  source_url: string | null;
  provenance_provider: string | null;
  inspected_at: Date | null;
  provenance_depth: number | null;
  // Graph P1 (data contract v2, additive): the remaining credibility
  // dimensions (plan §33/§34.2), joined from the SAME `credibility_assessment`
  // row `authority`/`score`/`peer_reviewed` above already come from.
  publication_rigor: number | null;
  creator_expertise: number | null;
  host_provenance: number | null;
  pedagogical_value: number | null;
  relevance: number | null;
  evidence_strength: number | null;
  rationale: string | null;
  creator: unknown;
  popularity: unknown;
}
interface ResourceRelationRow {
  id: string;
  run_id: string;
  resource_id: string | null;
  related_resource_id: string | null;
  relation_type: string;
  depth: number;
  importance: number | null;
  evidence: unknown;
  confidence: number;
}
interface ResourceRoleRow {
  role_id: string;
  relationship: string;
  reader_level: string | null;
  confidence: number;
  rationale: string | null;
  work_id: string;
  resource_id: string;
  bib_record_id: string | null;
  normalized_key: string | null;
  title: string;
  url: string | null;
  provider: string;
  resource_type: string;
  year: number | null;
  authors: unknown;
  peer_reviewed: boolean | null;
  // Graph P1 (data contract v2, additive): the durable `learning_resource`
  // projection's own workRole/venue/doi/creator/popularity — available even
  // when this run's own research pass didn't (re)discover the resource (the
  // "role-node-added" path below has no `research_resource`/
  // `credibility_assessment` row to join for the rest of the dimensions).
  work_role: string;
  venue: string | null;
  doi: string | null;
  creator: unknown;
  popularity: unknown;
}
interface PassageAnnotationRow {
  annotation_id: string;
  relationship: string;
  reader_level: string | null;
  confidence: number;
  annotation_type: string;
  summary: string;
  explanation: string;
  is_whole_work: boolean;
  related_resource_id: string | null;
  run_id: string;
  work_id: string;
}

const NORM = (c: string) => sql.raw(`regexp_replace(lower(${c}), '[^a-z0-9]', '', 'g')`);

function displayAuthors(value: unknown): string | null {
  if (Array.isArray(value)) {
    const names = value.filter((name): name is string => typeof name === "string" && Boolean(name.trim()));
    return names.length ? names.join(", ") : null;
  }
  return typeof value === "string" && value.trim() ? value : null;
}

/** Graph P1 (data contract v2): jsonb string array → `string[] | undefined`
 *  (never a fabricated empty array) — used for `concept.aliases`. */
function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return items.length ? items : undefined;
}

/** Graph P1 (data contract v2): builds a node's `credibility` dossier from a
 *  `credibility_assessment` row's fields, or null when no assessment exists
 *  (`score == null`) — never a fabricated all-null object standing in for
 *  "no data". */
function credibilityFromAssessment(row: {
  score: number | null;
  authority: string | null;
  publication_rigor: number | null;
  creator_expertise: number | null;
  host_provenance: number | null;
  pedagogical_value: number | null;
  relevance: number | null;
  evidence_strength: number | null;
  peer_reviewed: boolean | null;
  rationale: string | null;
  creator: unknown;
  popularity: unknown;
}): GraphNode["credibility"] {
  if (row.score == null) return null;
  return {
    score: row.score,
    authority: row.authority,
    publicationRigor: row.publication_rigor,
    creatorExpertise: row.creator_expertise,
    hostProvenance: row.host_provenance,
    pedagogicalValue: row.pedagogical_value,
    relevance: row.relevance,
    evidenceStrength: row.evidence_strength,
    peerReviewed: row.peer_reviewed,
    rationale: row.rationale,
    creator: row.creator,
    popularity: row.popularity,
  };
}

export async function buildGraph(userId: string, rootWorkId?: string): Promise<GraphPayload> {
  // 1) Work nodes (all the user's, or just the root when work-scoped).
  // Trashed works (plan §34.4 9.7) are excluded — same as gone until restored.
  const works = (await db.execute(sql`
    SELECT id, title FROM work
    WHERE user_id = ${userId} AND deleted_at IS NULL
    ${rootWorkId ? sql`AND id = ${rootWorkId}` : sql``}
  `)) as unknown as WorkRow[];

  if (works.length === 0) {
    return { nodes: [], links: [], stats: { works: 0, references: 0, sources: 0, concepts: 0, people: 0, missing: 0, read: 0 } };
  }

  // 1b) Debate layer (Phase 28.4, behind `phase25FeatureEnabled('graphDebateLayer')`):
  // `debate` cluster nodes + `in_debate` edges to the participating work(s)
  // in `works` above (all of the user's works, or just `rootWorkId`). Flag
  // off means zero extra queries and a byte-identical payload to before this
  // phase existed — see `loadDebateGraphAdditions`'s own doc comment for why
  // individual `claim` nodes never appear here (only via the dedicated
  // per-cluster expansion route).
  const debateAdditions = phase25FeatureEnabled("graphDebateLayer")
    ? await loadDebateGraphAdditions(userId, works.map((w) => w.id))
    : { nodes: [], links: [] };

  // 2) Edges out of those works.
  const edges = (await db.execute(sql`
    SELECT source_id, target_id, edge_type, (evidence->>'category') AS category, confidence
    FROM graph_edge
    WHERE user_id = ${userId} AND source_type = 'work' AND target_type = 'bibliographic_record'
    ${rootWorkId ? sql`AND source_id = ${rootWorkId}` : sql``}
  `)) as unknown as EdgeRow[];

  const refIds = [...new Set(edges.map((e) => e.target_id))];

  // 3) Reference records + in-library flag.
  const refs =
    refIds.length > 0
      ? ((await db.execute(sql`
          SELECT br.id, br.title, br.authors, br.year, br.url,
            EXISTS (
              SELECT 1 FROM work w
              WHERE w.user_id = ${userId} AND w.deleted_at IS NULL AND ${NORM("w.title")} = ${NORM("br.title")}
            ) AS in_library
          FROM bibliographic_record br
          WHERE br.id IN ${refIds}
        `)) as unknown as RefRow[])
      : [];

  // 3b) v2 research enrichment: best authority + discovering provider per bib,
  // widened (Graph P1, data contract v2) to carry the full credibility
  // dossier from the SAME winning assessment row.
  interface EnrichRow {
    bib_id: string;
    authority: string | null;
    score: number | null;
    provider: string | null;
    publication_rigor: number | null;
    creator_expertise: number | null;
    host_provenance: number | null;
    pedagogical_value: number | null;
    relevance: number | null;
    evidence_strength: number | null;
    peer_reviewed: boolean | null;
    rationale: string | null;
    creator: unknown;
    popularity: unknown;
  }
  const enrichRows =
    refIds.length > 0
      ? ((await db.execute(sql`
          SELECT rr.bib_record_id AS bib_id, ca.authority, ca.score, rr.provider,
            ca.publication_rigor, ca.creator_expertise, ca.host_provenance, ca.pedagogical_value,
            ca.relevance, ca.evidence_strength, ca.peer_reviewed, ca.rationale, ca.creator, ca.popularity
          FROM research_resource rr
          LEFT JOIN credibility_assessment ca ON ca.resource_id = rr.id
          WHERE rr.bib_record_id IN ${refIds}
        `)) as unknown as EnrichRow[])
      : [];
  const AUTH_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  const enrichByBib = new Map<
    string,
    { authority: string | null; credibilityScore: number | null; provider: string | null; credibility: GraphNode["credibility"] }
  >();
  for (const row of enrichRows) {
    if (!row.bib_id) continue;
    const prior = enrichByBib.get(row.bib_id);
    const better = !prior || (AUTH_ORDER[row.authority ?? "E"] ?? 4) < (AUTH_ORDER[prior.authority ?? "E"] ?? 4);
    if (better)
      enrichByBib.set(row.bib_id, {
        authority: row.authority,
        credibilityScore: row.score,
        provider: row.provider,
        credibility: credibilityFromAssessment(row),
      });
  }

  // 4) Reading state (records + ratings) for those references.
  const [records, ratings] = await Promise.all([
    db.select({ bibId: readingRecords.bibId, status: readingRecords.status }).from(readingRecords).where(eq(readingRecords.userId, userId)),
    db
      .select({ bibId: understandingRatings.bibId, score: understandingRatings.score })
      .from(understandingRatings)
      .where(eq(understandingRatings.userId, userId)),
  ]);
  const statusByBib = new Map(records.filter((r) => r.bibId).map((r) => [r.bibId!, r.status]));
  const scoreByBib = new Map(ratings.filter((r) => r.bibId).map((r) => [r.bibId!, r.score]));

  // 5) Concept edges out of those works (plan §34.4 9.4/9.7) — the same
  // `graph_edge` mechanism as references, just a different target type.
  // `concept` is a global, shared catalog (like `bibliographic_record`), so
  // only the edge (which concepts THIS user's works presuppose) is
  // per-user, not the concept rows themselves.
  const conceptEdges = (await db.execute(sql`
    SELECT source_id, target_id, edge_type, (evidence->>'category') AS category, confidence
    FROM graph_edge
    WHERE user_id = ${userId} AND source_type = 'work' AND target_type = 'concept'
    ${rootWorkId ? sql`AND source_id = ${rootWorkId}` : sql``}
  `)) as unknown as EdgeRow[];
  const conceptIds = [...new Set(conceptEdges.map((e) => e.target_id))];

  const conceptRows =
    conceptIds.length > 0
      ? ((await db.execute(sql`
          SELECT id, label, kind FROM concept WHERE id IN ${conceptIds}
        `)) as unknown as ConceptRow[])
      : [];

  const masteryRows =
    conceptIds.length > 0
      ? await db
          .select({ conceptId: conceptMastery.conceptId, score: conceptMastery.score })
          .from(conceptMastery)
          .where(and(eq(conceptMastery.userId, userId), inArray(conceptMastery.conceptId, conceptIds)))
      : [];
  const masteryByConcept = new Map(masteryRows.map((r) => [r.conceptId, r.score]));

  // 5b) Published, owner-scoped research sources. Unlike the older
  // bibliographic projection above, these retain provider/run/access/text
  // provenance and include web sources that do not have catalogue records.
  // The LATERAL join deliberately picks one provenance record per source so
  // a source node is never duplicated by its audit trail.
  const sourceRows = (await db.execute(sql`
    SELECT rr.id, rr.run_id, d.work_id, rr.bib_record_id, rr.normalized_key, rr.work_key, rr.work_role, rr.title, rr.authors,
      rr.year, rr.url, rr.doi, rr.resource_type, rr.provider, rr.access_status,
      ca.authority, ca.score, ca.peer_reviewed,
      ca.publication_rigor, ca.creator_expertise, ca.host_provenance, ca.pedagogical_value,
      ca.relevance, ca.evidence_strength, ca.rationale, ca.creator, ca.popularity,
      rrc.status AS content_status, rrc.license, rrc.source_url,
      rp.provider AS provenance_provider, rp.inspected_at, rp.inspection_depth AS provenance_depth
    FROM research_resource rr
    JOIN processing_run pr ON pr.id = rr.run_id
    JOIN document d ON d.id = pr.document_id
    LEFT JOIN credibility_assessment ca ON ca.resource_id = rr.id
    LEFT JOIN research_resource_content rrc ON rrc.resource_id = rr.id
    LEFT JOIN LATERAL (
      SELECT provider, inspected_at, inspection_depth
      FROM resource_provenance
      WHERE resource_id = rr.id
      ORDER BY created_at DESC
      LIMIT 1
    ) rp ON true
    WHERE d.user_id = ${userId} AND pr.is_published = true
    ${rootWorkId ? sql`AND d.work_id = ${rootWorkId}` : sql``}
    ORDER BY rr.created_at ASC
  `)) as unknown as SourceRow[];

  const sourceIds = new Set(sourceRows.map((row) => row.id));
  const resourceRelations = (await db.execute(sql`
    SELECT er.id, er.run_id, er.resource_id, er.related_resource_id,
      er.relation_type, er.depth, er.importance, er.evidence, er.confidence
    FROM edition_relation er
    JOIN processing_run pr ON pr.id = er.run_id
    JOIN document d ON d.id = pr.document_id
    WHERE d.user_id = ${userId} AND pr.is_published = true
    ${rootWorkId ? sql`AND d.work_id = ${rootWorkId}` : sql``}
    ORDER BY er.created_at ASC
  `)) as unknown as ResourceRelationRow[];

  // 5c) Phase 21.2 (D-21-7): resource_role rows — a durable projection that
  // outlives any one run's `research_resource` rows, so it is read
  // independently of the `is_published` run scoping above and joined
  // straight off the owned, non-deleted `work_identity` instead.
  const resourceRoleRows = (await db.execute(sql`
    SELECT role.id AS role_id, role.relationship, role.reader_level, role.confidence, role.rationale,
      w.id AS work_id,
      lr.id AS resource_id, lr.bib_record_id, lr.normalized_key, lr.title, lr.url,
      lr.provider, lr.resource_type, lr.year, lr.authors, lr.peer_reviewed,
      lr.work_role, lr.venue, lr.doi, lr.creator, lr.popularity
    FROM resource_role role
    JOIN work w ON w.work_identity_id = role.work_identity_id
    JOIN learning_resource lr ON lr.id = role.learning_resource_id
    WHERE w.user_id = ${userId} AND w.deleted_at IS NULL
    ${rootWorkId ? sql`AND w.id = ${rootWorkId}` : sql``}
  `)) as unknown as ResourceRoleRow[];

  // 5d) Phase 21.2 (D-21-7): passage_annotation rows that relate the
  // primary text to a discovered resource — the same published-run scoping
  // as the source/resource-relation queries above, and only rows with a
  // real related resource (a whole-work or unrelated note has no second
  // graph endpoint to connect).
  const passageAnnotationRows = (await db.execute(sql`
    SELECT pa.id AS annotation_id, pa.relationship, pa.reader_level, pa.confidence,
      pa.annotation_type, pa.summary, pa.explanation, pa.is_whole_work, pa.related_resource_id,
      pa.run_id, d.work_id
    FROM passage_annotation pa
    JOIN processing_run pr ON pr.id = pa.run_id
    JOIN document d ON d.id = pr.document_id
    WHERE d.user_id = ${userId} AND pr.is_published = true AND pa.related_resource_id IS NOT NULL
    ${rootWorkId ? sql`AND d.work_id = ${rootWorkId}` : sql``}
  `)) as unknown as PassageAnnotationRow[];

  // 5e) Graph P1 (data contract v2, additive, forward-compat only): concept↔
  // concept `graph_edge` rows. Verified nothing writes
  // `source_type = 'concept'`/`target_type = 'concept'` today — the only
  // concept-touching writer is Phase 21.2's work→concept classification
  // (`apps/worker/src/analyze.ts`). This query exists so a FUTURE worker
  // producer (e.g. an inter-concept "presupposes"/"related_to" pass over the
  // concept catalog) needs no `buildGraph()` change to surface its edges; it
  // is a guarded no-op — always zero rows — until such a producer exists.
  // Not `rootWorkId`-scoped (concept-concept edges carry no work_id column);
  // any row whose endpoints aren't already concept nodes in this request's
  // scope is naturally dropped by the trailing connectivity filter below.
  const conceptConceptEdges = (await db.execute(sql`
    SELECT source_id, target_id, edge_type, (evidence->>'category') AS category, confidence
    FROM graph_edge
    WHERE user_id = ${userId} AND source_type = 'concept' AND target_type = 'concept'
  `)) as unknown as EdgeRow[];

  // 6) Section outline nodes — work-scoped ONLY (see the module doc comment
  // for why this isn't attempted for the global graph). Pulled straight
  // from the primary work's own published run, same read-time-join pattern
  // as `apps/web/src/lib/curriculum.ts`.
  const sectionRows: SectionRow[] =
    rootWorkId
      ? ((await db.execute(sql`
          SELECT tb.id, tb.text, tb.kind, tb.block_order
          FROM text_block tb
          JOIN page p ON p.id = tb.page_id
          JOIN processing_run pr ON pr.id = p.run_id
          JOIN document d ON d.id = pr.document_id
          WHERE d.work_id = ${rootWorkId} AND pr.is_published = true
            AND tb.kind IN ('title', 'header')
          ORDER BY p.page_index, tb.block_order
        `)) as unknown as SectionRow[])
      : [];

  // `bibliographic_record` is a canonical work. A research result is an
  // observation of that work (possibly from several providers/runs), not a
  // second node. Keep a separate identity for genuinely distinct public
  // objects such as an individual video or social post.
  // Contract `destination` (plan §21.1): a graph node navigates to its
  // Library entry only when `/library/[resourceId]`'s own ownership gate
  // (a `resource_role` pointing at one of the caller's owned, non-deleted
  // work identities) would actually resolve it — never a guessed 404 route.
  const libraryRows = (await db.execute(sql`
    SELECT lr.id, lr.bib_record_id, lr.normalized_key
    FROM learning_resource lr
    WHERE EXISTS (
      SELECT 1
      FROM resource_role role
      JOIN work w ON w.work_identity_id = role.work_identity_id
      WHERE role.learning_resource_id = lr.id
        AND w.user_id = ${userId} AND w.deleted_at IS NULL
    )
  `)) as unknown as { id: string; bib_record_id: string | null; normalized_key: string | null }[];
  const libraryIdByBib = new Map<string, string>();
  const libraryIdByKey = new Map<string, string>();
  for (const row of libraryRows) {
    if (row.bib_record_id && !libraryIdByBib.has(row.bib_record_id)) libraryIdByBib.set(row.bib_record_id, row.id);
    if (row.normalized_key && !libraryIdByKey.has(row.normalized_key)) libraryIdByKey.set(row.normalized_key, row.id);
  }
  /** Canonical node id → `/library/<id>` destination, recorded while nodes
   *  are built so aliased/merged ids resolve through the same collapse. */
  const libraryDestinationByNodeId = new Map<string, string>();

  const nodeById = new Map<string, DraftNode>();
  const addNode = (node: DraftNode) => nodeById.set(node.id, node);
  for (const w of works) addNode({
    id: `work:${w.id}`, label: w.title, type: "work", state: "primary",
    authors: null, year: null, url: null, authority: null, credibilityScore: null, provider: null, kind: null,
  });

  const authorityRank = (authority: string | null | undefined) => AUTH_ORDER[authority ?? "E"] ?? 4;
  // Shared by both `research_resource` rows and `resource_role`'s durable
  // `learning_resource` rows (Phase 21.2/D-21-7) — same heuristic, one place.
  const resourceNodeType = (peerReviewed: boolean | null, resourceType: string): NodeType => {
    if (peerReviewed) return "peer_reviewed_source";
    if (["webpage", "video", "social_post", "dataset"].includes(resourceType)) return "online_source";
    return "reference";
  };
  const sourceTypeFor = (source: SourceRow): NodeType => resourceNodeType(source.peer_reviewed, source.resource_type);
  const rawExternalId = (source: SourceRow) => source.bib_record_id
    ? `external:bib:${source.bib_record_id}`
    : `external:source:${source.normalized_key ?? source.id}`;

  // Phase 20.6 canonical collapse: PRIMARY/EDITION records that share a
  // derived work identity (`research_resource.work_key`) are ONE work — a
  // cited book that resolved to two bibliographic records (canary-10's
  // defect) must be one node, with editions nested into it. Reviews and
  // other non-primary roles deliberately stay separate nodes: they are
  // ATTACHED via their `review_of`-style relation edges, never merged.
  // Only groups with 2+ distinct raw ids are aliased, so every
  // single-record work keeps its exact pre-existing node id.
  const idsByWorkKey = new Map<string, { rawId: string; hasBib: boolean }[]>();
  for (const source of sourceRows) {
    if (!source.work_key || !["primary", "edition"].includes(source.work_role)) continue;
    const rawId = rawExternalId(source);
    const list = idsByWorkKey.get(source.work_key) ?? [];
    if (!list.some((entry) => entry.rawId === rawId)) list.push({ rawId, hasBib: Boolean(source.bib_record_id) });
    idsByWorkKey.set(source.work_key, list);
  }
  const aliasByRawId = new Map<string, string>();
  for (const entries of idsByWorkKey.values()) {
    if (entries.length < 2) continue;
    const representative = [...entries].sort((a, b) => Number(b.hasBib) - Number(a.hasBib) || a.rawId.localeCompare(b.rawId))[0];
    for (const entry of entries) {
      if (entry.rawId !== representative.rawId) aliasByRawId.set(entry.rawId, representative.rawId);
    }
  }
  const canonicalNodeId = (rawId: string) => aliasByRawId.get(rawId) ?? rawId;
  const canonicalExternalId = (source: SourceRow) => canonicalNodeId(rawExternalId(source));
  const sourceNodeIds = new Map<string, string>();
  const publicOnlyByNode = new Map<string, boolean>();
  const providerIsPublic = (provider: string) => ["youtube", "mastodon", "bluesky"].includes(provider.toLocaleLowerCase());

  const mergeExternal = (id: string, incoming: DraftNode, isPublic: boolean) => {
    const current = nodeById.get(id);
    if (!current) {
      addNode({ ...incoming, providers: incoming.provider ? [incoming.provider] : [], provenances: incoming.provenance ? [incoming.provenance] : [] });
      publicOnlyByNode.set(id, isPublic);
      return;
    }
    const providers = [...new Set([...(current.providers ?? (current.provider ? [current.provider] : [])), ...(incoming.provider ? [incoming.provider] : [])])];
    const provenances = [...(current.provenances ?? (current.provenance ? [current.provenance] : [])), ...(incoming.provenance ? [incoming.provenance] : [])]
      .filter((value, index, values) => values.findIndex((other) => `${other.runId}:${other.provider}:${other.inspectionDepth}` === `${value.runId}:${value.provider}:${value.inspectionDepth}`) === index);
    const incomingBetter = authorityRank(incoming.authority) < authorityRank(current.authority);
    nodeById.set(id, {
      ...current,
      ...(incomingBetter ? {
        authority: incoming.authority,
        credibilityScore: incoming.credibilityScore,
        provider: incoming.provider,
      } : {}),
      // A canonical bibliography row is a work-level label; only use the
      // source type when no canonical bibliography node has supplied one.
      type: current.type === "reference" ? current.type : incoming.type,
      url: current.url ?? incoming.url,
      authors: current.authors ?? incoming.authors,
      year: current.year ?? incoming.year,
      accessStatus: current.accessStatus ?? incoming.accessStatus,
      sourceTextStatus: current.sourceTextStatus ?? incoming.sourceTextStatus,
      license: current.license ?? incoming.license,
      sourceUrl: current.sourceUrl ?? incoming.sourceUrl,
      // Graph P1 (data contract v2, additive): workRole/venue/doi are
      // first-seen-wins like url/authors/year above. `credibility` is kept
      // as a coherent whole from whichever source is currently the
      // authority-rank winner (never mixing dimensions from two different
      // providers), falling back to the other source's dossier only when
      // the winner itself has none.
      workRole: current.workRole ?? incoming.workRole,
      doi: current.doi ?? incoming.doi,
      venue: current.venue ?? incoming.venue,
      credibility: incomingBetter ? (incoming.credibility ?? current.credibility) : (current.credibility ?? incoming.credibility),
      providers,
      provenances,
      provenance: provenances[0] ?? null,
    });
    publicOnlyByNode.set(id, (publicOnlyByNode.get(id) ?? false) && isPublic);
  };

  for (const r of refs) {
    const status = statusByBib.get(r.id);
    const score = scoreByBib.get(r.id) ?? 0;
    const state: NodeState = status === "completed" || score >= KNOWN_THRESHOLD
      ? "read"
      : status === "reading"
        ? "reading"
        : !r.in_library
          ? "missing"
          : "unread";
    const enrich = enrichByBib.get(r.id);
    const bibNodeId = canonicalNodeId(`external:bib:${r.id}`);
    const libraryId = libraryIdByBib.get(r.id);
    if (libraryId && !libraryDestinationByNodeId.has(bibNodeId)) libraryDestinationByNodeId.set(bibNodeId, `/library/${libraryId}`);
    mergeExternal(bibNodeId, {
      id: bibNodeId, label: r.title, type: "reference", state,
      authors: r.authors, year: r.year, url: r.url,
      authority: enrich?.authority ?? null, credibilityScore: enrich?.credibilityScore ?? null,
      provider: enrich?.provider ?? null, kind: null,
      credibility: enrich?.credibility ?? null,
    }, false);
  }

  for (const source of sourceRows) {
    const id = canonicalExternalId(source);
    sourceNodeIds.set(source.id, id);
    const libraryId =
      (source.bib_record_id ? libraryIdByBib.get(source.bib_record_id) : undefined) ??
      (source.normalized_key ? libraryIdByKey.get(source.normalized_key) : undefined);
    if (libraryId && !libraryDestinationByNodeId.has(id)) libraryDestinationByNodeId.set(id, `/library/${libraryId}`);
    const sourceBibStatus = source.bib_record_id ? statusByBib.get(source.bib_record_id) : undefined;
    const sourceBibScore = source.bib_record_id ? scoreByBib.get(source.bib_record_id) ?? 0 : 0;
    const state: NodeState = sourceBibStatus === "completed" || sourceBibScore >= KNOWN_THRESHOLD
      ? "read"
      : sourceBibStatus === "reading"
        ? "reading"
        : "unread";
    mergeExternal(id, {
      id, label: source.title, type: sourceTypeFor(source), state,
      authors: displayAuthors(source.authors), year: source.year, url: source.url,
      authority: source.authority, credibilityScore: source.score, provider: source.provider,
      kind: source.resource_type, accessStatus: source.access_status,
      sourceTextStatus: source.content_status ?? "metadata_only", license: source.license, sourceUrl: source.source_url,
      workRole: source.work_role, doi: source.doi,
      credibility: credibilityFromAssessment(source),
      provenance: {
        runId: source.run_id, provider: source.provenance_provider ?? source.provider,
        inspectedAt: source.inspected_at ? new Date(source.inspected_at).toISOString() : null,
        inspectionDepth: source.provenance_depth ?? 0,
      },
    }, providerIsPublic(source.provider));
  }
  for (const [id, publicOnly] of publicOnlyByNode) {
    const node = nodeById.get(id);
    if (node) node.supplementary = publicOnly && ["D", "E"].includes(node.authority ?? "");
  }

  // Phase 21.2 (D-21-7): a resource_role's `learning_resource` almost always
  // already has a node here (via `refs`/`sourceRows` above) — attach the new
  // edge to it. On the rarer path where this run's own research pass didn't
  // (re)discover it, add a minimal node from the durable projection itself
  // rather than silently dropping the relationship.
  //
  // Graph P1 (data contract v2, additive): also the ONE place a node's
  // `readerLevels` union is computed — every `resource_role` row targeting a
  // node contributes its level (a null level, "applies at every level", per
  // the plan, expands to every value in `READER_LEVELS` rather than a
  // separate sentinel) — and the one place venue/doi/workRole/a
  // learning-resource-only credibility fact get backfilled onto a node this
  // run's own research didn't (re)discover with a fuller dossier.
  const roleNodeAdded = new Set<string>();
  const readerLevelsByNode = new Map<string, Set<string>>();
  const addReaderLevel = (nodeId: string, level: string | null) => {
    const set = readerLevelsByNode.get(nodeId) ?? new Set<string>();
    if (level == null) for (const lvl of READER_LEVELS) set.add(lvl);
    else set.add(level);
    readerLevelsByNode.set(nodeId, set);
  };
  for (const role of resourceRoleRows) {
    const rawId = role.bib_record_id ? `external:bib:${role.bib_record_id}` : `external:source:${role.normalized_key ?? role.resource_id}`;
    const nodeId = canonicalNodeId(rawId);
    addReaderLevel(nodeId, role.reader_level);
    const roleCredibility: GraphNode["credibility"] =
      role.peer_reviewed != null || role.creator != null || role.popularity != null
        ? {
            score: null, authority: null, publicationRigor: null, creatorExpertise: null,
            hostProvenance: null, pedagogicalValue: null, relevance: null, evidenceStrength: null,
            peerReviewed: role.peer_reviewed, rationale: null, creator: role.creator, popularity: role.popularity,
          }
        : null;
    if (!nodeById.has(nodeId) && !roleNodeAdded.has(nodeId)) {
      roleNodeAdded.add(nodeId);
      addNode({
        id: nodeId, label: role.title, type: resourceNodeType(role.peer_reviewed, role.resource_type), state: "unread",
        authors: displayAuthors(role.authors), year: role.year, url: role.url,
        authority: null, credibilityScore: null, provider: role.provider, kind: role.resource_type,
        workRole: role.work_role, doi: role.doi, venue: role.venue, credibility: roleCredibility,
      });
    } else {
      // Node already exists from `refs`/`sourceRows` above — only backfill
      // fields it doesn't already have, same current-wins pattern as
      // `mergeExternal`, never overwriting a fuller dossier with this
      // narrower one.
      const existing = nodeById.get(nodeId);
      if (existing) {
        nodeById.set(nodeId, {
          ...existing,
          workRole: existing.workRole ?? role.work_role,
          doi: existing.doi ?? role.doi,
          venue: existing.venue ?? role.venue,
          credibility: existing.credibility ?? roleCredibility,
        });
      }
    }
    const libraryId = (role.bib_record_id ? libraryIdByBib.get(role.bib_record_id) : undefined) ?? (role.normalized_key ? libraryIdByKey.get(role.normalized_key) : undefined);
    if (libraryId && !libraryDestinationByNodeId.has(nodeId)) libraryDestinationByNodeId.set(nodeId, `/library/${libraryId}`);
  }

  for (const c of conceptRows) {
    const rawMastery = masteryByConcept.get(c.id);
    addNode({
      id: `concept:${c.id}`, label: c.label, type: c.kind === "person" ? "person" : "concept",
      state: (rawMastery ?? 0) >= KNOWN_THRESHOLD ? "read" : "unread", authors: null, year: null, url: null,
      authority: null, credibilityScore: null, provider: null, kind: c.kind,
      summary: c.summary, aliases: stringArray(c.aliases), masteryScore: rawMastery ?? null,
    });
  }
  for (const s of sectionRows) addNode({
    id: `section:${s.id}`, label: s.text.length > 120 ? `${s.text.slice(0, 117)}...` : s.text,
    type: "section", state: "structural", authors: null, year: null, url: null,
    authority: null, credibilityScore: null, provider: null, kind: s.kind,
  });
  // Debate layer (Phase 28.4): a no-op loop when the flag is off or no
  // active cluster reaches this scope (`debateAdditions.nodes` is `[]`).
  for (const d of debateAdditions.nodes) addNode(d);

  const directRelationBySource = new Map<string, ResourceRelationRow>();
  for (const relation of resourceRelations) {
    if (relation.resource_id && !relation.related_resource_id && sourceIds.has(relation.resource_id) && !directRelationBySource.has(relation.resource_id)) {
      directRelationBySource.set(relation.resource_id, relation);
    }
  }

  // Phase 21.2 (D-21-7): a passage annotation's related resource is a
  // `research_resource` id, not yet a graph node id — resolved through the
  // same `sourceNodeIds` map the source-node loop above populated. Built as
  // an explicit loop (not a `.map()`) so a stale/cross-run reference can be
  // skipped rather than injecting an undefined endpoint into the payload.
  const passageAnnotationLinks: DraftLink[] = [];
  for (const pa of passageAnnotationRows) {
    const target = sourceNodeIds.get(pa.related_resource_id ?? "");
    if (!target) continue;
    passageAnnotationLinks.push({
      source: `work:${pa.work_id}`,
      target,
      edgeType: edgeTypeForRelationshipCategory(pa.relationship),
      category: pa.relationship,
      confidence: pa.confidence,
      explanation: pa.explanation,
      // Graph P1 (data contract v2): `readerLevel` promoted to a top-level
      // field — the `evidence.readerLevel` copy stays for back-compat.
      readerLevel: pa.reader_level,
      evidence: {
        source: "passage_annotation", annotationType: pa.annotation_type, summary: pa.summary,
        isWholeWork: pa.is_whole_work, readerLevel: pa.reader_level,
      },
      provenance: { relationId: pa.annotation_id, runId: pa.run_id, depth: 0 },
    });
  }

  const links: DraftLink[] = [
    // D-21-9 (fixable half): `cites`/`presupposes` edges from the
    // citation-resolution/concept-extraction write paths never carry a
    // `category` in `evidence` (only the classification write paths do) —
    // `deriveEdgeCategory` fills in the ONE unambiguous category each of
    // those two edge_type strings actually corresponds to, and leaves
    // every other edge_type (already-categorized or genuinely uncategorized)
    // exactly as read. See `@/lib/graphEdgeCategory` for the full rationale.
    ...edges.map((e) => ({
      source: `work:${e.source_id}`,
      target: canonicalNodeId(`external:bib:${e.target_id}`),
      edgeType: e.edge_type,
      category: deriveEdgeCategory(e.edge_type, e.category),
      confidence: e.confidence,
    })),
    ...conceptEdges.map((e) => ({
      source: `work:${e.source_id}`,
      target: `concept:${e.target_id}`,
      edgeType: e.edge_type,
      category: deriveEdgeCategory(e.edge_type, e.category),
      confidence: e.confidence,
    })),
    // Synthetic, never persisted (see module doc comment) — the work's own
    // outline, computed fresh from text_block every request.
    ...(rootWorkId
      ? sectionRows.map((s) => ({
          source: `work:${rootWorkId}`,
          target: `section:${s.id}`,
          edgeType: "outline_section",
          category: null,
          confidence: 1,
        }))
      : []),
    ...sourceRows.map((source) => {
      const relation = directRelationBySource.get(source.id);
      return {
        source: `work:${source.work_id}`,
        target: sourceNodeIds.get(source.id)!,
        edgeType: relation?.relation_type ?? "discovered_source",
        category: relation?.relation_type ?? null,
        confidence: relation?.confidence ?? 0,
        evidence: relation?.evidence,
        provenance: relation ? { relationId: relation.id, runId: relation.run_id, depth: relation.depth } : null,
      };
    }),
    ...resourceRelations
      .filter((relation) => relation.resource_id && relation.related_resource_id && sourceIds.has(relation.resource_id) && sourceIds.has(relation.related_resource_id))
      .map((relation) => ({
        source: sourceNodeIds.get(relation.resource_id!)!,
        target: sourceNodeIds.get(relation.related_resource_id!)!,
        edgeType: relation.relation_type,
        category: "source_provenance",
        confidence: relation.confidence,
        evidence: relation.evidence,
        provenance: { relationId: relation.id, runId: relation.run_id, depth: relation.depth },
      })),
    // Phase 21.2 (D-21-7): resource_role rows — every target here already
    // has a node, either from `refs`/`sourceRows` above or from the
    // role-node-attach loop above, so no existence guard is needed.
    ...resourceRoleRows.map((role) => {
      const rawId = role.bib_record_id ? `external:bib:${role.bib_record_id}` : `external:source:${role.normalized_key ?? role.resource_id}`;
      return {
        source: `work:${role.work_id}`,
        target: canonicalNodeId(rawId),
        edgeType: edgeTypeForRelationshipCategory(role.relationship),
        category: role.relationship,
        confidence: role.confidence,
        explanation: role.rationale,
        // Graph P1 (data contract v2): `readerLevel` promoted to a top-level
        // field — the `evidence.readerLevel` copy stays for back-compat.
        readerLevel: role.reader_level,
        evidence: { source: "resource_role", readerLevel: role.reader_level, roleId: role.role_id },
      };
    }),
    ...passageAnnotationLinks,
    // Graph P1 (data contract v2, additive, forward-compat only) — see
    // `mapConceptConceptEdges`'s own doc comment for why this is always a
    // no-op today.
    ...mapConceptConceptEdges(conceptConceptEdges, deriveEdgeCategory),
    // Debate layer (Phase 28.4) — see the `debateAdditions` fetch above.
    ...debateAdditions.links,
  ];

  // Phase 12.5: only a durable, evidence-hashed judgement becomes a
  // cross-work edge. Retrieval candidates never appear as relationships.
  // This keeps an isolated work visible while preventing a vector/BM25 score
  // from masquerading as a scholarly claim.
  if (!rootWorkId) {
    const judgments = await db
      .select({
        sourceWorkId: workRelationshipJudgments.sourceWorkId,
        targetWorkId: workRelationshipJudgments.targetWorkId,
        relationshipType: workRelationshipJudgments.relationshipType,
        confidence: workRelationshipJudgments.confidence,
        explanation: workRelationshipJudgments.explanation,
        evidence: workRelationshipJudgments.evidence,
        updatedAt: workRelationshipJudgments.updatedAt,
      })
      .from(workRelationshipJudgments)
      .where(eq(workRelationshipJudgments.userId, userId));
    const visibleWorkIds = new Set(works.map((work) => work.id));
    // A changed basis can legitimately create a newer judgement. Display only
    // the latest one per directed pair, while retaining prior rows as the
    // permanent paid-judgement cache/audit history.
    const latest = new Map<string, (typeof judgments)[number]>();
    for (const judgment of judgments) {
      if (!visibleWorkIds.has(judgment.sourceWorkId) || !visibleWorkIds.has(judgment.targetWorkId)) continue;
      const key = `${judgment.sourceWorkId}:${judgment.targetWorkId}`;
      const prior = latest.get(key);
      if (!prior || judgment.updatedAt > prior.updatedAt) latest.set(key, judgment);
    }
    links.push(...[...latest.values()].map((judgment) => ({
      source: `work:${judgment.sourceWorkId}`,
      target: `work:${judgment.targetWorkId}`,
      edgeType: judgment.relationshipType,
      category: "cross_library",
      confidence: judgment.confidence,
      explanation: judgment.explanation,
      evidence: judgment.evidence,
    })));
  }

  // Logical duplicate links arise when a citation, a discovery run, and a
  // provider relation all describe the same relationship. Retain their
  // evidence/provenance in one edge rather than rendering parallel lines.
  const linkByIdentity = new Map<string, DraftLink>();
  for (const link of links) {
    if (link.source === link.target) continue;
    const key = `${link.source}\u0000${link.target}\u0000${link.edgeType}`;
    const prior = linkByIdentity.get(key);
    if (!prior) {
      linkByIdentity.set(key, {
        ...link,
        evidences: link.evidence ? [link.evidence] : [],
        provenances: link.provenance ? [link.provenance] : [],
      });
      continue;
    }
    const evidences = [...(prior.evidences ?? []), ...(link.evidence ? [link.evidence] : [])];
    const provenances = [...(prior.provenances ?? []), ...(link.provenance ? [link.provenance] : [])]
      .filter((value, index, values) => values.findIndex((other) => other.relationId === value.relationId) === index);
    linkByIdentity.set(key, {
      ...prior,
      confidence: Math.max(prior.confidence, link.confidence),
      evidence: prior.evidence ?? link.evidence,
      provenance: prior.provenance ?? link.provenance,
      evidences,
      provenances,
    });
  }
  const deduplicatedLinks = [...linkByIdentity.values()];
  const connectedIds = new Set(deduplicatedLinks.flatMap((link) => [link.source, link.target]));
  // Graph P1 (data contract v2): an UPLOADED WORK node stays visible even
  // with zero edges — the reader's own library entry for a freshly uploaded
  // or not-yet-analyzed work, not a research artifact that only matters via
  // its connections. This corrects a real bug the module's own Phase 12.5
  // comment above (`workRelationshipJudgments`) already claimed was true
  // ("keeps an isolated work visible") but the code never actually did. See
  // `selectVisualNodes`'s own doc comment for the full rule.
  const workNodeIds = new Set(works.map((work) => `work:${work.id}`));
  const visualNodes = selectVisualNodes([...nodeById.values()], connectedIds, workNodeIds);
  const visualIds = new Set(visualNodes.map((node) => node.id));
  const visualLinks = deduplicatedLinks.filter((link) => visualIds.has(link.source) && visualIds.has(link.target));

  // Finalization pass — the contract fields that need the complete link set
  // (plan §21.1): `uploaded`, per-node/per-edge `associatedWorkIds`, stable
  // edge ids, explicit `directed`, and the in-app `destination`.
  const associatedByNode = new Map<string, Set<string>>();
  const associate = (nodeId: string, workNodeId: string) => {
    const set = associatedByNode.get(nodeId) ?? new Set<string>();
    set.add(workNodeId);
    associatedByNode.set(nodeId, set);
  };
  for (const id of workNodeIds) associate(id, id);
  for (const link of visualLinks) {
    if (workNodeIds.has(link.source)) associate(link.target, link.source);
    if (workNodeIds.has(link.target)) associate(link.source, link.target);
  }
  const associatedWorkIdsFor = (nodeId: string) => [...(associatedByNode.get(nodeId) ?? [])].sort();

  const finalNodes: GraphNode[] = visualNodes.map((node) => ({
    ...node,
    uploaded: workNodeIds.has(node.id),
    associatedWorkIds: associatedWorkIdsFor(node.id),
    destination: workNodeIds.has(node.id)
      ? `/works/${node.id.slice("work:".length)}`
      : libraryDestinationByNodeId.get(node.id) ?? null,
    // Graph P1 (data contract v2): sorted for a stable, testable payload —
    // absent (not `[]`) when no `resource_role` row ever targeted this node.
    readerLevels: readerLevelsByNode.get(node.id) ? [...readerLevelsByNode.get(node.id)!].sort() : undefined,
  }));
  const finalLinks: GraphLink[] = visualLinks.map((link) => ({
    ...link,
    // Unique after the read-side dedup above, which keys on this triple.
    id: `${link.source}|${link.edgeType}|${link.target}`,
    directed: isDirectedEdgeType(link.edgeType),
    associatedWorkIds: [...new Set([...associatedWorkIdsFor(link.source), ...associatedWorkIdsFor(link.target)])].sort(),
  }));
  const count = (predicate: (node: GraphNode) => boolean) => finalNodes.filter(predicate).length;

  return {
    nodes: finalNodes,
    links: finalLinks,
    stats: {
      works: count((node) => node.type === "work"),
      references: count((node) => node.type === "reference"),
      sources: count((node) => node.type === "peer_reviewed_source" || node.type === "online_source"),
      concepts: count((node) => node.type === "concept"),
      people: count((node) => node.type === "person"),
      missing: count((node) => node.state === "missing"),
      read: count((node) => node.state === "read"),
    },
  };
}
