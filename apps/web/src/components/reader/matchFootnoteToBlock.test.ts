import assert from "node:assert/strict";
import { matchFootnotesToBlocks } from "./matchFootnoteToBlock";

// An unambiguous single inline reference anchors to that block; the quote is
// the token ending in the marker, re-locatable in the rendered DOM.
{
  const blocks = [
    { id: "a", text: "The opening paragraph mentions nothing numbered." },
    { id: "b", text: "acts expressing intemperance are in accordance with choice3 which matters." },
  ];
  const matches = matchFootnotesToBlocks([{ id: "fn-3", marker: "3" }], blocks);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].blockId, "b");
  assert.equal(matches[0].footnoteId, "fn-3");
  assert.equal(matches[0].quote, "choice3");
  assert.ok(matches[0].prefix.endsWith("with "));
}

// A marker that appears in more than one reference position falls back (null).
{
  const matches = matchFootnotesToBlocks([{ id: "fn-3", marker: "3" }], [
    { id: "a", text: "first callout vice3 here" },
    { id: "b", text: "second callout virtue3 there" },
  ]);
  assert.equal(matches.length, 0);
}

// Zero references → no anchor.
assert.equal(matchFootnotesToBlocks([{ id: "fn-9", marker: "9" }], [{ id: "a", text: "no marker here" }]).length, 0);

// Non-numeric or missing markers are skipped entirely.
assert.equal(matchFootnotesToBlocks([{ id: "fn-x", marker: "*" }], [{ id: "a", text: "text1 more" }]).length, 0);
assert.equal(matchFootnotesToBlocks([{ id: "fn-x", marker: null }], [{ id: "a", text: "text1 more" }]).length, 0);

// A Bekker fragment ("1166b7") is never mistaken for a marker reference.
assert.equal(
  matchFootnotesToBlocks([{ id: "fn-7", marker: "7" }], [{ id: "a", text: "compare NE 9.4.1166b7 and the surrounding discussion" }]).length,
  0,
);

// A marker is never matched inside a longer number (marker 1 vs "1150").
assert.equal(
  matchFootnotesToBlocks([{ id: "fn-1", marker: "1" }], [{ id: "a", text: "see 1150b29 for the reference" }]).length,
  0,
);

// A two-digit marker hanging off a real word anchors when unique.
{
  const matches = matchFootnotesToBlocks([{ id: "fn-11", marker: "11" }], [
    { id: "a", text: "the vicious soul11 is described in stark contrast" },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].blockId, "a");
}
