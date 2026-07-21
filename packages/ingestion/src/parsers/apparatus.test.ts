import { describe, expect, it } from "vitest";
import { extractAuthorApparatus } from "./apparatus";

describe("extractAuthorApparatus", () => {
  it("keeps structural apparatus separate by kind", () => {
    const apparatus = extractAuthorApparatus({
      text: "References\nAristotle, Nicomachean Ethics (1999).",
      blocks: [
        { blockId: "foot", kind: "footnote", text: "1 See Aristotle, Ethics (1999).", pageIndex: 0, blockOrder: 4 },
        { blockId: "refs", kind: "reference", text: "Aristotle, Nicomachean Ethics (1999).", pageIndex: 2, blockOrder: 1 },
      ],
    });
    expect(apparatus.some((entry) => entry.kind === "footnote" && entry.textBlockId === "foot")).toBe(true);
    expect(apparatus.some((entry) => entry.kind === "bibliography_entry" && entry.textBlockId === "refs")).toBe(true);
    expect(apparatus.some((entry) => entry.kind === "citation_block")).toBe(true);
  });

  it("finds numbered endnotes after an endnotes heading", () => {
    const apparatus = extractAuthorApparatus({
      text: "",
      blocks: [
        { blockId: "heading", kind: "header", text: "Endnotes", pageIndex: 3, blockOrder: 0 },
        { blockId: "note", kind: "body", text: "2 Compare Broadie, Ethics with Aristotle (1991).", pageIndex: 3, blockOrder: 1 },
      ],
    });
    expect(apparatus).toMatchObject([{ kind: "endnote", marker: "2", textBlockId: "note" }]);
  });
});
