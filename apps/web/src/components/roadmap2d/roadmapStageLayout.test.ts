import { describe, expect, it } from "vitest";
import { TIER_ORDER } from "@ice/roadmap";
import { layoutRoadmapStageColumns } from "./roadmapStageLayout";

/**
 * Pure-function regression for the 2D stage-column Roadmap layout (Stage 4
 * read spec §6.3/§6.5). No DOM, no Canvas — run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `apps/web/src/components/graph/roadmapLayout.test.ts`).
 */

describe("layoutRoadmapStageColumns", () => {
  // Empty input: no columns, no nodes, root still positioned (a "you are
  // here" node with nothing reached is a plausible real state).
  it("empty input: no columns, no nodes, root still positioned", () => {
    const result = layoutRoadmapStageColumns([]);
    expect(result.columns).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(typeof result.root.x).toBe("number");
    expect(typeof result.root.y).toBe("number");
  });

  // Only populated tiers become columns, in TIER_ORDER order — never a fixed
  // 7-column grid with empty columns.
  it("only populated tiers become columns, in TIER_ORDER order — never a fixed 7-column grid with empty columns", () => {
    const result = layoutRoadmapStageColumns([
      { bibId: "b1", tier: "optional" },
      { bibId: "b2", tier: "essential" },
    ]);
    expect(result.columns).toEqual(["essential", "optional"]);
    expect(result.columns.length).toBe(2);
  });

  // Column x strictly increases with TIER_ORDER, root is left of every
  // column (column 0 implicitly, at the smallest x).
  it("column x strictly increases with TIER_ORDER, root is left of every column", () => {
    const result = layoutRoadmapStageColumns([
      { bibId: "e1", tier: "essential" },
      { bibId: "h1", tier: "high" },
      { bibId: "o1", tier: "optional" },
    ]);
    const byTier = new Map(result.nodes.map((n) => [n.tier, n]));
    expect(result.root.x < byTier.get("essential")!.x).toBeTruthy();
    expect(byTier.get("essential")!.x < byTier.get("high")!.x).toBeTruthy();
    expect(byTier.get("high")!.x < byTier.get("optional")!.x).toBeTruthy();
    // Column indices match TIER_ORDER's relative order, offset by the root's
    // own column 0.
    expect(byTier.get("essential")!.column).toBe(TIER_ORDER.indexOf("essential") + 1);
  });

  // Two items in the same tier get distinct rows (stacked), same column/x.
  it("two items in the same tier get distinct rows (stacked), same column/x", () => {
    const result = layoutRoadmapStageColumns([
      { bibId: "a", tier: "essential" },
      { bibId: "b", tier: "essential" },
    ]);
    const a = result.nodes.find((n) => n.bibId === "a")!;
    const b = result.nodes.find((n) => n.bibId === "b")!;
    expect(a.column).toBe(b.column);
    expect(a.x).toBe(b.x);
    expect(a.row).not.toBe(b.row);
    expect(a.y).not.toBe(b.y);
  });

  // Determinism: same input twice yields identical output.
  it("determinism: same input twice yields identical output", () => {
    const input = [
      { bibId: "x", tier: "contextual" as const },
      { bibId: "y", tier: "comparative" as const },
    ];
    const first = layoutRoadmapStageColumns(input);
    const second = layoutRoadmapStageColumns(input);
    expect(first).toEqual(second);
  });

  // Options override the defaults.
  it("options override the defaults", () => {
    const result = layoutRoadmapStageColumns([{ bibId: "a", tier: "essential" }], { columnWidth: 100, paddingX: 10 });
    const node = result.nodes[0];
    expect(node.x).toBe(10 + 1 * 100);
  });
});
