import { describe, expect, it } from "vitest";
import { matchNoteToBlock } from "./matchNoteToBlock";

const note = (quote: string | null) => ({ id: "note-1", evidence: { quote } });

describe("matchNoteToBlock", () => {
  it("anchors a note to the one block whose text contains its quote", () => {
    expect(
      matchNoteToBlock(note("reason subordinated"), [
        { id: "a", text: "No match here." },
        { id: "b", text: "Irwin reads vice as reason subordinated to antecedent inclination." },
      ]),
    ).toEqual({ noteId: "note-1", blockId: "b", quote: "reason subordinated", offset: 20 });
  });

  it("returns null when more than one block matches", () => {
    expect(
      matchNoteToBlock(note("same phrase"), [
        { id: "a", text: "The same phrase appears here." },
        { id: "b", text: "The same phrase appears there." },
      ]),
    ).toBe(null);
  });

  it("returns null when no block contains the quote", () => {
    expect(matchNoteToBlock(note("missing"), [{ id: "a", text: "Different text." }])).toBe(null);
  });

  it("returns null when the note has no quote at all", () => {
    expect(matchNoteToBlock(note(null), [{ id: "a", text: "Any text." }])).toBe(null);
  });
});
