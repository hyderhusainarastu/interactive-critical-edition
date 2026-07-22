/**
 * Phase 20.7 — Reference and mismatch repair (plan §20.7). Public surface of
 * the pure `@ice/consistency` package: every individual check plus one
 * aggregator that runs them all against one already-fetched snapshot and
 * returns a single `ConsistencyReport`. No DB, no I/O — the worker-side
 * runner (`apps/worker/src/consistency/run.ts`) owns fetching the snapshot
 * and applying the resulting repairs transactionally.
 */

export * from "./types";
export * from "./snapshot";
export * from "./normalize";
export * from "./mergeChain";

export { checkCitationLibraryItem } from "./checks/citationLibraryItem";
export { checkLibraryItemCanonicalWork } from "./checks/libraryItemCanonicalWork";
export { checkGraphNodeCanonicalEntity } from "./checks/graphNodeCanonicalEntity";
export { checkGraphEdgeEndpoints } from "./checks/graphEdgeEndpoints";
export { checkAnnotationRelatedWork } from "./checks/annotationRelatedWork";
export { checkRoadmapItemTarget } from "./checks/roadmapItemTarget";
export { checkReaderSourceCitation } from "./checks/readerSourceCitation";
export { checkRagCitationAnchor } from "./checks/ragCitationAnchor";
export { checkTitleAuthorYearAgreement } from "./checks/titleAuthorYearAgreement";

import { checkAnnotationRelatedWork } from "./checks/annotationRelatedWork";
import { checkCitationLibraryItem } from "./checks/citationLibraryItem";
import { checkGraphEdgeEndpoints } from "./checks/graphEdgeEndpoints";
import { checkGraphNodeCanonicalEntity } from "./checks/graphNodeCanonicalEntity";
import { checkLibraryItemCanonicalWork } from "./checks/libraryItemCanonicalWork";
import { checkRagCitationAnchor } from "./checks/ragCitationAnchor";
import { checkReaderSourceCitation } from "./checks/readerSourceCitation";
import { checkRoadmapItemTarget } from "./checks/roadmapItemTarget";
import { checkTitleAuthorYearAgreement } from "./checks/titleAuthorYearAgreement";
import type { ConsistencySnapshot } from "./snapshot";
import { toReport, type ConsistencyMismatch, type ConsistencyReport } from "./types";

/** Every check, in the same fixed order as plan §20.7's own bullet list —
 *  kept as one ordered array so the worker runner and tests iterate the
 *  identical set instead of two hand-kept lists that could drift apart. */
export const ALL_CHECKS: ReadonlyArray<(snapshot: ConsistencySnapshot) => ConsistencyMismatch[]> = [
  checkCitationLibraryItem,
  checkLibraryItemCanonicalWork,
  checkGraphNodeCanonicalEntity,
  checkGraphEdgeEndpoints,
  checkAnnotationRelatedWork,
  checkRoadmapItemTarget,
  checkReaderSourceCitation,
  checkRagCitationAnchor,
  checkTitleAuthorYearAgreement,
];

/** Runs every check against one snapshot and returns one combined report.
 *  Pure — safe to call in report mode with no side effects, and this exact
 *  function is also what the repair-mode runner calls before applying
 *  anything, so "what would be reported" and "what repair mode acts on" can
 *  never silently diverge into two different code paths. */
export function runAllConsistencyChecks(snapshot: ConsistencySnapshot): ConsistencyReport {
  const mismatches: ConsistencyMismatch[] = [];
  for (const check of ALL_CHECKS) mismatches.push(...check(snapshot));
  return toReport(mismatches);
}
