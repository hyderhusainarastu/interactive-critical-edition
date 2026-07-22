import { describe, expect, it } from "vitest";
import { isActiveLoser, resolveCanonicalIdentityId } from "./mergeChain";

describe("resolveCanonicalIdentityId", () => {
  it("returns the id unchanged when it has no active merge", () => {
    expect(resolveCanonicalIdentityId("a", [])).toBe("a");
  });

  it("resolves a single-hop merge", () => {
    expect(resolveCanonicalIdentityId("loser", [{ loserIdentityId: "loser", winnerIdentityId: "winner" }])).toBe("winner");
  });

  it("follows a chained merge to the final winner", () => {
    const merges = [
      { loserIdentityId: "a", winnerIdentityId: "b" },
      { loserIdentityId: "b", winnerIdentityId: "c" },
    ];
    expect(resolveCanonicalIdentityId("a", merges)).toBe("c");
  });

  it("ignores a reverted merge", () => {
    const merges = [{ loserIdentityId: "a", winnerIdentityId: "b", revertedAt: "2026-01-01T00:00:00Z" }];
    expect(resolveCanonicalIdentityId("a", merges)).toBe("a");
  });

  it("guards against a cycle in corrupt data instead of looping forever", () => {
    const merges = [
      { loserIdentityId: "a", winnerIdentityId: "b" },
      { loserIdentityId: "b", winnerIdentityId: "a" },
    ];
    expect(() => resolveCanonicalIdentityId("a", merges)).not.toThrow();
  });
});

describe("isActiveLoser", () => {
  it("is true for an active (non-reverted) loser", () => {
    expect(isActiveLoser("a", [{ loserIdentityId: "a", winnerIdentityId: "b" }])).toBe(true);
  });

  it("is false for a reverted merge", () => {
    expect(isActiveLoser("a", [{ loserIdentityId: "a", winnerIdentityId: "b", revertedAt: "2026-01-01T00:00:00Z" }])).toBe(false);
  });

  it("is false for an id that was never merged", () => {
    expect(isActiveLoser("a", [])).toBe(false);
  });
});
