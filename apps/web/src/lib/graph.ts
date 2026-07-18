import { db, readingRecords, understandingRatings } from "@ice/db";
import { KNOWN_THRESHOLD } from "@ice/roadmap";
import { eq, sql } from "drizzle-orm";

/**
 * Builds the per-user knowledge-graph data (plan §9/§16) that feeds both
 * the 3D visualizer and its accessible table fallback. Nodes are the
 * user's own works plus the bibliographic records they reference; links
 * are the analysis `graphEdges`. Every reference node carries a state:
 *   read / reading / unread — from the user's reading record + rating
 *   missing — referenced by the scholarship but NOT in the user's library
 *             (a "missing link", plan §9), i.e. no owned work matches it.
 * Per-user scoped throughout (never another user's works/status), which is
 * what makes the graph "unique to each user" as the brief requires.
 */

export type NodeState = "primary" | "read" | "reading" | "unread" | "missing";

export interface GraphNode {
  id: string;
  label: string;
  type: "work" | "reference";
  state: NodeState;
  authors: string | null;
  year: number | null;
  url: string | null;
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
  stats: { works: number; references: number; missing: number; read: number };
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

const NORM = (c: string) => sql.raw(`regexp_replace(lower(${c}), '[^a-z0-9]', '', 'g')`);

export async function buildGraph(userId: string, rootWorkId?: string): Promise<GraphData> {
  // 1) Work nodes (all the user's, or just the root when work-scoped).
  const works = (await db.execute(sql`
    SELECT id, title FROM work
    WHERE user_id = ${userId}
    ${rootWorkId ? sql`AND id = ${rootWorkId}` : sql``}
  `)) as unknown as WorkRow[];

  if (works.length === 0) {
    return { nodes: [], links: [], stats: { works: 0, references: 0, missing: 0, read: 0 } };
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
              WHERE w.user_id = ${userId} AND ${NORM("w.title")} = ${NORM("br.title")}
            ) AS in_library
          FROM bibliographic_record br
          WHERE br.id IN ${refIds}
        `)) as unknown as RefRow[])
      : [];

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

  const nodes: GraphNode[] = works.map((w) => ({
    id: `work:${w.id}`,
    label: w.title,
    type: "work",
    state: "primary",
    authors: null,
    year: null,
    url: null,
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
    nodes.push({
      id: `bib:${r.id}`,
      label: r.title,
      type: "reference",
      state,
      authors: r.authors,
      year: r.year,
      url: r.url,
    });
  }

  const links: GraphLink[] = edges.map((e) => ({
    source: `work:${e.source_id}`,
    target: `bib:${e.target_id}`,
    edgeType: e.edge_type,
    category: e.category,
    confidence: e.confidence,
  }));

  return {
    nodes,
    links,
    stats: { works: works.length, references: refs.length, missing, read },
  };
}
