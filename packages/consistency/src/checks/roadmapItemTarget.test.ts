import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkRoadmapItemTarget } from "./roadmapItemTarget";

describe("checkRoadmapItemTarget", () => {
  it("reports nothing when a roadmap item already points at the canonical primary record", () => {
    const snapshot = {
      ...emptySnapshot(),
      learningResources: [{ id: "lr1", workIdentityId: "wi1", bibRecordId: "b1", workRole: "primary", title: "T", year: null }],
      roadmapOverrides: [{ id: "ro1", bibId: "b1" }],
    };
    expect(checkRoadmapItemTarget(snapshot)).toEqual([]);
  });

  it("detects and repairs a roadmap_override pointing at a non-canonical duplicate bib record", () => {
    const snapshot = {
      ...emptySnapshot(),
      learningResources: [
        { id: "lr-dup", workIdentityId: "wi1", bibRecordId: "b-dup", workRole: "edition", title: "Dup", year: null },
        { id: "lr-primary", workIdentityId: "wi1", bibRecordId: "b-primary", workRole: "primary", title: "Primary", year: null },
      ],
      roadmapOverrides: [{ id: "ro1", bibId: "b-dup" }],
    };
    const mismatches = checkRoadmapItemTarget(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].entityType).toBe("roadmap_override");
    expect(mismatches[0].repair).toEqual({
      kind: "update",
      table: "roadmap_override",
      id: "ro1",
      patch: { bibId: "b-primary" },
      reason: expect.any(String),
    });
  });

  it("checks reading_record and understanding_rating the same way", () => {
    const snapshot = {
      ...emptySnapshot(),
      learningResources: [
        { id: "lr-dup", workIdentityId: "wi1", bibRecordId: "b-dup", workRole: "edition", title: "Dup", year: null },
        { id: "lr-primary", workIdentityId: "wi1", bibRecordId: "b-primary", workRole: "primary", title: "Primary", year: null },
      ],
      readingRecords: [{ id: "rr1", bibId: "b-dup" }],
      understandingRatings: [{ id: "ur1", bibId: "b-dup" }],
    };
    const mismatches = checkRoadmapItemTarget(snapshot);
    expect(mismatches.map((m) => m.entityType).sort()).toEqual(["reading_record", "understanding_rating"]);
  });

  it("ignores a bib record that has no learning_resource at all (nothing canonical to compare against)", () => {
    const snapshot = { ...emptySnapshot(), roadmapOverrides: [{ id: "ro1", bibId: "b-orphan" }] };
    expect(checkRoadmapItemTarget(snapshot)).toEqual([]);
  });

  it("ignores a row with no bibId set", () => {
    const snapshot = { ...emptySnapshot(), roadmapOverrides: [{ id: "ro1", bibId: null }] };
    expect(checkRoadmapItemTarget(snapshot)).toEqual([]);
  });
});
