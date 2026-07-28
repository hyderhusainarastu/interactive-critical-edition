import assert from "node:assert/strict";
import { TIER_ORDER } from "@ice/roadmap";
import { layoutRoadmapStageColumns } from "./roadmapStageLayout";

/**
 * Pure-function regression for the 2D stage-column Roadmap layout (Stage 4
 * read spec §6.3/§6.5). No DOM, no Canvas — run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `apps/web/src/components/graph/roadmapLayout.test.ts`).
 */

// Empty input: no columns, no nodes, root still positioned (a "you are
// here" node with nothing reached is a plausible real state).
{
  const result = layoutRoadmapStageColumns([]);
  assert.deepEqual(result.columns, []);
  assert.deepEqual(result.nodes, []);
  assert.equal(typeof result.root.x, "number");
  assert.equal(typeof result.root.y, "number");
}

// Only populated tiers become columns, in TIER_ORDER order — never a fixed
// 7-column grid with empty columns.
{
  const result = layoutRoadmapStageColumns([
    { bibId: "b1", tier: "optional" },
    { bibId: "b2", tier: "essential" },
  ]);
  assert.deepEqual(result.columns, ["essential", "optional"]);
  assert.equal(result.columns.length, 2);
}

// Column x strictly increases with TIER_ORDER, root is left of every
// column (column 0 implicitly, at the smallest x).
{
  const result = layoutRoadmapStageColumns([
    { bibId: "e1", tier: "essential" },
    { bibId: "h1", tier: "high" },
    { bibId: "o1", tier: "optional" },
  ]);
  const byTier = new Map(result.nodes.map((n) => [n.tier, n]));
  assert.ok(result.root.x < byTier.get("essential")!.x);
  assert.ok(byTier.get("essential")!.x < byTier.get("high")!.x);
  assert.ok(byTier.get("high")!.x < byTier.get("optional")!.x);
  // Column indices match TIER_ORDER's relative order, offset by the root's
  // own column 0.
  assert.equal(byTier.get("essential")!.column, TIER_ORDER.indexOf("essential") + 1);
}

// Two items in the same tier get distinct rows (stacked), same column/x.
{
  const result = layoutRoadmapStageColumns([
    { bibId: "a", tier: "essential" },
    { bibId: "b", tier: "essential" },
  ]);
  const a = result.nodes.find((n) => n.bibId === "a")!;
  const b = result.nodes.find((n) => n.bibId === "b")!;
  assert.equal(a.column, b.column);
  assert.equal(a.x, b.x);
  assert.notEqual(a.row, b.row);
  assert.notEqual(a.y, b.y);
}

// Determinism: same input twice yields identical output.
{
  const input = [
    { bibId: "x", tier: "contextual" as const },
    { bibId: "y", tier: "comparative" as const },
  ];
  const first = layoutRoadmapStageColumns(input);
  const second = layoutRoadmapStageColumns(input);
  assert.deepEqual(first, second);
}

// Options override the defaults.
{
  const result = layoutRoadmapStageColumns([{ bibId: "a", tier: "essential" }], { columnWidth: 100, paddingX: 10 });
  const node = result.nodes[0];
  assert.equal(node.x, 10 + 1 * 100);
}

console.log("roadmapStageLayout.test.ts: all assertions passed");
