import { describe, expect, it } from "vitest";
import { mergePageTexts, metadataConfidenceFor, processedTextFromPages } from "./pdf";

describe("mergePageTexts (OCR reconstruction)", () => {
  it("joins non-empty page texts into one document string", () => {
    expect(mergePageTexts(["Page one.", "Page two."])).toBe("Page one.\n\nPage two.");
  });

  it("rebuilds document text from OCR-recovered pages", () => {
    // Regression for the scanned-PDF bug: the text layer was empty on every
    // page, then OCR filled them in. The merged document text must reflect the
    // OCR results, not the (empty) text layer.
    const textLayer = ["", "", ""];
    const merged = mergePageTexts(textLayer);
    expect(merged).toBe("");

    const afterOcr = ["Recovered page 1", "", "Recovered page 3"];
    const rebuilt = mergePageTexts(afterOcr);
    expect(rebuilt).toBe("Recovered page 1\n\nRecovered page 3");
    expect(rebuilt.trim().length).toBeGreaterThan(0);
  });

  it("drops whitespace-only pages so they don't create blank separators", () => {
    expect(mergePageTexts(["A", "   ", "\n", "B"])).toBe("A\n\nB");
  });

  it("builds the processed transcript without authorial apparatus duplication", () => {
    // D-24-G1: a caption is included only when it carries a bbox — a genuine,
    // located figure/table caption. A coordinate-less caption (the class GROBID
    // uses for garbled page-bottom footnote fragments it mis-reads as figures)
    // is excluded, so junk never lands at the transcript start.
    const text = processedTextFromPages([
      {
        pageIndex: 0,
        text: "raw PDF page including a footnote",
        isOcr: false,
        extractionConfidence: 1,
        blocks: [
          { kind: "body", text: "The body continues." },
          { kind: "footnote", marker: "1", text: "This is authorial apparatus." },
          { kind: "endnote", marker: "2", text: "So is this." },
          { kind: "bibliography", text: "Author, Work." },
          { kind: "caption", text: "Figure 1. A supporting diagram.", bbox: { page: 1, x: 0, y: 0, w: 10, h: 10 } },
          { kind: "caption", text: "1166bl9-22. garbled footnote fragment mis-read as a figure" },
        ],
      },
    ]);
    expect(text).toContain("The body continues.");
    expect(text).toContain("Figure 1. A supporting diagram.");
    expect(text).not.toContain("garbled footnote fragment");
    expect(text).not.toContain("This is authorial apparatus.");
    expect(text).not.toContain("Author, Work.");
  });
});

describe("metadataConfidenceFor (D-20-67)", () => {
  it("trusts a genuine GROBID header title at the pre-existing high confidence", () => {
    expect(metadataConfidenceFor("header", true)).toBe(0.95);
  });

  it("keeps a recovered body-heading title below the 0.9 autoReady threshold, so it still routes to needs_review", () => {
    const confidence = metadataConfidenceFor("body-heading", true);
    expect(confidence).toBe(0.7);
    expect(confidence).toBeLessThan(0.9);
  });

  it("falls back to the plain-fallback confidence when GROBID produced no usable title at all", () => {
    expect(metadataConfidenceFor(undefined, true)).toBe(0.65);
    expect(metadataConfidenceFor(null, true)).toBe(0.65);
  });

  it("returns 0 when there is no title from any source", () => {
    expect(metadataConfidenceFor(undefined, false)).toBe(0);
  });
});
