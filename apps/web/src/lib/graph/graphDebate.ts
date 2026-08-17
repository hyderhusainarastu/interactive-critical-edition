import { db } from "@ice/db";
import { sql } from "drizzle-orm";
import type { GraphLink, GraphNode } from "@/components/graph/types";

/**
 * The knowledge-graph debate layer (Phase 28.4, behind
 * `phase25FeatureEnabled('graphDebateLayer')`): projects the paid/durable
 * `debate_cluster` → `claim_relationship` → `research_claim` machinery
 * (Phase 26.2/26.3) into the SAME graph contract `apps/web/src/lib/graph.ts`
 * already emits for references/concepts/sections. Every read here is a
 * pure, $0 DB read — no LLM call, matching the plan's "Zero LLM calls, pure
 * DB read" requirement for both the base-payload additions and the
 * per-cluster expansion below.
 *
 * Two distinct surfaces, deliberately kept separate:
 *  - `loadDebateGraphAdditions` — called from `buildGraph()` for EVERY
 *    graph request once the flag is on: at most `MAX_DEBATE_NODES` `debate`
 *    nodes (one per active, non-hidden cluster), linked to the uploaded
 *    works that participate in them. NEVER individual `claim` nodes — those
 *    would make the base payload scale with claim count instead of debate
 *    count, defeating the whole point of a summary node.
 *  - `loadDebateClusterExpansion` — called only from the dedicated
 *    expansion route, on demand, for ONE cluster: its claim nodes (capped)
 *    plus their judged relationship/assertion edges. This is what makes a
 *    debate node's detail "expand in place" rather than bloating every
 *    graph load.
 */

/** At default zoom, at most this many `debate` nodes are ever emitted into
 *  the base payload — sized by claim count (the biggest, most-connected
 *  debates first) when more active clusters exist than the cap. */
export const MAX_DEBATE_NODES = 40;

/** A single cluster expansion never returns more claim nodes than this,
 *  matching the base payload's own "summarize, don't enumerate everything"
 *  discipline at the next zoom level down. */
export const MAX_CLAIMS_PER_EXPANSION = 60;

/** The shape `buildGraph()`'s own finalization pass expects to add
 *  (`uploaded`/`associatedWorkIds`/`destination` are computed there, not
 *  here) — structurally identical to that module's private `DraftNode`/
 *  `DraftLink` aliases (same `Omit` expression), so a value of this type is
 *  assignable wherever a `DraftNode`/`DraftLink` is expected. */
export type DebateDraftNode = Omit<GraphNode, "uploaded" | "associatedWorkIds" | "destination">;
export type DebateDraftLink = Omit<GraphLink, "id" | "directed" | "associatedWorkIds">;

export interface DebateGraphAdditions {
  nodes: DebateDraftNode[];
  links: DebateDraftLink[];
}

function truncateLabel(text: string, max = 120): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

interface ActiveDebateClusterRow {
  cluster_id: string;
  name: string;
  research_question: string | null;
  claim_count: number;
}

interface ClusterWorkRow {
  cluster_id: string;
  work_id: string;
}

/**
 * Base-payload additions for `buildGraph()`: `debate` nodes for the
 * requesting user's active, non-hidden `debate_cluster` rows that have at
 * least one member claim on one of `ownedWorkIds` (the SAME work set
 * `buildGraph()` already scoped its other queries to — the whole graph, or
 * just `rootWorkId` when work-scoped), plus `in_debate` edges to those
 * participating work nodes. `ownedWorkIds` must be non-empty (the caller
 * never reaches this when `works.length === 0` — see `buildGraph()`'s own
 * early return — matching the project's documented "guard for a non-empty
 * array before an `IN`" rule).
 */
