import { describe, expect, it } from "vitest";
import { RETRIEVAL_LIMITS } from "./limits";

describe("RETRIEVAL_LIMITS", () => {
  it("defaults maxCandidatePairs to a positive finite number", () => {
    expect(RETRIEVAL_LIMITS.maxCandidatePairs).toBe(400);
    expect(Number.isFinite(RETRIEVAL_LIMITS.maxCandidatePairs)).toBe(true);
    expect(RETRIEVAL_LIMITS.maxCandidatePairs).toBeGreaterThan(0);
  });
});
