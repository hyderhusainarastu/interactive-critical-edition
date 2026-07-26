import { describe, expect, it } from "vitest";
import { AUTO_APPROVE_MAX_CHUNKS, HARD_STOP_MAX_CHUNKS, RETRIEVAL_LIMITS } from "./limits";

describe("RETRIEVAL_LIMITS", () => {
  it("defaults maxCandidatePairs to a positive finite number", () => {
    expect(RETRIEVAL_LIMITS.maxCandidatePairs).toBe(400);
    expect(Number.isFinite(RETRIEVAL_LIMITS.maxCandidatePairs)).toBe(true);
    expect(RETRIEVAL_LIMITS.maxCandidatePairs).toBeGreaterThan(0);
  });
});

describe("extract_claims confirmation-gate thresholds", () => {
  it("keeps AUTO_APPROVE_MAX_CHUNKS strictly below HARD_STOP_MAX_CHUNKS", () => {
    expect(AUTO_APPROVE_MAX_CHUNKS).toBe(12);
    expect(HARD_STOP_MAX_CHUNKS).toBe(50);
    expect(AUTO_APPROVE_MAX_CHUNKS).toBeLessThan(HARD_STOP_MAX_CHUNKS);
  });
});