export async function loadDebateGraphAdditions(userId: string, ownedWorkIds: string[]): Promise<DebateGraphAdditions> {
  if (ownedWorkIds.length === 0) return { nodes: [], links: [] };

  const clusters = (await db.execute(sql`
    SELECT dc.id AS cluster_id, dc.name, dc.research_question,
      (
        SELECT count(*)::int FROM debate_cluster_member dcm2 WHERE dcm2.cluster_id = dc.id
      ) AS claim_count
    FROM debate_cluster dc
    WHERE dc.user_id = ${userId} AND dc.status = 'active' AND dc.hidden = false
      AND EXISTS (
        SELECT 1 FROM debate_cluster_member dcm
        JOIN research_claim rc ON rc.id = dcm.claim_id
        WHERE dcm.cluster_id = dc.id AND rc.work_id IN ${ownedWorkIds}
      )
    ORDER BY claim_count DESC, dc.id ASC
    LIMIT ${MAX_DEBATE_NODES}
  `)) as unknown as ActiveDebateClusterRow[];

  if (clusters.length === 0) return { nodes: [], links: [] };
  const clusterIds = clusters.map((c) => c.cluster_id);

  const clusterWorks = (await db.execute(sql`
    SELECT DISTINCT dcm.cluster_id, rc.work_id
    FROM debate_cluster_member dcm
    JOIN research_claim rc ON rc.id = dcm.claim_id
    WHERE dcm.cluster_id IN ${clusterIds} AND rc.work_id IN ${ownedWorkIds}
  `)) as unknown as ClusterWorkRow[];

  const workIdsByCluster = new Map<string, string[]>();
  for (const row of clusterWorks) {
    const list = workIdsByCluster.get(row.cluster_id) ?? [];
    list.push(row.work_id);
    workIdsByCluster.set(row.cluster_id, list);
  }

  const nodes: DebateDraftNode[] = clusters.map((cluster) => ({
    id: `debate:${cluster.cluster_id}`,
    label: cluster.name,
    type: "debate",
    // A debate cluster is neither "acquired" (like a reference) nor a
    // per-work outline entry (like a section) — no read-state lifecycle
    // applies to it, the same reasoning `section` nodes already use.
    state: "structural",
    authors: null,
    year: null,
    url: null,
    authority: null,
    credibilityScore: null,
    provider: null,
    kind: null,
    debateClaimCount: cluster.claim_count,
    debateQuestion: cluster.research_question,
  }));

  const links: DebateDraftLink[] = clusters.flatMap((cluster) =>
    (workIdsByCluster.get(cluster.cluster_id) ?? []).map((workId) => ({
      source: `work:${workId}`,
      target: `debate:${cluster.cluster_id}`,
      edgeType: "in_debate",
      category: null,
      confidence: 1,
    })),
  );

  return { nodes, links };
}

interface ClusterOwnershipRow {
  id: string;
}

interface ExpansionClaimRow {
  claim_id: string;
  claim_text: string;
  claim_nature: string;
  work_id: string;
}

interface ExpansionRelationshipRow {
  claim_lo_id: string;
  claim_hi_id: string;
  valence: string;
  explanation: string;
  category: string;
  resolution: string;
  engagement: string;
}

const VALENCE_EDGE_TYPE: Record<string, string> = {
  contradiction: "claim_contradicts",
  support: "claim_supports",
  nuance: "claim_nuances",
};

const VALENCE_TALLY_LABEL: Record<string, string> = {
  contradiction: "contradiction",
  support: "support",
  nuance: "nuance",
};

