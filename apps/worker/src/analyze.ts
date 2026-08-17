/**
 * Scholarly-analysis pipeline (plan §10–§12), the two-stage design:
 *   Stage 1 (cheap, deterministic, no AI): extract candidate citations
 *     from the text and resolve each against real bibliographic sources.
 *   Stage 2 (expensive): classify each candidate's relationship to the
 *     primary work into one of the 10 categories, with a real model when
 *     a key is configured, else the deterministic heuristic fallback.
 *
 * Every annotation is written with full provenance (model, prompt
 * version, extracted source text, confidence) and starts `unreviewed` so
 * the user can approve/reject/edit/hide it (plan §12). Re-running is
 * idempotent: prior *system* annotations/citations/edges for the
 * document are cleared first, but user-created annotations are preserved.
 */

export { analyzeEditionRun } from "./analyze/analyzeEditionRun";
export { analyzeWork } from "./analyze/analyzeWork";
export { applyClassicalCitationResolution } from "./analyze/classicalCitations";
export {
  createCitationLibraryProjection,
  ensureCitationRole,
} from "./analyze/citationRole";
export { linkCitationsToRunDiscoveries } from "./analyze/linkCitationsToRunDiscoveries";
export { resolveCitationMetadata } from "./analyze/resolveCitationMetadata";
export { findOrCreateWorkIdentity } from "./analyze/workIdentity";
