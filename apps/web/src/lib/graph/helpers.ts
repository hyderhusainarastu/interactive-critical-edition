import { sql } from "drizzle-orm";
import type { GraphNode, NodeType } from "@/components/graph/types";

/**
 * The small, DB-free helpers `buildGraph()` (`./build`) uses. Split out of
 * the builder verbatim so the phase pipeline in `./build` reads as the
 * pipeline it already documents itself to be; every function below is byte
 * -for-byte the declaration that previously sat at the top of `graph.ts`
 * (or, for `AUTH_ORDER`/`authorityRank`/`resourceNodeType`/
 * `providerIsPublic`, inside `buildGraph()` itself — they close over
 * nothing, so module scope is the same behaviour).
 */

export const NORM = (c: string) => sql.raw(`regexp_replace(lower(${c}), '[^a-z0-9]', '', 'g')`);

export function displayAuthors(value: unknown): string | null {
  if (Array.isArray(value)) {
    const names = value.filter((name): name is string => typeof name === "string" && Boolean(name.trim()));
    return names.length ? names.join(", ") : null;
  }
  return typeof value === "string" && value.trim() ? value : null;
}

/** Graph P1 (data contract v2): jsonb string array → `string[] | undefined`
 *  (never a fabricated empty array) — used for `concept.aliases`. */
export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  return items.length ? items : undefined;
}

/** Graph P1 (data contract v2): builds a node's `credibility` dossier from a
 *  `credibility_assessment` row's fields, or null when no assessment exists
 *  (`score == null`) — never a fabricated all-null object standing in for
 *  "no data". */
export function credibilityFromAssessment(row: {
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

export const AUTH_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

export const authorityRank = (authority: string | null | undefined) => AUTH_ORDER[authority ?? "E"] ?? 4;

// Shared by both `research_resource` rows and `resource_role`'s durable
// `learning_resource` rows (Phase 21.2/D-21-7) — same heuristic, one place.
export const resourceNodeType = (peerReviewed: boolean | null, resourceType: string): NodeType => {
  if (peerReviewed) return "peer_reviewed_source";
  if (["webpage", "video", "social_post", "dataset"].includes(resourceType)) return "online_source";
  return "reference";
};

export const providerIsPublic = (provider: string) => ["youtube", "mastodon", "bluesky"].includes(provider.toLocaleLowerCase());
