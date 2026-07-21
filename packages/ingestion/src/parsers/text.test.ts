import { describe, expect, it } from "vitest";
import { parseText } from "./text";

describe("parseText structural limits", () => {
  it("separates a recognizable endnotes and bibliography section from processed body text", () => {
    const parsed = parseText(Buffer.from("# Main title\n\nBody [1].\n\nNotes\n1. Source note.\n\nReferences\nAuthor. Work."), "text/markdown");
    expect(parsed.structureState).toBe("limited");
    expect(parsed.pages[0].blocks.map((block) => block.kind)).toEqual(["title", "body", "header", "endnote", "header", "bibliography"]);
    expect(parsed.text).toContain("Body [1].");
    expect(parsed.text).not.toContain("Source note.");
    expect(parsed.text).not.toContain("Author. Work.");
    expect(parsed.pages[0].text).toContain("Source note.");
  });
});
