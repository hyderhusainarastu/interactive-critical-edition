import { conceptMastery, db, readingRecords, understandingRatings, workRelationshipJudgments } from "@ice/db";
import { KNOWN_THRESHOLD } from "@ice/roadmap";
import { and, eq, inArray, sql } from "drizzle-orm";

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
 */

export type NodeState = "primary" | "read" | "reading" | "unread" | "missing" | "structural";
export type NodeType = "work" | "reference" | "peer_reviewed_source" | "online_source" | "concept" | "person" | "section";

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  state: NodeState;
  authors: string | null;
  year: number | null;
  url: string | null;
  /** Best source authority (A–E) and discovering provider from v2 research,
   *  when this reference was surfaced by the edition pipeline; null for legacy. */
  authority: string | null;
  credibilityScore: number | null;
  provider: string | null;
  providers?: string[];
  /** `concept_kind` (concept/doctrine/person/tradition/debate) for concept
   *  nodes; null for every other node type. */
  kind: string | null;
  /** External-source access is deliberately distinct from node read state. */
  accessStatus?: string | null;
  sourceTextStatus?: string | null;
  license?: string | null;
  sourceUrl?: string | null;
  provenance?: { runId: string; provider: string; inspectedAt: string | null; inspectionDepth: number } | null;
  provenances?: { runId: string; provider: string; inspectedAt: string | null; inspectionDepth: number }[];
  supplementary?: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  edgeType: string;
  category: string | null;
  confidence: number;
  /** Cross-library judgement explanation and grounded claim anchors, when present. */
  explanation?: string | null;
  evidence?: unknown;
  provenance?: { relationId: string; runId: string; depth: number } | null;
  evidences?: unknown[];
  provenances?: { relationId: string; runId: string; depth: number }[];
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Counts for the legend / summary. */
  stats: { works: number; references: number; sources: number; concepts: number; people: number; missing: number; read: number };
}

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

const NORM = (c: string) => sql.raw(`regexp_replace(lower(${c}), '[^a-z0-9]', '', 'g')`);

function displayAuthors(value: unknown): string | null {
  if (Array.isArray(value)) {
    const names = value.filter((name): name is string => typeof name === "string" && Boolean(name.trim()));
    return names.length ? names.join(", ") : null;
  }
  return typeof value === "string" && value.trim() ? value : null;
}

export async function buildGraph(userId: string, rootWorkId?: string): Promise<GraphData> {
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

  // 3b) v2 research enrichment: best authority + discovering provider per bib.
  const enrichRows =
    refIds.length > 0
      ? ((await db.execute(sql`
          SELECT rr.bib_record_id AS bib_id, ca.authority, ca.score, rr.provider
          FROM research_resource rr
          LEFT JOIN credibility_assessment ca ON ca.resource_id = rr.id
          WHERE rr.bib_record_id IN ${refIds}
        `)) as unknown as { bib_id: string; authority: string | null; score: number | null; provider: string | null }[])
      : [];
  const AUTH_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  const enrichByBib = new Map<string, { authority: string | null; credibilityScore: number | null; provider: string | null }>();
  for (const row of enrichRows) {
    if (!row.bib_id) continue;
    const prior = enrichByBib.get(row.bib_id);
    const better = !prior || (AUTH_ORDER[row.authority ?? "E"] ?? 4) < (AUTH_ORDER[prior.authority ?? "E"] ?? 4);
    if (better) enrichByBib.set(row.bib_id, { authority: row.authority, credibilityScore: row.score, provider: row.provider });
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
      rr.year, rr.url, rr.resource_type, rr.provider, rr.access_status,
      ca.authority, ca.score, ca.peer_reviewed,
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
  const nodeById = new Map<string, GraphNode>();
  const addNode = (node: GraphNode) => nodeById.set(node.id, node);
  for (const w of works) addNode({
    id: `work:${w.id}`, label: w.title, type: "work", state: "primary",
    authors: null, year: null, url: null, authority: null, credibilityScore: null, provider: null, kind: null,
  });

  const authorityRank = (authority: string | null | undefined) => AUTH_ORDER[authority ?? "E"] ?? 4;
  const sourceTypeFor = (source: SourceRow): NodeType => {
    if (source.peer_reviewed) return "peer_reviewed_source";
    if (["webpage", "video", "social_post", "dataset"].includes(source.resource_type)) return "online_source";
    return "reference";
  };
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

  const mergeExternal = (id: string, incoming: GraphNode, isPublic: boolean) => {
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
    mergeExternal(bibNodeId, {
      id: bibNodeId, label: r.title, type: "reference", state,
      authors: r.authors, year: r.year, url: r.url,
      authority: enrich?.authority ?? null, credibilityScore: enrich?.credibilityScore ?? null,
      provider: enrich?.provider ?? null, kind: null,
    }, false);
  }

  for (const source of sourceRows) {
    const id = canonicalExternalId(source);
    sourceNodeIds.set(source.id, id);
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

  for (const c of conceptRows) {
    const score = masteryByConcept.get(c.id) ?? 0;
    addNode({
      id: `concept:${c.id}`, label: c.label, type: c.kind === "person" ? "person" : "concept",
      state: score >= KNOWN_THRESHOLD ? "read" : "unread", authors: null, year: null, url: null,
      authority: null, credibilityScore: null, provider: null, kind: c.kind,
    });
  }
  for (const s of sectionRows) addNode({
    id: `section:${s.id}`, label: s.text.length > 120 ? `${s.text.slice(0, 117)}...` : s.text,
    type: "section", state: "structural", authors: null, year: null, url: null,
    authority: null, credibilityScore: null, provider: null, kind: s.kind,
  });

  const directRelationBySource = new Map<string, ResourceRelationRow>();
  for (const relation of resourceRelations) {
    if (relation.resource_id && !relation.related_resource_id && sourceIds.has(relation.resource_id) && !directRelationBySource.has(relation.resource_id)) {
      directRelationBySource.set(relation.resource_id, relation);
    }
  }

  const links: GraphLink[] = [
    ...edges.map((e) => ({
      source: `work:${e.source_id}`,
      target: canonicalNodeId(`external:bib:${e.target_id}`),
      edgeType: e.edge_type,
      category: e.category,
      confidence: e.confidence,
    })),
    ...conceptEdges.map((e) => ({
      source: `work:${e.source_id}`,
      target: `concept:${e.target_id}`,
      edgeType: e.edge_type,
      category: e.category,
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
  const linkByIdentity = new Map<string, GraphLink>();
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
  const visualNodes = [...nodeById.values()].filter((node) => connectedIds.has(node.id));
  const visualIds = new Set(visualNodes.map((node) => node.id));
  const visualLinks = deduplicatedLinks.filter((link) => visualIds.has(link.source) && visualIds.has(link.target));
  const count = (predicate: (node: GraphNode) => boolean) => visualNodes.filter(predicate).length;

  return {
    nodes: visualNodes,
    links: visualLinks,
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
