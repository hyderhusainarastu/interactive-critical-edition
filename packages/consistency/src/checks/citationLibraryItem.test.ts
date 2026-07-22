import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkCitationLibraryItem } from "./citationLibraryItem";

describe("checkCitationLibraryItem", () => {
  it("reports nothing for a resolved citation whose link agrees with the learning_resource", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "r1", textBlockId: null, resolvedBibId: "b1" }],
      citationLibraryLinks: [{ id: "l1", citationId: "c1", learningResourceId: "lr1" }],
      learningResources: [{ id: "lr1", workIdentityId: null, bibRecordId: "b1", workRole: "primary", title: "T", year: null }],
    };
    expect(checkCitationLibraryItem(snapshot)).toEqual([]);
  });

  it("detects and repairs a missing citation_library_link when exactly one learning_resource matches", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "r1", textBlockId: null, resolvedBibId: "b1" }],
      learningResources: [{ id: "lr1", workIdentityId: null, bibRecordId: "b1", workRole: "primary", title: "T", year: null }],
    };
    const mismatches = checkCitationLibraryItem(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toEqual({
      kind: "insert",
      table: "citation_library_link",
      values: { citationId: "c1", learningResourceId: "lr1" },
      reason: expect.stringContaining("b1"),
    });
  });

  it("reports but does not guess when no learning_resource projects the resolved bib record yet", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "r1", textBlockId: null, resolvedBibId: "b1" }],
    };
    const mismatches = checkCitationLibraryItem(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toBeNull();
    expect(mismatches[0].severity).toBe("info");
  });

  it("detects and repairs a citation_library_link pointing at the wrong learning_resource", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "r1", textBlockId: null, resolvedBibId: "b1" }],
      citationLibraryLinks: [{ id: "link1", citationId: "c1", learningResourceId: "lr-wrong" }],
      learningResources: [
        { id: "lr-wrong", workIdentityId: null, bibRecordId: "b2", workRole: "primary", title: "Wrong", year: null },
        { id: "lr-right", workIdentityId: null, bibRecordId: "b1", workRole: "primary", title: "Right", year: null },
      ],
    };
    const mismatches = checkCitationLibraryItem(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toEqual({
      kind: "update",
      table: "citation_library_link",
      id: "link1",
      patch: { learningResourceId: "lr-right" },
      reason: expect.any(String),
    });
  });

  it("does not guess when a link disagrees but more than one candidate learning_resource exists", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "r1", textBlockId: null, resolvedBibId: "b1" }],
      citationLibraryLinks: [{ id: "link1", citationId: "c1", learningResourceId: "lr-wrong" }],
      learningResources: [
        { id: "lr-wrong", workIdentityId: null, bibRecordId: "b2", workRole: "primary", title: "Wrong", year: null },
        { id: "lr-right-1", workIdentityId: null, bibRecordId: "b1", workRole: "primary", title: "Right1", year: null },
        { id: "lr-right-2", workIdentityId: null, bibRecordId: "b1", workRole: "review", title: "Right2", year: null },
      ],
    };
    const mismatches = checkCitationLibraryItem(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toBeNull();
  });
});
