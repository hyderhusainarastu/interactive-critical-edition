import { describe, expect, it } from "vitest";
import { computeRelationshipBasisHash, type RelationshipBasisInput } from "./basisHash";

const BASE: RelationshipBasisInput = {
  loText: "Claim A text.",
  loExcerpt: "excerpt A",
  hiText: "Claim B text.",
  hiExcerpt: "excerpt B",
  promptVersion: "judge-v3-baseline-reasoning-schema",
  branch: "empirical",
  engagement: "none_detected",
};

describe("computeRelationshipBasisHash", () => {
  it("is deterministic for the same input", () => {
    expect(computeRelationshipBasisHash(BASE)).toBe(computeRelationshipBasisHash({ ...BASE }));
  });

  it("produces a 64-character lowercase hex sha256 digest", () => {
    const hash = computeRelationshipBasisHash(BASE);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when either claim's text changes", () => {
    const hash = computeRelationshipBasisHash(BASE);
    expect(computeRelationshipBasisHash({ ...BASE, loText: "Different claim A text." })).not.toBe(hash);
    expect(computeRelationshipBasisHash({ ...BASE, hiText: "Different claim B text." })).not.toBe(hash);
  });

  it("changes when either claim's excerpt changes", () => {
    const hash = computeRelationshipBasisHash(BASE);
    expect(computeRelationshipBasisHash({ ...BASE, loExcerpt: "different excerpt A" })).not.toBe(hash);
    expect(computeRelationshipBasisHash({ ...BASE, hiExcerpt: "different excerpt B" })).not.toBe(hash);
  });

  it("changes when promptVersion bumps", () => {
    expect(computeRelationshipBasisHash({ ...BASE, promptVersion: "judge-v4" })).not.toBe(computeRelationshipBasisHash(BASE));
  });

  it("changes when branch differs", () => {
    expect(computeRelationshipBasisHash({ ...BASE, branch: "humanities" })).not.toBe(computeRelationshipBasisHash(BASE));
  });

  it("changes when engagement is reclassified (e.g. none_detected -> direct_citation)", () => {
    expect(computeRelationshipBasisHash({ ...BASE, engagement: "direct_citation" })).not.toBe(
      computeRelationshipBasisHash(BASE),
    );
  });

  it("does not let a boundary shift between adjacent fields collide (length-prefixing guard)", () => {
    // Without length-prefixing, ("ab", "c") and ("a", "bc") would join to the
    // same concatenated string under a naive delimiter-free join.
    const a = computeRelationshipBasisHash({ ...BASE, loText: "ab", loExcerpt: "c" });
    const b = computeRelationshipBasisHash({ ...BASE, loText: "a", loExcerpt: "bc" });
    expect(a).not.toBe(b);
  });
});
