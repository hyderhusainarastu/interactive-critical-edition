import { describe, expect, it } from "vitest";
import { queueGroupFor, tabDisabledReason } from "./workAttention";

/**
 * Pure-function regression for the shared work-status classification (Stage
 * 4 read spec §2.2/§3.2). No DOM, no DB — run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `apps/web/src/components/graph/roadmapLayout.test.ts`).
 */

// queueGroupFor
describe("queueGroupFor", () => {
  it("groups needs_review, failed, and stalled processing as \"attention\"", () => {
    expect(queueGroupFor({ status: "needs_review" })).toBe("attention");
    expect(queueGroupFor({ status: "failed" })).toBe("attention");
    expect(queueGroupFor({ status: "processing", stalled: true })).toBe("attention");
  });

  it("groups uploaded and (non-stalled) processing as \"in_progress\"", () => {
    expect(queueGroupFor({ status: "uploaded" })).toBe("in_progress");
    expect(queueGroupFor({ status: "processing" })).toBe("in_progress");
    expect(queueGroupFor({ status: "processing", stalled: false })).toBe("in_progress");
  });

  it("groups ready as \"ready\"", () => {
    expect(queueGroupFor({ status: "ready" })).toBe("ready");
  });

  // A ready work is never "attention" even if a stale stalled flag lingers —
  // stalled only means anything for a still-processing document.
  it("a ready work is never \"attention\" even if a stale stalled flag lingers", () => {
    expect(queueGroupFor({ status: "ready", stalled: true })).toBe("ready");
  });
});

// tabDisabledReason
describe("tabDisabledReason", () => {
  it("a ready, untrashed work has no disabled reason", () => {
    expect(tabDisabledReason({ status: "ready", deletedAt: null })).toBe(null);
  });

  it("a trashed work reports the restore-it reason", () => {
    expect(tabDisabledReason({ status: "ready", deletedAt: new Date().toISOString() })).toBe(
      "This work is in Trash — restore it to continue.",
    );
  });

  it("a failed work reports the processing-failed reason", () => {
    expect(tabDisabledReason({ status: "failed", deletedAt: null })).toBe("Unavailable — processing failed.");
  });

  it("an in-flight work reports the available-once-processing-finishes reason", () => {
    for (const status of ["uploaded", "processing", "needs_review"] as const) {
      expect(tabDisabledReason({ status, deletedAt: null })).toBe("Available once processing finishes.");
    }
  });

  // Trashed always wins over the underlying status, even "ready".
  it("trashed always wins over the underlying status, even \"ready\"", () => {
    expect(tabDisabledReason({ status: "failed", deletedAt: new Date() })).toBe(
      "This work is in Trash — restore it to continue.",
    );
  });
});
