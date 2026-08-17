import { describe, expect, it } from "vitest";
import { CANONICAL_NODE_TYPES, DISPLAY_EDGE_FAMILIES, DISPLAY_ONLY_KINDS } from "@ice/graph-display";
import { desaturate, EDGE_VISUALS, isStructuralOrDisplayOnly, KIND_VISUALS } from "./theme";

/**
 * Totality tests (charter §10 "every current node type/state has a visual
 * mapping" / "every current edge value has a family mapping").
 */

describe("theme", () => {
  // --- KIND_VISUALS covers exactly the 9 canonical + 9 display-only kinds ---
  it("covers exactly the 9 canonical + 9 display-only kinds in KIND_VISUALS, each with a real color and positive radius", () => {
    const expected = [...CANONICAL_NODE_TYPES, ...DISPLAY_ONLY_KINDS].sort();
    const actual = Object.keys(KIND_VISUALS).sort();
    // KIND_VISUALS must cover every DisplayKind<NodeType> value, no more/fewer
    expect(actual).toEqual(expected);
    for (const kind of expected) {
      const visual = KIND_VISUALS[kind as keyof typeof KIND_VISUALS];
      expect(visual.color.startsWith("#")).toBeTruthy();
      expect(visual.relativeRadius > 0).toBeTruthy();
    }
  });

  // --- EDGE_VISUALS covers exactly the 6 DisplayEdgeFamily values ---
  it("covers exactly the 6 DisplayEdgeFamily values in EDGE_VISUALS, each with a real color and positive width", () => {
    const expected = [...DISPLAY_EDGE_FAMILIES].sort();
    const actual = Object.keys(EDGE_VISUALS).sort();
    // EDGE_VISUALS must cover every DisplayEdgeFamily value, no more/fewer
    expect(actual).toEqual(expected);
    for (const family of expected) {
      const visual = EDGE_VISUALS[family as keyof typeof EDGE_VISUALS];
      expect(visual.color.startsWith("#")).toBeTruthy();
      expect(visual.widthPx > 0).toBeTruthy();
    }
  });

  // --- charter §10's exact node-geometry/color table, spot-checked ---
  it("matches charter §10's exact node-geometry/color table (spot check)", () => {
    expect(KIND_VISUALS.work.color).toBe("#FDF8EE");
    expect(KIND_VISUALS.work.accessoryColor).toBe("#F0C47C");
    expect(KIND_VISUALS.reference.color).toBe("#C99B9B");
    expect(KIND_VISUALS.peer_reviewed_source.color).toBe("#8FC4A8");
    expect(KIND_VISUALS.online_source.color).toBe("#D3AB86");
    expect(KIND_VISUALS.claim.color).toBe("#8DB3C4");
    expect(KIND_VISUALS.debate.color).toBe("#E0A3AC");
  });

  // --- charter §10's exact edge-grammar table, spot-checked ---
  it("matches charter §10's exact edge-grammar table (spot check)", () => {
    expect(EDGE_VISUALS.reference).toEqual({ color: "#A9B3BC", widthPx: 0.7, arrow: false });
    expect(EDGE_VISUALS.prerequisite).toEqual({ color: "#F0C47C", widthPx: 1.4, arrow: true });
    expect(EDGE_VISUALS.opposition).toEqual({ color: "#E0A3AC", widthPx: 1.4, arrow: false });
    expect(EDGE_VISUALS.structural).toEqual({ color: "#718096", widthPx: 0.8, arrow: false });
  });

  // --- desaturate: pure, deterministic, and actually moves the color ---
  it("desaturates purely and deterministically, and actually moves the color", () => {
    const before = "#8DB3C4"; // claim blue
    const after = desaturate(before);
    expect(after).not.toBe(before);
    // deterministic for the same input
    expect(desaturate(before)).toBe(after);
  });

  // --- isStructuralOrDisplayOnly ---
  it("classifies structural and display-only kinds, but not a real work", () => {
    expect(isStructuralOrDisplayOnly({ displayKind: "section", sourceEntity: { kind: "text_block", id: "1" } })).toBe(true);
    expect(isStructuralOrDisplayOnly({ displayKind: "aggregate", sourceEntity: null })).toBe(true);
    expect(isStructuralOrDisplayOnly({ displayKind: "work", sourceEntity: { kind: "work", id: "1" } })).toBe(false);
  });
});
