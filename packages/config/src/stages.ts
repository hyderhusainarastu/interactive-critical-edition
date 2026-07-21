/**
 * Ordered, real stage sequences for the edition pipeline — the single
 * source of truth for the honest step-by-step processing indicator (plan
 * §36 11.3), shared between the worker (which sets these exact labels on
 * `processing_run.stage`, see `apps/worker/src/analyze.ts`/`runLifecycle.ts`)
 * and the web UI (which renders them, `WorkStatusPanel.tsx`). Neither
 * pipeline is credited with a stage it doesn't actually set — v1 has no
 * entry at all, since `isEditionPipeline()` never runs the edition
 * pipeline for it (no `processing_run` row exists to track).
 */

export const V2_STAGE_SEQUENCE = [
  "extracting",
  "research-discovery",
  "relevance-gate",
  "classification",
  "validation",
] as const;
export type V2Stage = (typeof V2_STAGE_SEQUENCE)[number];

export const V3_STAGE_SEQUENCE = [
  "canonical-identity",
  "structural-outline",
  "section-passage-anchors",
  "explicit-citations",
  "concepts-people-debates",
  "lane-discovery",
  "relevance-gate",
  "creator-verification",
  "citation-graph-expansion",
  "credibility",
  "claims",
  "conservative-influence-classification",
] as const;
export type V3Stage = (typeof V3_STAGE_SEQUENCE)[number];

export const STAGE_LABEL: Record<V2Stage | V3Stage, string> = {
  extracting: "Extracting text and metadata",
  "research-discovery": "Discovering related sources",
  "relevance-gate": "Checking source relevance",
  classification: "Classifying relationships",
  validation: "Finalizing edition",
  "canonical-identity": "Resolving canonical work identity",
  "structural-outline": "Building structural outline",
  "section-passage-anchors": "Anchoring passage annotations",
  "explicit-citations": "Extracting explicit citations",
  "concepts-people-debates": "Extracting concepts, people, and debates",
  "lane-discovery": "Discovering sources across every lane",
  "creator-verification": "Verifying source creators",
  "citation-graph-expansion": "Expanding the citation graph",
  credibility: "Assessing source credibility",
  claims: "Extracting claims and evidence",
  "conservative-influence-classification": "Classifying relationships conservatively",
};

/** Stage sequence for a given pipeline version. v1 has no stages to show — see the file header. */
export function stageSequenceForPipeline(pipelineVersion: string): readonly string[] {
  return pipelineVersion === "v3" ? V3_STAGE_SEQUENCE : V2_STAGE_SEQUENCE;
}
