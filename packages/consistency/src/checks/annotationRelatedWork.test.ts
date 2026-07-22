import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkAnnotationRelatedWork } from "./annotationRelatedWork";

describe("checkAnnotationRelatedWork", () => {
  it("reports nothing when the target_label matches the resolved bibliographic_record's title", () => {
    const snapshot = {
      ...emptySnapshot(),
      annotations: [{ id: "a1", targetBibId: "b1", targetLabel: "Real Title" }],
      bibliographicRecords: [{ id: "b1", title: "Real Title" }],
    };
    expect(checkAnnotationRelatedWork(snapshot)).toEqual([]);
  });

  it("detects and repairs a stale target_label by resyncing from the resolved record's title", () => {
    const snapshot = {
      ...emptySnapshot(),
      annotations: [{ id: "a1", targetBibId: "b1", targetLabel: "Old Title" }],
      bibliographicRecords: [{ id: "b1", title: "Corrected Title" }],
    };
    const mismatches = checkAnnotationRelatedWork(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toEqual({
      kind: "update",
      table: "annotation",
      id: "a1",
      patch: { targetLabel: "Corrected Title" },
      reason: expect.any(String),
    });
  });

  it("ignores an annotation with no resolved target (label-only annotation)", () => {
    const snapshot = {
      ...emptySnapshot(),
      annotations: [{ id: "a1", targetBibId: null, targetLabel: "Some free-text label" }],
    };
    expect(checkAnnotationRelatedWork(snapshot)).toEqual([]);
  });

  it("reports (never guesses) a target_bib_id whose bibliographic_record is gone", () => {
    const snapshot = {
      ...emptySnapshot(),
      annotations: [{ id: "a1", targetBibId: "ghost", targetLabel: "X" }],
    };
    const mismatches = checkAnnotationRelatedWork(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("critical");
    expect(mismatches[0].repair).toBeNull();
  });
});
