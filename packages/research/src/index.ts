export * from "./types";
export * from "./config";
export * from "./crossWork";
export * from "./normalize";
// Relevance is exported BEFORE credibility to mirror the pipeline order: a
// candidate's relevance is settled first, and only accepted candidates are
// ever scored for authority.
export * from "./relevance";
export * from "./workIdentity";
// Phase 20.6: the canonical-identity precedence chain (DOI → ISBN → provider
// id → title/author/year → content hash → fuzzy-suggestion-only) that plans
// duplicate-identity collapse and classifies record-to-work relations.
export * from "./canonicalIdentity";
export * from "./credibility";
// Phase 9.2: creator identity, and credibility as separated dimensions. The
// Phase 8 A–E band above is retained — it still gates factual claims — but the
// reader is shown the dimensions, and popularity is never one of them.
export * from "./creator";
export * from "./credibilityV3";
export * from "./discover";
export * from "./synthesize";
// Phase 9.3: passage-anchored annotations over the PRIMARY text, distinct
// from synthesize.ts's notes about discovered EXTERNAL resources.
export * from "./passageAnnotations";
export * from "./v4Annotations";
// Phase 9.4: real extraction for the v3 "concepts/people/debates" stage,
// feeding the global concept catalog a per-work diagnostic quizzes over.
export * from "./concepts";
// Phase 9.4: the concept-mastery precedence rule (explicit → diagnostic →
// inferred → reader-level fallback), pure and decoupled from the DB layer.
export * from "./mastery";
export * from "./cache";
export * from "./adapters";
export * from "./openAccess";
// Floors-capability-proposal §2.2: pure selection of which accepted
// candidates get a full-inspection slot, decoupled from acceptance itself.
export * from "./selection";
// Floors-capability-proposal §2.3: the citation-resolution → research_resource
// bridge's pure row-construction (no DB), shared with apps/worker's call site.
export * from "./citationBridge";
// Phase 28.2: corpus import (search + direct-by-id lookup + normalization
// into the research_corpus_item insert shape) — network-only, zero AI cost.
export * from "./corpusImport";
// Phase 29.1: scheduled monitoring's pure cadence math (network-only, zero
// AI cost — see runMonitor.ts/repository.ts in apps/worker for the DB glue).
export * from "./monitoring";
