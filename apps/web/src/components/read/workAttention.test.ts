import assert from "node:assert/strict";
import { queueGroupFor, tabDisabledReason } from "./workAttention";

/**
 * Pure-function regression for the shared work-status classification (Stage
 * 4 read spec §2.2/§3.2). No DOM, no DB — run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `apps/web/src/components/graph/roadmapLayout.test.ts`).
 */

// queueGroupFor
assert.equal(queueGroupFor({ status: "needs_review" }), "attention");
assert.equal(queueGroupFor({ status: "failed" }), "attention");
assert.equal(queueGroupFor({ status: "processing", stalled: true }), "attention");
assert.equal(queueGroupFor({ status: "uploaded" }), "in_progress");
assert.equal(queueGroupFor({ status: "processing" }), "in_progress");
assert.equal(queueGroupFor({ status: "processing", stalled: false }), "in_progress");
assert.equal(queueGroupFor({ status: "ready" }), "ready");
// A ready work is never "attention" even if a stale stalled flag lingers —
// stalled only means anything for a still-processing document.
assert.equal(queueGroupFor({ status: "ready", stalled: true }), "ready");

// tabDisabledReason
assert.equal(tabDisabledReason({ status: "ready", deletedAt: null }), null);
assert.equal(
  tabDisabledReason({ status: "ready", deletedAt: new Date().toISOString() }),
  "This work is in Trash — restore it to continue.",
);
assert.equal(tabDisabledReason({ status: "failed", deletedAt: null }), "Unavailable — processing failed.");
for (const status of ["uploaded", "processing", "needs_review"] as const) {
  assert.equal(tabDisabledReason({ status, deletedAt: null }), "Available once processing finishes.");
}
// Trashed always wins over the underlying status, even "ready".
assert.equal(
  tabDisabledReason({ status: "failed", deletedAt: new Date() }),
  "This work is in Trash — restore it to continue.",
);

console.log("workAttention.test.ts: all assertions passed");
