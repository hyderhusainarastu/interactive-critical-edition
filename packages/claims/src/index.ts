/**
 * @ice/claims — pure claim/relationship taxonomy, scoring, retrieval,
 * clustering, novelty, chunk-planning, prompt-building, job-planning, and
 * eval helpers for Palimnote's claim-comparison pipeline (Phase 25,
 * "ScholarLens integration foundations").
 *
 * Zero workspace dependencies, zero runtime dependencies (node:crypto only)
 * — every function here is pure and unit-testable without a DB, network
 * call, or another @ice/* package. See `docs/PROJECT-LOG.md` for how this
 * package's contents relate to the licensed ScholarLens reference project
 * this Phase draws ideas from.
 */

export * from "./taxonomy";
export * from "./thresholds";
export * from "./limits";
export * from "./anchoring";
export * from "./basisHash";

export * from "./scoring/evidenceStrength";
export * from "./scoring/textualSupport";
export * from "./scoring/dimensions";

export * from "./retrieval/cosine";
export * from "./retrieval/bm25";
export * from "./retrieval/locus";
export * from "./retrieval/union";

export * from "./clustering";
export * from "./novelty";
export * from "./mapReduce";
export * from "./hypothesisRunHash";

export * from "./prompts/claimExtraction";
export * from "./prompts/judge";
export * from "./prompts/clusterNaming";
export * from "./prompts/evidenceChamber";
export * from "./prompts/hypothesis";
export * from "./prompts/researchGap";

export * from "./jobs/planResearchJob";
export * from "./jobs/scope";

export * from "./eval/metrics";
export * from "./eval/split";
export * from "./eval/gates";
export * from "./eval/goldSchema";
