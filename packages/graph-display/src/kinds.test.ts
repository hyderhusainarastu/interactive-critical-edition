import { describe, expect, it } from "vitest";
import { CANONICAL_NODE_TYPES, DISPLAY_ONLY_KINDS, SOURCE_ENTITY_KINDS, isDisplayOnlyKind } from "./kinds";

describe("kinds", () => {
  it("mirrors the current 9-value canonical NodeType union exactly", () => {
    expect([...CANONICAL_NODE_TYPES].sort()).toEqual(
      [
        "work",
        "reference",
        "peer_reviewed_source",
        "online_source",
        "concept",
        "person",
        "section",
        "claim",
        "debate",
      ].sort(),
    );
  });

  it("adds exactly the 9 charter-specified display-only kinds", () => {
    expect([...DISPLAY_ONLY_KINDS].sort()).toEqual(
      ["passage", "question", "position", "evidence", "learning_step", "hypothesis", "gap", "writing_project", "aggregate"].sort(),
    );
  });

  it("has no overlap between canonical and display-only kinds", () => {
    const canonicalSet = new Set<string>(CANONICAL_NODE_TYPES);
    for (const kind of DISPLAY_ONLY_KINDS) {
      expect(canonicalSet.has(kind)).toBe(false);
    }
  });

  it("isDisplayOnlyKind is true for every display-only kind and false for every canonical kind", () => {
    for (const kind of DISPLAY_ONLY_KINDS) expect(isDisplayOnlyKind(kind)).toBe(true);
    for (const kind of CANONICAL_NODE_TYPES) expect(isDisplayOnlyKind(kind)).toBe(false);
  });

  it("isDisplayOnlyKind is false for an arbitrary unknown string", () => {
    expect(isDisplayOnlyKind("totally_made_up")).toBe(false);
  });

  it("SOURCE_ENTITY_KINDS has no duplicate entries", () => {
    expect(new Set(SOURCE_ENTITY_KINDS).size).toBe(SOURCE_ENTITY_KINDS.length);
  });
});
