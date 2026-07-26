import { describe, expect, it } from "vitest";
import { detectFootnotes } from "./footnotes";

describe("detectFootnotes", () => {
  it("finds a trailing run of numbered notes cross-checked against in-body [N] markers", () => {
    const text = [
      "The author argues this point at length [1], returning to it later [2].",
      "",
      "A closing paragraph with no further citations.",
      "",
      "1. First note, expanding on the opening claim.",
      "2. Second note, a bibliographic reference.",
    ].join("\n");

    const notes = detectFootnotes(text);
    expect(notes).toEqual([
      { marker: "1", content: "First note, expanding on the opening claim." },
      { marker: "2", content: "Second note, a bibliographic reference." },
    ]);
  });

  it("also matches (N)-style in-body markers", () => {
    const text = ["The claim is made here (1).", "", "1. A note explaining the claim."].join("\n");
    expect(detectFootnotes(text)).toEqual([{ marker: "1", content: "A note explaining the claim." }]);
  });

  it("keeps a single trailing numbered line when it has a real in-body marker", () => {
    const text = ["Body text making a claim [1] and stopping there.", "", "1. The only note."].join("\n");
    expect(detectFootnotes(text)).toEqual([{ marker: "1", content: "The only note." }]);
  });

  it("drops a numbered candidate with no corresponding in-body marker", () => {
    const text = ["Body text with a citation [1].", "", "1. Real note.", "2. No marker anywhere for this one."].join(
      "\n",
    );
    expect(detectFootnotes(text)).toEqual([{ marker: "1", content: "Real note." }]);
  });

  it("does not mistake a trailing table of contents for footnotes (negative case)", () => {
    // A table of contents is shaped exactly like a footnote block (trailing
    // consecutive numbered lines) but its numbers are section labels, not
    // cross-referenced anywhere in body text as [N]/(N) markers.
    const text = [
      "This document has no numbered in-text citations at all — it is prose",
      "that happens to end with a numbered outline.",
      "",
      "1. Introduction",
      "2. Method",
      "3. Results",
      "4. Discussion",
    ].join("\n");
    expect(detectFootnotes(text)).toEqual([]);
  });

  it("returns nothing when there is no trailing numbered run at all", () => {
    const text = "Just an ordinary paragraph of prose with no notes section.";
    expect(detectFootnotes(text)).toEqual([]);
  });
});
