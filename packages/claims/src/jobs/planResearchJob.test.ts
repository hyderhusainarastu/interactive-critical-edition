import { describe, expect, it } from "vitest";
import {
  computeIdempotencyKey,
  planResearchJob,
  type ExistingResearchRequest,
  type ResearchJobVersions,
} from "./planResearchJob";

const VERSIONS: ResearchJobVersions = { taxonomyVersion: "c1", promptVersion: "p1" };

describe("computeIdempotencyKey", () => {
  it("is stable regardless of workIds order", () => {
    const a = computeIdempotencyKey("claim_extraction", { workIds: ["w1", "w2"] }, VERSIONS);
    const b = computeIdempotencyKey("claim_extraction", { workIds: ["w2", "w1"] }, VERSIONS);
    expect(a).toBe(b);
  });

  it("differs for a different jobType with the same scope", () => {
    const a = computeIdempotencyKey("claim_extraction", { workIds: ["w1"] }, VERSIONS);
    const b = computeIdempotencyKey("judge_scan", { workIds: ["w1"] }, VERSIONS);
    expect(a).not.toBe(b);
  });

  it("differs when the taxonomy/prompt version changes", () => {
    const a = computeIdempotencyKey("claim_extraction", { workIds: ["w1"] }, VERSIONS);
    const b = computeIdempotencyKey("claim_extraction", { workIds: ["w1"] }, { ...VERSIONS, promptVersion: "p2" });
    expect(a).not.toBe(b);
  });

  it("differs for a different detail scope", () => {
    const a = computeIdempotencyKey("judge_scan", { workIds: ["w1"], detail: "cluster-a" }, VERSIONS);
    const b = computeIdempotencyKey("judge_scan", { workIds: ["w1"], detail: "cluster-b" }, VERSIONS);
    expect(a).not.toBe(b);
  });
});

describe("planResearchJob", () => {
  it("enqueues a fresh request with no existing requests and a small estimate", () => {
    const plan = planResearchJob({
      jobType: "claim_extraction",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [],
      estimatedUnits: 5,
    });
    expect(plan.action).toBe("enqueue");
  });

  it("reuses an identical pending request instead of enqueueing a duplicate", () => {
    const key = computeIdempotencyKey("claim_extraction", { workIds: ["w1"] }, VERSIONS);
    const existing: ExistingResearchRequest = {
      id: "req-1",
      jobType: "claim_extraction",
      idempotencyKey: key,
      status: "created",
      requestedAt: new Date(),
    };
    const plan = planResearchJob({
      jobType: "claim_extraction",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [existing],
    });
    expect(plan).toEqual({ action: "reuse", idempotencyKey: key, reusedRequestId: "req-1" });
  });

  it("reuses an ACTIVE identical request too, not only 'created'", () => {
    const key = computeIdempotencyKey("judge_scan", { workIds: ["w1"] }, VERSIONS);
    const existing: ExistingResearchRequest = {
      id: "req-2",
      jobType: "judge_scan",
      idempotencyKey: key,
      status: "active",
      requestedAt: new Date(),
    };
    const plan = planResearchJob({
      jobType: "judge_scan",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [existing],
    });
    expect(plan.action).toBe("reuse");
  });

  it("conflicts when a DIFFERENT active request of the same job type exists", () => {
    const existing: ExistingResearchRequest = {
      id: "req-3",
      jobType: "judge_scan",
      idempotencyKey: "some-other-key",
      status: "active",
      requestedAt: new Date(),
    };
    const plan = planResearchJob({
      jobType: "judge_scan",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [existing],
    });
    expect(plan.action).toBe("conflict");
  });

  it("does not conflict with a COMPLETED or FAILED request of the same type", () => {
    const existing: ExistingResearchRequest = {
      id: "req-4",
      jobType: "judge_scan",
      idempotencyKey: "some-other-key",
      status: "completed",
      requestedAt: new Date(),
    };
    const plan = planResearchJob({
      jobType: "judge_scan",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [existing],
      estimatedUnits: 1,
    });
    expect(plan.action).toBe("enqueue");
  });

  it("auto-enqueues at or below the default auto-approve cap (20 units)", () => {
    const plan = planResearchJob({
      jobType: "claim_extraction",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [],
      estimatedUnits: 20,
    });
    expect(plan.action).toBe("enqueue");
  });

  it("needs_confirmation just above the auto-approve cap", () => {
    const plan = planResearchJob({
      jobType: "claim_extraction",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [],
      estimatedUnits: 21,
    });
    expect(plan.action).toBe("needs_confirmation");
  });

  it("conflicts (hard stop) above hardStopMaxUnits", () => {
    const plan = planResearchJob({
      jobType: "claim_extraction",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [],
      estimatedUnits: 1000,
      hardStopMaxUnits: 500,
      autoApproveMaxUnits: 20,
    });
    expect(plan.action).toBe("conflict");
  });

  it("respects custom auto-approve/hard-stop caps", () => {
    const plan = planResearchJob({
      jobType: "claim_extraction",
      scope: { workIds: ["w1"] },
      versions: VERSIONS,
      existingRequests: [],
      estimatedUnits: 5,
      autoApproveMaxUnits: 2,
      hardStopMaxUnits: 10,
    });
    expect(plan.action).toBe("needs_confirmation");
  });

  it("every returned plan carries the same idempotencyKey computeIdempotencyKey would produce", () => {
    const plan = planResearchJob({
      jobType: "cluster_naming",
      scope: { workIds: ["w9"] },
      versions: VERSIONS,
      existingRequests: [],
    });
    expect(plan.idempotencyKey).toBe(computeIdempotencyKey("cluster_naming", { workIds: ["w9"] }, VERSIONS));
  });
});
