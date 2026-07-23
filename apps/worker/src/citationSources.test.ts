import { describe, expect, it } from "vitest";
import type { ExtractedAuthorApparatus } from "@ice/ingestion";
import { buildStructuralCitationSources } from "./citationSources";

function apparatusEntry(overrides: Partial<ExtractedAuthorApparatus>): ExtractedAuthorApparatus {
  return {
    textBlockId: "block-1",
    kind: "endnote",
    marker: "1",
    text: "Some Author, Some Title (2001).",
    scope: { pageIndex: 3, blockOrder: 5 },
    source: "structure",
    recovered: false,
    ...overrides,
  };
}

describe("buildStructuralCitationSources (D-20-91)", () => {
  it("excludes a recovered endnote from citation sources", () => {
    const sources = buildStructuralCitationSources({
      apparatus: [apparatusEntry({ kind: "endnote", recovered: true, source: "structure" })],
    });
    expect(sources).toEqual([]);
  });

  it("includes a GROBID-native (non-recovered) endnote exactly as before", () => {
    const sources = buildStructuralCitationSources({
      apparatus: [apparatusEntry({ kind: "endnote", recovered: false, source: "structure" })],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ sourceType: "endnote", text: "Some Author, Some Title (2001).", parserConfidence: 0.98 });
  });

  it("never excludes a footnote or bibliography entry, even if (hypothetically) flagged recovered", () => {
    const sources = buildStructuralCitationSources({
      apparatus: [
        apparatusEntry({ kind: "footnote", recovered: true, source: "structure" }),
        apparatusEntry({ kind: "bibliography_entry", recovered: true, source: "structure" }),
      ],
    });
    expect(sources.map((s) => s.sourceType).sort()).toEqual(["bibliography", "footnote"]);
  });

  it("still includes body blocks as inline citation sources, unaffected by the apparatus filter", () => {
    const sources = buildStructuralCitationSources({
      bodyBlocks: [{ id: "body-1", text: "Body text with an inline reference.", pageIndex: 0, blockOrder: 0 }],
      apparatus: [apparatusEntry({ kind: "endnote", recovered: true })],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ sourceType: "inline", textBlockId: "body-1" });
  });

  it("drops a citation_block apparatus entry (no sourceType mapping) exactly as before, independent of recovered", () => {
    const sources = buildStructuralCitationSources({
      apparatus: [apparatusEntry({ kind: "citation_block", recovered: false })],
    });
    expect(sources).toEqual([]);
  });

  it("mixed run: only the recovered endnote is excluded, the GROBID-native endnote and a bibliography entry both survive", () => {
    const sources = buildStructuralCitationSources({
      apparatus: [
        apparatusEntry({ textBlockId: "recovered-1", kind: "endnote", recovered: true }),
        apparatusEntry({ textBlockId: "native-1", kind: "endnote", recovered: false }),
        apparatusEntry({ textBlockId: "bib-1", kind: "bibliography_entry", recovered: false }),
      ],
    });
    expect(sources.map((s) => s.textBlockId).sort()).toEqual(["bib-1", "native-1"]);
  });
});
