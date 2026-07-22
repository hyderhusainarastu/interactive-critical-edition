import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkLibraryItemCanonicalWork } from "./libraryItemCanonicalWork";

describe("checkLibraryItemCanonicalWork", () => {
  it("reports nothing when every work_identity_id points at a live, non-merged identity", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [{ id: "wi1", canonicalTitle: "T", authorSurname: null, year: null }],
      learningResources: [{ id: "lr1", workIdentityId: "wi1", bibRecordId: null, workRole: "primary", title: "T", year: null }],
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: "wi1", deletedAt: null }],
    };
    expect(checkLibraryItemCanonicalWork(snapshot)).toEqual([]);
  });

  it("detects and repairs a learning_resource pointing at a merged-away loser identity", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [
        { id: "winner", canonicalTitle: "Winner", authorSurname: null, year: null },
        { id: "loser", canonicalTitle: "Loser", authorSurname: null, year: null },
      ],
      workIdentityMerges: [{ loserIdentityId: "loser", winnerIdentityId: "winner", revertedAt: null }],
      learningResources: [{ id: "lr1", workIdentityId: "loser", bibRecordId: null, workRole: "primary", title: "T", year: null }],
    };
    const mismatches = checkLibraryItemCanonicalWork(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toEqual({
      kind: "update",
      table: "learning_resource",
      id: "lr1",
      patch: { workIdentityId: "winner" },
      reason: expect.any(String),
    });
  });

  it("does not repoint through a REVERTED merge", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [
        { id: "winner", canonicalTitle: "Winner", authorSurname: null, year: null },
        { id: "loser", canonicalTitle: "Loser", authorSurname: null, year: null },
      ],
      workIdentityMerges: [{ loserIdentityId: "loser", winnerIdentityId: "winner", revertedAt: "2026-01-01T00:00:00Z" }],
      learningResources: [{ id: "lr1", workIdentityId: "loser", bibRecordId: null, workRole: "primary", title: "T", year: null }],
    };
    expect(checkLibraryItemCanonicalWork(snapshot)).toEqual([]);
  });

  it("detects and repairs a work pointing at a merged-away loser identity", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [
        { id: "winner", canonicalTitle: "Winner", authorSurname: null, year: null },
        { id: "loser", canonicalTitle: "Loser", authorSurname: null, year: null },
      ],
      workIdentityMerges: [{ loserIdentityId: "loser", winnerIdentityId: "winner", revertedAt: null }],
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: "loser", deletedAt: null }],
    };
    const mismatches = checkLibraryItemCanonicalWork(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toEqual({
      kind: "update",
      table: "work",
      id: "w1",
      patch: { workIdentityId: "winner" },
      reason: expect.any(String),
    });
  });

  it("reports a genuinely dangling work_identity_id as critical, never repaired", () => {
    const snapshot = {
      ...emptySnapshot(),
      learningResources: [{ id: "lr1", workIdentityId: "ghost", bibRecordId: null, workRole: "primary", title: "T", year: null }],
    };
    const mismatches = checkLibraryItemCanonicalWork(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("critical");
    expect(mismatches[0].repair).toBeNull();
  });

  it("follows a chained merge (loser merged into an identity that was itself later merged)", () => {
    const snapshot = {
      ...emptySnapshot(),
      workIdentities: [
        { id: "final", canonicalTitle: "Final", authorSurname: null, year: null },
        { id: "mid", canonicalTitle: "Mid", authorSurname: null, year: null },
        { id: "loser", canonicalTitle: "Loser", authorSurname: null, year: null },
      ],
      workIdentityMerges: [
        { loserIdentityId: "loser", winnerIdentityId: "mid", revertedAt: null },
        { loserIdentityId: "mid", winnerIdentityId: "final", revertedAt: null },
      ],
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: "loser", deletedAt: null }],
    };
    const mismatches = checkLibraryItemCanonicalWork(snapshot);
    expect(mismatches).toHaveLength(1);
    expect((mismatches[0].repair as unknown as { patch: { workIdentityId: string } }).patch.workIdentityId).toBe("final");
  });
});
