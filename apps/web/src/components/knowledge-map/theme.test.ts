import assert from "node:assert/strict";
import { CANONICAL_NODE_TYPES, DISPLAY_EDGE_FAMILIES, DISPLAY_ONLY_KINDS } from "@ice/graph-display";
import { desaturate, EDGE_VISUALS, isStructuralOrDisplayOnly, KIND_VISUALS } from "./theme";

/**
 * Totality tests (charter §10 "every current node type/state has a visual
 * mapping" / "every current edge value has a family mapping") — run via
 * `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/theme.test.ts`.
 */

// --- KIND_VISUALS covers exactly the 9 canonical + 9 display-only kinds ---
{
  const expected = [...CANONICAL_NODE_TYPES, ...DISPLAY_ONLY_KINDS].sort();
  const actual = Object.keys(KIND_VISUALS).sort();
  assert.deepEqual(actual, expected, "KIND_VISUALS must cover every DisplayKind<NodeType> value, no more/fewer");
  for (const kind of expected) {
    const visual = KIND_VISUALS[kind as keyof typeof KIND_VISUALS];
    assert.ok(visual.color.startsWith("#"), `${kind} must have a real color`);
    assert.ok(visual.relativeRadius > 0, `${kind} must have a positive relative radius`);
  }
}
console.log("KIND_VISUALS totality: OK");

// --- EDGE_VISUALS covers exactly the 6 DisplayEdgeFamily values ---
{
  const expected = [...DISPLAY_EDGE_FAMILIES].sort();
  const actual = Object.keys(EDGE_VISUALS).sort();
  assert.deepEqual(actual, expected, "EDGE_VISUALS must cover every DisplayEdgeFamily value, no more/fewer");
  for (const family of expected) {
    const visual = EDGE_VISUALS[family as keyof typeof EDGE_VISUALS];
    assert.ok(visual.color.startsWith("#"));
    assert.ok(visual.widthPx > 0);
  }
}
console.log("EDGE_VISUALS totality: OK");

// --- charter §10's exact node-geometry/color table, spot-checked ---
assert.equal(KIND_VISUALS.work.color, "#FDF8EE");
assert.equal(KIND_VISUALS.work.accessoryColor, "#F0C47C");
assert.equal(KIND_VISUALS.reference.color, "#C99B9B");
assert.equal(KIND_VISUALS.peer_reviewed_source.color, "#8FC4A8");
assert.equal(KIND_VISUALS.online_source.color, "#D3AB86");
assert.equal(KIND_VISUALS.claim.color, "#8DB3C4");
assert.equal(KIND_VISUALS.debate.color, "#E0A3AC");
console.log("charter §10 node table spot check: OK");

// --- charter §10's exact edge-grammar table, spot-checked ---
assert.deepEqual(EDGE_VISUALS.reference, { color: "#A9B3BC", widthPx: 0.7, arrow: false });
assert.deepEqual(EDGE_VISUALS.prerequisite, { color: "#F0C47C", widthPx: 1.4, arrow: true });
assert.deepEqual(EDGE_VISUALS.opposition, { color: "#E0A3AC", widthPx: 1.4, arrow: false });
assert.deepEqual(EDGE_VISUALS.structural, { color: "#718096", widthPx: 0.8, arrow: false });
console.log("charter §10 edge table spot check: OK");

// --- desaturate: pure, deterministic, and actually moves the color ---
{
  const before = "#8DB3C4"; // claim blue
  const after = desaturate(before);
  assert.notEqual(after, before);
  assert.equal(desaturate(before), after, "deterministic for the same input");
}
console.log("desaturate: OK");

// --- isStructuralOrDisplayOnly ---
assert.equal(isStructuralOrDisplayOnly({ displayKind: "section", sourceEntity: { kind: "text_block", id: "1" } }), true);
assert.equal(isStructuralOrDisplayOnly({ displayKind: "aggregate", sourceEntity: null }), true);
assert.equal(isStructuralOrDisplayOnly({ displayKind: "work", sourceEntity: { kind: "work", id: "1" } }), false);
console.log("isStructuralOrDisplayOnly: OK");

console.log("theme.test.ts: all assertions passed");
