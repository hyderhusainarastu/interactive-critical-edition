export * from "./types";
export * from "./config";
export * from "./normalize";
// Relevance is exported BEFORE credibility to mirror the pipeline order: a
// candidate's relevance is settled first, and only accepted candidates are
// ever scored for authority.
export * from "./relevance";
export * from "./workIdentity";
export * from "./credibility";
// Phase 9.2: creator identity, and credibility as separated dimensions. The
// Phase 8 A–E band above is retained — it still gates factual claims — but the
// reader is shown the dimensions, and popularity is never one of them.
export * from "./creator";
export * from "./credibilityV3";
export * from "./discover";
export * from "./synthesize";
export * from "./cache";
export * from "./adapters";
