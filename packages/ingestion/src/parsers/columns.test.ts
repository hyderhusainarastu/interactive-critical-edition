import { describe, expect, it } from "vitest";
import { findColumnSplit, joinPositionedItems, orderItemsForColumns, type PositionedTextItem } from "./columns";

// pageWidth=600 => mid=300, margin=5%*600=30 => left band x<270, gap
// 270-330, right band x>330. Test fixtures below keep well clear of the
// gap band on purpose so they aren't sensitive to the exact margin width.
const PAGE_WIDTH = 600;
const LEFT_X = 100;
const RIGHT_X = 450;

describe("findColumnSplit (ported from ScholarLens _find_column_split)", () => {
  it("returns null for an empty page", () => {
    expect(findColumnSplit([], PAGE_WIDTH)).toBeNull();
  });

  it("returns null when every item sits in one band (single column)", () => {
    // All items clustered near the left margin, as a normal single-column
    // page would produce — no meaningful right-half population.
    const xs = [72, 75, 80, 90, 72, 78, 85];
    expect(findColumnSplit(xs, PAGE_WIDTH)).toBeNull();
  });

  it("returns null when items are spread across the centre gutter (no real gap)", () => {
    // Evenly spread from left to right with nothing sparse in the middle —
    // a single wide column, not two.
    const xs = [50, 150, 250, 300, 350, 450, 550];
    expect(findColumnSplit(xs, PAGE_WIDTH)).toBeNull();
  });

  it("detects a genuine two-column layout and returns the page midpoint", () => {
    const left = Array.from({ length: 20 }, (_, i) => LEFT_X + (i % 5) * 4);
    const right = Array.from({ length: 20 }, (_, i) => RIGHT_X + (i % 5) * 4);
    expect(findColumnSplit([...left, ...right], PAGE_WIDTH)).toBe(PAGE_WIDTH / 2);
  });

  it("does not call a lopsided split two-column (one side under 20%)", () => {
    const left = Array.from({ length: 95 }, () => LEFT_X);
    const right = Array.from({ length: 5 }, () => RIGHT_X); // 5/100 = 5%, under the 20% floor
    expect(findColumnSplit([...left, ...right], PAGE_WIDTH)).toBeNull();
  });

  it("does not call it two-column when the centre gutter itself is populated (>=10%)", () => {
    const left = Array.from({ length: 40 }, () => LEFT_X);
    const right = Array.from({ length: 40 }, () => RIGHT_X);
    const gutter = Array.from({ length: 20 }, () => PAGE_WIDTH / 2); // 20/100 = 20% in the gap band
    expect(findColumnSplit([...left, ...right, ...gutter], PAGE_WIDTH)).toBeNull();
  });
});

describe("orderItemsForColumns", () => {
  function item(x: number, y: number, str: string, hasEOL = true): PositionedTextItem {
    return { x, y, str, hasEOL };
  }

  it("leaves a single-column page's items in their original stream order", () => {
    // Byte-for-byte parity requirement: unpdf's own flattening already
    // produces correct reading order for single-column pages by just
    // following the pdf.js content-stream order, so this function must not
    // re-sort or otherwise disturb that when no column split is detected.
    const items = [item(72, 700, "First "), item(72, 680, "Second "), item(72, 660, "Third")];
    expect(orderItemsForColumns(items, PAGE_WIDTH)).toEqual(items);
  });

  it("orders a two-column page left-column-top-to-bottom then right-column-top-to-bottom", () => {
    // Physical reading order should be: L1, L2, L3, R1, R2, R3.
    // Deliberately scrambled input order (as a real content stream can
    // interleave columns) to prove the function re-derives it from geometry.
    const items = [
      item(RIGHT_X, 700, "R1 "), // right column, top
      item(LEFT_X, 700, "L1 "), // left column, top
      item(RIGHT_X, 600, "R2 "), // right column, middle
      item(LEFT_X, 500, "L3"), // left column, bottom
      item(LEFT_X, 600, "L2 "), // left column, middle
      item(RIGHT_X, 500, "R3"), // right column, bottom
    ];
    const ordered = orderItemsForColumns(items, PAGE_WIDTH);
    expect(ordered.map((i) => i.str)).toEqual(["L1 ", "L2 ", "L3", "R1 ", "R2 ", "R3"]);
  });
});

describe("joinPositionedItems", () => {
  it("inserts a newline only where pdf.js marked hasEOL", () => {
    const items: PositionedTextItem[] = [
      { x: 0, y: 0, str: "Hello ", hasEOL: false },
      { x: 0, y: 0, str: "world.", hasEOL: true },
      { x: 0, y: 0, str: "Next line.", hasEOL: false },
    ];
    expect(joinPositionedItems(items)).toBe("Hello world.\nNext line.");
  });
});

describe("two-column reading-order fixture (synthetic academic page)", () => {
  it("reconstructs a coherent paragraph from a scrambled two-column extraction order", () => {
    // A short synthetic two-column page: left column reads "The first
    // argument holds.", right column reads "The reply follows below." — text
    // items arrive in a scrambled (column-interleaved) stream order, as a
    // real two-column PDF's content stream often does.
    const items: PositionedTextItem[] = [
      { x: RIGHT_X, y: 700, str: "The ", hasEOL: false },
      { x: LEFT_X, y: 700, str: "The ", hasEOL: false },
      { x: RIGHT_X, y: 700, str: "reply ", hasEOL: false },
      { x: LEFT_X, y: 700, str: "first ", hasEOL: false },
      { x: RIGHT_X, y: 680, str: "follows ", hasEOL: false },
      { x: LEFT_X, y: 680, str: "argument ", hasEOL: false },
      { x: RIGHT_X, y: 660, str: "below.", hasEOL: true },
      { x: LEFT_X, y: 660, str: "holds.", hasEOL: true },
    ];
    const ordered = orderItemsForColumns(items, PAGE_WIDTH);
    const text = joinPositionedItems(ordered);
    expect(text).toBe("The first argument holds.\nThe reply follows below.\n");
  });
});
