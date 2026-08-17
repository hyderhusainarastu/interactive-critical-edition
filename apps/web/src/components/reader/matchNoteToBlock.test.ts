import assert from "node:assert/strict";
import { matchNoteToBlock } from "./matchNoteToBlock";

const note = (quote: string | null) => ({ id: "note-1", evidence: { quote } });

assert.deepEqual(
  matchNoteToBlock(note("reason subordinated"), [
    { id: "a", text: "No match here." },
    { id: "b", text: "Irwin reads vice as reason subordinated to antecedent inclination." },
  ]),
  { noteId: "note-1", blockId: "b", quote: "reason subordinated", offset: 20 },
);

assert.equal(
  matchNoteToBlock(note("same phrase"), [
    { id: "a", text: "The same phrase appears here." },
    { id: "b", text: "The same phrase appears there." },
  ]),
  null,
);

assert.equal(matchNoteToBlock(note("missing"), [{ id: "a", text: "Different text." }]), null);
assert.equal(matchNoteToBlock(note(null), [{ id: "a", text: "Any text." }]), null);
