import { describe, expect, it } from "vitest";
import { buildGapDescription } from "./researchGap";

describe("buildGapDescription", () => {
  it("renders the cluster name and contradiction count", () => {
    const text = buildGapDescription({ name: "Akrasia Debate", researchQuestion: null, contradictionCount: 3 });
    expect(text).toContain('"Akrasia Debate"');
    expect(text).toContain("3 unresolved contradictions");
  });

  it("uses singular 'contradiction' for a count of 1", () => {
    const text = buildGapDescription({ name: "X", researchQuestion: null, contradictionCount: 1 });
    expect(text).toContain("1 unresolved contradiction ");
    expect(text).not.toContain("1 unresolved contradictions");
  });

  it("appends the research question when present", () => {
    const text = buildGapDescription({ name: "X", researchQuestion: "Is akrasia possible?", contradictionCount: 2 });
    expect(text).toContain("the open question is: Is akrasia possible?");
  });

  it("omits the question clause when absent", () => {
    const text = buildGapDescription({ name: "X", researchQuestion: null, contradictionCount: 2 });
    expect(text).not.toContain("the open question is");
  });

  it("falls back to a generic label when name is blank", () => {
    const text = buildGapDescription({ name: "  ", researchQuestion: null, contradictionCount: 2 });
    expect(text).toContain('"This debate"');
  });

  it("never produces a negative count", () => {
    const text = buildGapDescription({ name: "X", researchQuestion: null, contradictionCount: -5 });
    expect(text).toContain("0 unresolved contradictions");
  });

  it("is purely deterministic for identical input", () => {
    const input = { name: "X", researchQuestion: "Q", contradictionCount: 4 };
    expect(buildGapDescription(input)).toBe(buildGapDescription({ ...input }));
  });
});
