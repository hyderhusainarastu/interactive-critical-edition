import { describe, expect, it } from "vitest";
import { mergePageTexts } from "./pdf";

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
});
