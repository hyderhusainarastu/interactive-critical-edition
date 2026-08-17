// Sub-phase 22.9 (plan §3): the Conversational Competency Designation pure
// module — self-report detector, level vocabulary, prompt/schema/validator.
// Kept as a separate file (unlike this file's own Socratic primitives) so
// the two features stay independently reviewable; re-exported here so every
// caller still imports from `@ice/rag`.
export * from "./competency";

// The deterministic lexical-only scorer (`lexicalScore`/`rankLexically`)
// moved to its own module in Phase 29.3 so `hybridRetrieval.ts` can reuse it
// as the flag-off/no-provider fallback without a circular import; still
// re-exported here so every existing caller is unaffected.
export * from "./lexicalRetrieval";

// Phase 29.3 (ScholarLens reverse-direction lane): hybrid dense+BM25
// retrieval, behind `RAG_HYBRID_RETRIEVAL` (default off — see
// `ragHybridRetrievalEnabled`). See `hybridRetrieval.ts` for the full
// rationale; re-exported here for the same reason as above.
export * from "./hybridRetrieval";

// Phase 28.6 (Ask Library research modes): per-mode retrieval over the
// judged claim_relationship/debate_cluster graph, the unified SOURCE_N +
// CLAIM_N label-then-validate pair, and deterministic $0 fallbacks. See
// `researchModes.ts`'s own doc comment for the full rationale.
export * from "./researchModes";

// Chunking, hashing, indexing and owner-scoped retrieval primitives.
export * from "./ragIndexing";

// The Socratic answer-shaping layer: system prompt, prompt construction, and
// the label-then-validate answer validator plus its deterministic fallback.
export * from "./socratic";
