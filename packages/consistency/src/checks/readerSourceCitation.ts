import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

/**
 * Check 7 — Reader source citation (plan §20.7 bullet 7).
 *
 * A citation's real location is fully derivable through its
 * `text_block_id` → `text_block.page_id` → `page.run_id` chain. Two
 * disagreements are possible without the FK itself breaking (the FK is
 * `ON DELETE SET NULL`, so a stale value can still point at a real row that
 * simply belongs to the wrong run):
 *
 *  - `citation.processing_run_id` is null even though the text block chain
 *    resolves to a real run — a derivable, not guessed, backfill;
 *  - `citation.processing_run_id` disagrees with the run the citation's own
 *    `text_block_id` actually belongs to (can happen if a citation row
 *    persists across a reprocess that assigned it a new block from a
 *    different run without updating the denormalized run id) — repaired by
 *    trusting the FK chain, since that is the one relationship the database
 *    itself still enforces.
 */
export function checkReaderSourceCitation(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];
  const pageByTextBlock = new Map(snapshot.textBlocks.map((tb) => [tb.id, tb.pageId]));
  const runByPage = new Map(snapshot.pages.map((p) => [p.id, p.runId]));

  for (const citation of snapshot.citations) {
    if (!citation.textBlockId) continue;
    const pageId = pageByTextBlock.get(citation.textBlockId);
    if (!pageId) {
      // ON DELETE SET NULL means this should be unreachable in practice.
      mismatches.push({
        checkId: "reader-source-citation",
        entityType: "citation",
        entityId: citation.id,
        description: "citation.text_block_id references a text_block row that no longer exists.",
        severity: "critical",
        evidence: { textBlockId: citation.textBlockId },
        repair: null,
      });
      continue;
    }
    const resolvedRunId = runByPage.get(pageId);
    if (!resolvedRunId) {
      mismatches.push({
        checkId: "reader-source-citation",
        entityType: "citation",
        entityId: citation.id,
        description: "citation's text_block resolves to a page whose processing_run no longer exists.",
        severity: "critical",
        evidence: { textBlockId: citation.textBlockId, pageId },
        repair: null,
      });
      continue;
    }
    if (citation.processingRunId !== resolvedRunId) {
      mismatches.push({
        checkId: "reader-source-citation",
        entityType: "citation",
        entityId: citation.id,
        description: citation.processingRunId
          ? "citation.processing_run_id disagrees with the run its own text_block_id actually belongs to."
          : "citation.processing_run_id is unset even though its text_block_id resolves to a real run.",
        severity: "warning",
        evidence: { recordedRunId: citation.processingRunId, resolvedRunId },
        repair: {
          kind: "update",
          table: "citation",
          id: citation.id,
          patch: { processingRunId: resolvedRunId },
          reason: `text_block ${citation.textBlockId} → page ${pageId} → processing_run ${resolvedRunId} is the citation's own real FK chain.`,
        },
      });
    }
  }

  return mismatches;
}
