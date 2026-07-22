import { planReprocess, type PendingExtractJob } from "@ice/db";
import { describe, expect, it } from "vitest";

/**
 * Phase 20.5: the single idempotent reprocess command's pure decision core.
 * Every branch of `planReprocess` — duplicate-request protection, stale-
 * active-job recovery, live-run conflict, and the explicit allowed source
 * statuses — with fixed clocks, no DB.
 */

const NOW = new Date("2026-07-22T12:00:00Z");
const STALE_MS = 10 * 60_000;
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const plan = (input: {
  documentStatus?: "uploaded" | "processing" | "needs_review" | "ready" | "failed";
  pendingJobs?: PendingExtractJob[];
  latestRun?: { status: string; updatedAt: Date } | null;
}) =>
  planReprocess({
    documentStatus: input.documentStatus ?? "ready",
    pendingJobs: input.pendingJobs ?? [],
    latestRun: input.latestRun ?? null,
    now: NOW,
    staleAfterMs: STALE_MS,
  });

describe("planReprocess — duplicate-request protection", () => {
  it("reuses an already-queued (created) job instead of enqueueing a duplicate", () => {
    expect(plan({ pendingJobs: [{ id: "j1", state: "created", startedOn: null }] })).toEqual({ action: "reuse", jobId: "j1" });
  });

  it("reuses a retry-state job the same way", () => {
    expect(plan({ pendingJobs: [{ id: "j2", state: "retry", startedOn: null }] })).toEqual({ action: "reuse", jobId: "j2" });
  });

  it("prefers reusing a queued job over recovering a stale active one", () => {
    const result = plan({
      pendingJobs: [
        { id: "stale", state: "active", startedOn: minutesAgo(30) },
        { id: "fresh", state: "created", startedOn: null },
      ],
    });
    expect(result).toEqual({ action: "reuse", jobId: "fresh" });
  });
});

describe("planReprocess — live attempts are never duplicated", () => {
  it("conflicts on a recently started active job", () => {
    expect(plan({ documentStatus: "processing", pendingJobs: [{ id: "j", state: "active", startedOn: minutesAgo(2) }] })).toMatchObject({ action: "conflict" });
  });

  it("conflicts on an old active job whose run heartbeat is still fresh (long research stage, worker alive)", () => {
    const result = plan({
      documentStatus: "processing",
      pendingJobs: [{ id: "j", state: "active", startedOn: minutesAgo(45) }],
      latestRun: { status: "running", updatedAt: minutesAgo(1) },
    });
    expect(result).toMatchObject({ action: "conflict" });
  });

  it("conflicts on a processing document with a fresh running run even when the queue row is missing", () => {
    const result = plan({
      documentStatus: "processing",
      pendingJobs: [],
      latestRun: { status: "running", updatedAt: minutesAgo(1) },
    });
    expect(result).toMatchObject({ action: "conflict" });
  });
});

describe("planReprocess — stale-active-job recovery", () => {
  it("recovers an old active job with no run at all (crashed before allocation)", () => {
    expect(plan({ pendingJobs: [{ id: "dead", state: "active", startedOn: minutesAgo(30) }], latestRun: null })).toEqual({ action: "recover", staleJobId: "dead" });
  });

  it("recovers an old active job whose running run stopped heartbeating", () => {
    const result = plan({
      documentStatus: "processing",
      pendingJobs: [{ id: "dead", state: "active", startedOn: minutesAgo(30) }],
      latestRun: { status: "running", updatedAt: minutesAgo(25) },
    });
    expect(result).toEqual({ action: "recover", staleJobId: "dead" });
  });

  it("recovers an old active job whose latest run already failed", () => {
    const result = plan({
      documentStatus: "processing",
      pendingJobs: [{ id: "dead", state: "active", startedOn: minutesAgo(30) }],
      latestRun: { status: "failed", updatedAt: minutesAgo(25) },
    });
    expect(result).toEqual({ action: "recover", staleJobId: "dead" });
  });

  it("treats a null startedOn on an active row as stale rather than un-recoverable", () => {
    expect(plan({ pendingJobs: [{ id: "odd", state: "active", startedOn: null }], latestRun: null })).toEqual({ action: "recover", staleJobId: "odd" });
  });
});

describe("planReprocess — explicit allowed source statuses", () => {
  it.each(["ready", "needs_review", "failed", "uploaded"] as const)("enqueues from %s when nothing is pending", (documentStatus) => {
    expect(plan({ documentStatus })).toEqual({ action: "enqueue" });
  });

  it("enqueues from processing when the run is stale (job vanished: expired or swept)", () => {
    expect(plan({ documentStatus: "processing", latestRun: { status: "running", updatedAt: minutesAgo(25) } })).toEqual({ action: "enqueue" });
  });

  it("enqueues from processing when the latest run already failed", () => {
    expect(plan({ documentStatus: "processing", latestRun: { status: "failed", updatedAt: minutesAgo(1) } })).toEqual({ action: "enqueue" });
  });

  it("enqueues from processing with no run and no job (stuck with nothing behind it)", () => {
    expect(plan({ documentStatus: "processing", latestRun: null })).toEqual({ action: "enqueue" });
  });
});
