/**
 * Shared, pure work-status classification for the Read workspace (Stage 4
 * spec §2.2/§3.2/§3.3). Three surfaces need to agree on the same "what does
 * this status mean for the reader right now" facts — the Reading Queue's
 * attention-first grouping, the work context header's disabled-tab
 * explanations, and the reader page's own direct-URL defensive guard — so
 * the classification lives here once instead of three independently
 * hand-rolled copies that could quietly drift apart.
 */

export type WorkProcessingStatus = "uploaded" | "processing" | "needs_review" | "ready" | "failed";

export type WorkQueueGroup = "attention" | "in_progress" | "ready";

/**
 * Reading Queue grouping (spec §2.2): "Needs your attention" covers
 * needs_review, failed, and a stalled processing run (computed the same way
 * `WorkStatusPanel`'s own `stalled` flag already is — see
 * `apps/web/src/app/(app)/works/page.tsx`'s server-side computation, which
 * mirrors `/api/works/[workId]/status/route.ts` rather than importing it,
 * since that route isn't in this lane's file ownership).
 */
export function queueGroupFor(input: { status: WorkProcessingStatus; stalled?: boolean }): WorkQueueGroup {
  if (input.status === "needs_review" || input.status === "failed") return "attention";
  // Stalled only means anything for a still-processing document — mirrors
  // `WorkStatusPanel`'s own `stalled` semantics (set only when
  // `status === "processing"`), so a stray truthy flag on any other status
  // can never misclassify it.
  if (input.status === "processing" && input.stalled) return "attention";
  if (input.status === "ready") return "ready";
  return "in_progress";
}

/**
 * The work context header's disabled-tab explanation (spec §3.2: "an inline
 * reason drawn from the work's actual status"), reused verbatim by the
 * Reading Queue's per-row "what to do" affordance and the reader page's own
 * not-ready guard (spec §3.3) so a direct URL visit is at least as
 * informative as clicking the disabled tab would have been. Returns `null`
 * when the work is fully reachable (ready, not trashed) — nothing to
 * explain.
 */
export function tabDisabledReason(input: {
  status: WorkProcessingStatus;
  deletedAt: string | Date | null;
}): string | null {
  if (input.deletedAt) return "This work is in Trash — restore it to continue.";
  if (input.status === "failed") return "Unavailable — processing failed.";
  if (input.status === "uploaded" || input.status === "processing" || input.status === "needs_review") {
    return "Available once processing finishes.";
  }
  return null;
}
