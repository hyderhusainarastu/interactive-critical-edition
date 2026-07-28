/**
 * Maps an already-fetched single-entity API response (one passage/
 * question/claim/debate) to a synthetic root `DisplayNode` for that
 * context (spec §2.2's context-scoped synthesis, scoped down for this
 * step — see `KnowledgeMapWorkspace.tsx`'s own scope note for why these
 * four kinds get a real, single ROOT node rather than a fully-expanded
 * neighborhood: the adapter's own doc comment already defers full §2.2
 * synthesis, and reconstructing e.g. a claim's judged relationships or a
 * project's hypotheses/gaps into a real neighborhood is genuinely more
 * work than this step's URL/workspace/chooser scope covers).
 *
 * Every field here is read verbatim from a real, owner-scoped row this
 * user's own account produced — never fabricated. `destination` only ever
 * points at a route that is CONFIRMED to exist and do something real; where
 * a natural-sounding deep link (e.g. jumping straight to one passage inside
 * the Reader) isn't actually wired up anywhere in the app today, this
 * module deliberately does NOT construct one — charter §12's "never render
 * a button that only pretends to work" applies just as much to a link href
 * as to a button.
 */
import { layerForDisplayKind, toDisplayNodeId } from "@ice/graph-display";
import type { KnowledgeMapDisplayNode } from "./adapter";

export interface ResolvedContextRoot {
  node: KnowledgeMapDisplayNode;
  /** The toolbar/tray's context label. */
  label: string;
  /** The toolbar's secondary breadcrumb line, when the source row has one. */
  breadcrumb: string;
}

export interface PassageRootRow {
  id: string;
  workId: string;
  workTitle: string;
  summary: string;
}

export function passageRoot(row: PassageRootRow): ResolvedContextRoot {
  return {
    node: {
      id: toDisplayNodeId(`passage:${row.id}`),
      displayKind: "passage",
      canonicalNodeId: null,
      sourceEntity: { kind: "passage_annotation", id: row.id },
      layer: layerForDisplayKind("passage"),
      label: row.summary,
      // No query-param-driven passage-anchor deep link exists in the Reader
      // today (confirmed by reading EditionReader.tsx) — link to the real
      // reader route for the owning work, not a fabricated anchor jump.
      destination: `/works/${row.workId}/reader`,
      unavailableReason: null,
      projection: null,
    },
    label: row.summary,
    breadcrumb: row.workTitle,
  };
}

export interface QuestionRootRow {
  id: string;
  title: string;
  summary: string | null;
}

export function questionRoot(row: QuestionRootRow): ResolvedContextRoot {
  return {
    node: {
      id: toDisplayNodeId(`question:${row.id}`),
      displayKind: "question",
      canonicalNodeId: null,
      sourceEntity: { kind: "research_project", id: row.id },
      layer: layerForDisplayKind("question"),
      label: row.title,
      destination: `/research/${row.id}`,
      unavailableReason: null,
      projection: null,
    },
    label: row.title,
    breadcrumb: row.summary ?? "",
  };
}

export interface ClaimRootRow {
  id: string;
  claimText: string;
  workTitle: string | null;
  corpusItemTitle: string | null;
}

export function claimRoot(row: ClaimRootRow): ResolvedContextRoot {
  return {
    node: {
      id: toDisplayNodeId(`claim:${row.id}`),
      displayKind: "claim",
      canonicalNodeId: null,
      sourceEntity: { kind: "research_claim", id: row.id },
      layer: layerForDisplayKind("claim"),
      label: row.claimText,
      destination: `/research/claims/${row.id}`,
      unavailableReason: null,
      projection: null,
    },
    label: row.claimText,
    breadcrumb: row.workTitle ?? row.corpusItemTitle ?? "",
  };
}

export interface DebateRootRow {
  id: string;
  projectId: string;
  name: string;
  researchQuestion: string | null;
}

export function debateRoot(row: DebateRootRow): ResolvedContextRoot {
  return {
    node: {
      id: toDisplayNodeId(`debate:${row.id}`),
      displayKind: "debate",
      canonicalNodeId: null,
      sourceEntity: { kind: "debate_cluster", id: row.id },
      layer: layerForDisplayKind("debate"),
      label: row.name,
      destination: `/research/${row.projectId}/debates/${row.id}`,
      unavailableReason: null,
      projection: null,
    },
    label: row.name,
    breadcrumb: row.researchQuestion ?? "",
  };
}
