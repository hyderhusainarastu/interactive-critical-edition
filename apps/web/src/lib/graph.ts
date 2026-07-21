import { conceptMastery, db, readingRecords, understandingRatings } from "@ice/db";
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
export type NodeType = "work" | "reference" | "concept" | "section";

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
  /** `concept_kind` (concept/doctrine/person/tradition/debate) for concept
   *  nodes; null for every other node type. */
  kind: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  edgeType: string;
  category: string | null;
  confidence: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Counts for the legend / summary. */
  stats: { works: number; references: number; concepts: number; missing: number; read: number };
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

const NORM = (c: string) => sql.raw(`regexp_replace(lower(${c}), '[^a-z0-9]', '', 'g')`);

export async function buildGraph(userId: string, rootWorkId?: string): Promise<GraphData> {
  // 1) Work nodes (all the user's, or just the root when work-scoped).
  // Trashed works (plan §34.4 9.7) are excluded — same as gone until restored.
  const works = (await db.execute(sql`
    SELECT id, title FROM work
    WHERE user_id = ${userId} AND deleted_at IS NULL
    ${rootWorkId ? sql`AND id = ${rootWorkId}` : sql``}
  `)) as unknown as WorkRow[];

  if (works.length === 0) {
    return { nodes: [], links: [], stats: { works: 0, references: 0, concepts: 0, missing: 0, read: 0 } };
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

  const nodes: GraphNode[] = works.map((w) => ({
    id: `work:${w.id}`,
    label: w.title,
    type: "work",
    state: "primary",
    authors: null,
    year: null,
    url: null,
    authority: null,
    credibilityScore: null,
    provider: null,
    kind: null,
  }));

  let missing = 0;
  let read = 0;
  for (const r of refs) {
    const status = statusByBib.get(r.id);
    const score = scoreByBib.get(r.id) ?? 0;
    let state: NodeState;
    if (status === "completed" || score >= KNOWN_THRESHOLD) {
      state = "read";
      read++;
    } else if (status === "reading") {
      state = "reading";
    } else if (!r.in_library) {
      state = "missing";
      missing++;
    } else {
      state = "unread";
    }
    const enrich = enrichByBib.get(r.id);
    nodes.push({
      id: `bib:${r.id}`,
      label: r.title,
      type: "reference",
      state,
      authors: r.authors,
      year: r.year,
      url: r.url,
      authority: enrich?.authority ?? null,
      credibilityScore: enrich?.credibilityScore ?? null,
      provider: enrich?.provider ?? null,
      kind: null,
    });
  }

  for (const c of conceptRows) {
    const score = masteryByConcept.get(c.id) ?? 0;
    const state: NodeState = score >= KNOWN_THRESHOLD ? "read" : "unread";
    if (state === "read") read++;
    nodes.push({
      id: `concept:${c.id}`,
      label: c.label,
      type: "concept",
      state,
      authors: null,
      year: null,
      url: null,
      authority: null,
      credibilityScore: null,
      provider: null,
      kind: c.kind,
    });
  }

  for (const s of sectionRows) {
    nodes.push({
      id: `section:${s.id}`,
      // text_block.text for a title/header is the heading text itself —
      // truncate defensively in case a heading-kind block is unusually long.
      label: s.text.length > 120 ? `${s.text.slice(0, 117)}...` : s.text,
      type: "section",
      state: "structural",
      authors: null,
      year: null,
      url: null,
      authority: null,
      credibilityScore: null,
      provider: null,
      kind: s.kind,
    });
  }

  const links: GraphLink[] = [
    ...edges.map((e) => ({
      source: `work:${e.source_id}`,
      target: `bib:${e.target_id}`,
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
  ];

  return {
    nodes,
    links,
    stats: { works: works.length, references: refs.length, concepts: conceptRows.length, missing, read },
  };
}
