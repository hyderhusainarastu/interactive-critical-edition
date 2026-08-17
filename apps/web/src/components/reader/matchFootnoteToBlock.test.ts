import { describe, expect, it } from "vitest";
import { matchFootnotesToBlocks } from "./matchFootnoteToBlock";

describe("matchFootnotesToBlocks", () => {
  // An unambiguous single inline reference anchors to that block; the quote is
  // the token ending in the marker, re-locatable in the rendered DOM.
  it("anchors an unambiguous single inline reference to that block, quoting the token that ends in the marker", () => {
    const blocks = [
      { id: "a", text: "The opening paragraph mentions nothing numbered." },
      { id: "b", text: "acts expressing intemperance are in accordance with choice3 which matters." },
    ];
    const matches = matchFootnotesToBlocks([{ id: "fn-3", marker: "3" }], blocks);
    expect(matches.length).toBe(1);
    expect(matches[0].blockId).toBe("b");
    expect(matches[0].footnoteId).toBe("fn-3");
    expect(matches[0].quote).toBe("choice3");
    expect(matches[0].prefix.endsWith("with ")).toBeTruthy();
  });

  // A marker that appears in more than one reference position falls back (null).
  it("falls back when a marker appears in more than one reference position", () => {
    const matches = matchFootnotesToBlocks([{ id: "fn-3", marker: "3" }], [
      { id: "a", text: "first callout vice3 here" },
      { id: "b", text: "second callout virtue3 there" },
    ]);
    expect(matches.length).toBe(0);
  });

  // Zero references → no anchor.
  it("produces no anchor when there are zero references", () => {
    expect(matchFootnotesToBlocks([{ id: "fn-9", marker: "9" }], [{ id: "a", text: "no marker here" }]).length).toBe(0);
  });

  // Non-numeric or missing markers are skipped entirely.
  it("skips non-numeric or missing markers entirely", () => {
    expect(matchFootnotesToBlocks([{ id: "fn-x", marker: "*" }], [{ id: "a", text: "text1 more" }]).length).toBe(0);
    expect(matchFootnotesToBlocks([{ id: "fn-x", marker: null }], [{ id: "a", text: "text1 more" }]).length).toBe(0);
  });

  // A Bekker fragment ("1166b7") is never mistaken for a marker reference.
  it('never mistakes a Bekker fragment ("1166b7") for a marker reference', () => {
    expect(
      matchFootnotesToBlocks([{ id: "fn-7", marker: "7" }], [{ id: "a", text: "compare NE 9.4.1166b7 and the surrounding discussion" }]).length,
    ).toBe(0);
  });

  // A marker is never matched inside a longer number (marker 1 vs "1150").
  it('never matches a marker inside a longer number (marker 1 vs "1150")', () => {
    expect(
      matchFootnotesToBlocks([{ id: "fn-1", marker: "1" }], [{ id: "a", text: "see 1150b29 for the reference" }]).length,
    ).toBe(0);
  });

  // A two-digit marker hanging off a real word anchors when unique.
  it("anchors a two-digit marker hanging off a real word when it is unique", () => {
    const matches = matchFootnotesToBlocks([{ id: "fn-11", marker: "11" }], [
      { id: "a", text: "the vicious soul11 is described in stark contrast" },
    ]);
    expect(matches.length).toBe(1);
    expect(matches[0].blockId).toBe("a");
  });
});
