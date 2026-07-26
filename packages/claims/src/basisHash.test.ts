import { describe, expect, it } from "vitest";
import { computeChamberBasisHash, computeRelationshipBasisHash, type ChamberBasisInput, type RelationshipBasisInput } from "./basisHash";

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

  it("rebind invariance: an applyRebindResult-shaped change (textBlockId/anchorState) never changes the hash", () => {
    // `RelationshipBasisInput` (this file's import above) has no
    // `textBlockId`/`anchorState`/`processingRunId` field at all — those are
    // exactly the columns `apps/worker/src/research/repository.ts`'s
    // `applyRebindResult` writes when a claim's anchor is relocated after a
    // reprocess. Model a "claim row" with those extra fields to prove that
    // projecting ONLY the basis-relevant fields (claimText/supportingExcerpt)
    // through the same extraction a caller like `detectRelationships.ts`
    // does yields an identical hash whether the claim is pre- or
    // post-rebind — a rebind must never force every `claim_relationship`
    // judged against that claim to be silently re-judged (and re-paid for).
    interface ClaimRowShape {
      claimText: string;
      supportingExcerpt: string;
      textBlockId: string | null;
      anchorState: "unanchored" | "rebound";
      processingRunId: string | null;
    }
    const beforeRebind: ClaimRowShape = {
      claimText: BASE.loText,
      supportingExcerpt: BASE.loExcerpt,
      textBlockId: null,
      anchorState: "unanchored",
      processingRunId: "11111111-1111-1111-1111-111111111111",
    };
    const afterRebind: ClaimRowShape = {
      ...beforeRebind,
      textBlockId: "22222222-2222-2222-2222-222222222222",
      anchorState: "rebound",
      processingRunId: "33333333-3333-3333-3333-333333333333",
    };
    const basisOf = (claim: ClaimRowShape): RelationshipBasisInput => ({
      ...BASE,
      loText: claim.claimText,
      loExcerpt: claim.supportingExcerpt,
    });
    expect(computeRelationshipBasisHash(basisOf(beforeRebind))).toBe(computeRelationshipBasisHash(basisOf(afterRebind)));
  });
});

const CHAMBER_BASE: ChamberBasisInput = {
  claims: [
    { id: "11111111-1111-1111-1111-111111111111", text: "Claim A text.", excerpt: "excerpt A" },
    { id: "22222222-2222-2222-2222-222222222222", text: "Claim B text.", excerpt: "excerpt B" },
  ],
  promptVersion: "evidence-chamber-v1",
};

describe("computeChamberBasisHash", () => {
  it("is deterministic for the same input", () => {
    expect(computeChamberBasisHash(CHAMBER_BASE)).toBe(computeChamberBasisHash({ ...CHAMBER_BASE, claims: [...CHAMBER_BASE.claims] }));
  });

  it("produces a 64-character lowercase hex sha256 digest", () => {
    expect(computeChamberBasisHash(CHAMBER_BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is insensitive to the ORDER claims are supplied in — same membership, same hash", () => {
    const reordered: ChamberBasisInput = { ...CHAMBER_BASE, claims: [...CHAMBER_BASE.claims].reverse() };
    expect(computeChamberBasisHash(reordered)).toBe(computeChamberBasisHash(CHAMBER_BASE));
  });

  it("changes when a claim's text changes", () => {
    const edited: ChamberBasisInput = {
      ...CHAMBER_BASE,
      claims: CHAMBER_BASE.claims.map((c, i) => (i === 0 ? { ...c, text: "Edited claim A text." } : c)),
    };
    expect(computeChamberBasisHash(edited)).not.toBe(computeChamberBasisHash(CHAMBER_BASE));
  });

  it("changes when a claim's excerpt changes", () => {
    const edited: ChamberBasisInput = {
      ...CHAMBER_BASE,
      claims: CHAMBER_BASE.claims.map((c, i) => (i === 0 ? { ...c, excerpt: "different excerpt A" } : c)),
    };
    expect(computeChamberBasisHash(edited)).not.toBe(computeChamberBasisHash(CHAMBER_BASE));
  });

  it("changes when the cluster's membership changes (a claim added or removed)", () => {
    const added: ChamberBasisInput = {
      ...CHAMBER_BASE,
      claims: [...CHAMBER_BASE.claims, { id: "33333333-3333-3333-3333-333333333333", text: "Claim C text.", excerpt: "excerpt C" }],
    };
    expect(computeChamberBasisHash(added)).not.toBe(computeChamberBasisHash(CHAMBER_BASE));

    const removed: ChamberBasisInput = { ...CHAMBER_BASE, claims: [CHAMBER_BASE.claims[0]] };
    expect(computeChamberBasisHash(removed)).not.toBe(computeChamberBasisHash(CHAMBER_BASE));
  });

  it("changes when promptVersion bumps", () => {
    expect(computeChamberBasisHash({ ...CHAMBER_BASE, promptVersion: "evidence-chamber-v2" })).not.toBe(computeChamberBasisHash(CHAMBER_BASE));
  });
});