function valenceSummaryFor(claimId: string, relationships: ExpansionRelationshipRow[]): string | null {
  const tally = new Map<string, number>();
  for (const rel of relationships) {
    if (rel.claim_lo_id !== claimId && rel.claim_hi_id !== claimId) continue;
    tally.set(rel.valence, (tally.get(rel.valence) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  return [...tally.entries()]
    .map(([valence, count]) => `${count} ${VALENCE_TALLY_LABEL[valence] ?? valence}${count === 1 ? "" : "s"}`)
    .join(" · ");
}

/**
 * Full, ready-to-merge expansion for one debate cluster (`GET
 * /api/graph/debate/[clusterId]/expand`): the cluster's member claims
 * (capped at `MAX_CLAIMS_PER_EXPANSION`, oldest-extracted first for
 * determinism) as complete `GraphNode`s, plus `asserts_claim` edges from
 * each claim's owning work and `claim_relationship` edges (mapped through
 * `VALENCE_EDGE_TYPE`) between claims — both endpoints of every returned
 * edge are guaranteed to be in the returned node set (dangling edges to a
 * claim this cap excluded are dropped, the same discipline
 * `filterGraphData`/`roadmapSubset` already apply to the base payload).
 *
 * Returns `null` when the cluster doesn't exist, isn't this user's, or is
 * `stale`/`hidden` — the caller maps that to a 404, never a 403 (the
 * project's owner-scoped-lookup-is-the-authorization-check convention).
 * Unlike `loadDebateGraphAdditions` above, this does NOT restrict to any
 * particular set of "owned works" beyond the cluster's own `user_id` scope
 * — a cluster's claims can only ever belong to that same user's works
 * (`research_claim.user_id`), so the ownership check on the cluster itself
 * is sufficient.
 */
export async function loadDebateClusterExpansion(
  userId: string,
  clusterId: string,
): Promise<{ nodes: GraphNode[]; links: GraphLink[] } | null> {
  const [cluster] = (await db.execute(sql`
    SELECT id FROM debate_cluster
    WHERE id = ${clusterId} AND user_id = ${userId} AND status = 'active' AND hidden = false
    LIMIT 1
  `)) as unknown as ClusterOwnershipRow[];
  if (!cluster) return null;

  const claims = (await db.execute(sql`
    SELECT dcm.claim_id AS claim_id, rc.claim_text, rc.claim_nature, rc.work_id
    FROM debate_cluster_member dcm
    JOIN research_claim rc ON rc.id = dcm.claim_id
    WHERE dcm.cluster_id = ${clusterId} AND rc.user_id = ${userId} AND rc.work_id IS NOT NULL
    ORDER BY rc.created_at ASC
    LIMIT ${MAX_CLAIMS_PER_EXPANSION}
  `)) as unknown as ExpansionClaimRow[];
  if (claims.length === 0) return { nodes: [], links: [] };

  const claimIds = new Set(claims.map((c) => c.claim_id));

  const relationshipsRaw = (await db.execute(sql`
    SELECT cr.claim_lo_id, cr.claim_hi_id, cr.valence, cr.explanation, cr.category, cr.resolution, cr.engagement
    FROM debate_cluster_relationship dcr
    JOIN claim_relationship cr ON cr.id = dcr.claim_relationship_id
    WHERE dcr.cluster_id = ${clusterId} AND cr.status = 'active' AND cr.hidden = false
  `)) as unknown as ExpansionRelationshipRow[];
  // Both endpoints must be in the (possibly capped) claim set returned
  // above — never show a relationship edge to a claim node this expansion
  // isn't also returning.
  const relationships = relationshipsRaw.filter((r) => claimIds.has(r.claim_lo_id) && claimIds.has(r.claim_hi_id));

  const associatedWorkIdsForClaim = (workId: string) => [`work:${workId}`];

  const claimNodes: GraphNode[] = claims.map((claim) => ({
    id: `claim:${claim.claim_id}`,
    label: truncateLabel(claim.claim_text),
    type: "claim",
    // Same "no acquisition lifecycle applies" reasoning as `debate`/`section`
    // nodes — see `loadDebateGraphAdditions`'s own comment.
    state: "structural",
    uploaded: false,
    associatedWorkIds: associatedWorkIdsForClaim(claim.work_id),
    // No dedicated claim detail route exists yet — never guess one (the
    // contract's own `destination` rule).
    destination: null,
    authors: null,
    year: null,
    url: null,
    claimNature: claim.claim_nature,
    valenceSummary: valenceSummaryFor(claim.claim_id, relationships),
  }));

  const assertsClaimLinks: GraphLink[] = claims.map((claim) => {
    const source = `work:${claim.work_id}`;
    const target = `claim:${claim.claim_id}`;
    return {
      id: `${source}|asserts_claim|${target}`,
      source,
      target,
      edgeType: "asserts_claim",
      directed: true,
      associatedWorkIds: associatedWorkIdsForClaim(claim.work_id),
      category: null,
      confidence: 1,
    };
  });

  const relationshipLinks: GraphLink[] = relationships.map((rel) => {
    const source = `claim:${rel.claim_lo_id}`;
    const target = `claim:${rel.claim_hi_id}`;
    const edgeType = VALENCE_EDGE_TYPE[rel.valence] ?? "claim_nuances";
    return {
      id: `${source}|${edgeType}|${target}`,
      source,
      target,
      edgeType,
      // `claim_contradicts`/`claim_supports`/`claim_nuances` are in
      // `UNDIRECTED_EDGE_TYPES` — `claim_lo_id < claim_hi_id` is a storage
      // order, not an argumentative direction (see that Set's own comment).
      directed: false,
      associatedWorkIds: [
        ...new Set([
          ...associatedWorkIdsForClaim(claims.find((c) => c.claim_id === rel.claim_lo_id)?.work_id ?? ""),
          ...associatedWorkIdsForClaim(claims.find((c) => c.claim_id === rel.claim_hi_id)?.work_id ?? ""),
        ]),
      ].filter((id) => id !== "work:"),
      category: rel.category,
      // `claim_relationship` carries no stored confidence column (unlike
      // retrieval-candidate rows) — a judged, paid relationship is treated
      // as definitively established (confidence 1), the same "computed
      // fact, not a probabilistic score" reasoning `outline_section` edges
      // already use in `graph.ts`.
      confidence: 1,
      explanation: rel.explanation,
      evidence: { source: "claim_relationship", category: rel.category, resolution: rel.resolution, engagement: rel.engagement },
    };
  });

  return { nodes: claimNodes, links: [...assertsClaimLinks, ...relationshipLinks] };
}
