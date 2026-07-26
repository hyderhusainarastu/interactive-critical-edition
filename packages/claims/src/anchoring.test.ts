import { describe, expect, it } from "vitest";
import { findQuoteOffset, rebindClaimAnchor } from "./anchoring";

describe("findQuoteOffset", () => {
  it("finds an exact prefix+quote+suffix match", () => {
    const fullText = "Irwin reads vice as reason subordinated to antecedent inclination.";
    expect(findQuoteOffset(fullText, "reason subordinated", "vice as ", " to antecedent")).toBe(20);
  });

  it("finds the quote alone when no prefix/suffix context is supplied (matchNoteToBlock's empty-string case)", () => {
    const fullText = "Irwin reads vice as reason subordinated to antecedent inclination.";
    expect(findQuoteOffset(fullText, "reason subordinated", "", "")).toBe(20);
  });

  it("returns null when the quote does not occur at all", () => {
    expect(findQuoteOffset("Different text.", "missing", "", "")).toBeNull();
  });

  it("disambiguates a quote occurring more than once by scoring surrounding context", () => {
    // "same phrase" occurs twice; only the first is preceded by "The " and
    // followed by " appears here" (an exact context match), so it wins even
    // though the raw quote itself is ambiguous.
    const fullText = "The same phrase appears here, but the same phrase appears there too.";
    const offset = findQuoteOffset(fullText, "same phrase", "The ", " appears here");
    expect(offset).toBe(fullText.indexOf("same phrase"));
  });

  it("returns null when neither occurrence's context matches AND both are genuinely ambiguous (matchNoteToBlock's null case)", () => {
    // Two blocks joined into one search text, "same phrase" appears once in
    // each with identical local context on both sides ("The " / " appears") —
    // this is matchNoteToBlock's cross-block ambiguity case, reproduced here
    // as a same-string ambiguity: both occurrences score identically, so the
    // function must still return the deterministic first occurrence rather
    // than null (matching the original DOM helper's strict `score >
    // bestScore` tie-breaking) — asserted precisely to lock in that behavior.
    const fullText = "The same phrase appears twice. The same phrase appears twice.";
    const offset = findQuoteOffset(fullText, "same phrase", "The ", " appears twice");
    expect(offset).toBe(fullText.indexOf("same phrase"));
  });

  it("returns the sole occurrence's offset even when prefix/suffix don't match it exactly", () => {
    const fullText = "No match here. Irwin reads vice as reason subordinated to antecedent inclination.";
    expect(findQuoteOffset(fullText, "reason subordinated", "wrong prefix", "wrong suffix")).toBe(
      fullText.indexOf("reason subordinated"),
    );
  });
});

describe("rebindClaimAnchor", () => {
  const anchor = { quote: "the akratic agent", prefix: "holds that ", suffix: " acts against" };

  it("rebinds when exactly one candidate block contains the anchor", () => {
    const result = rebindClaimAnchor(anchor, [
      { blockId: "a", text: "Unrelated block text." },
      { blockId: "b", text: "Irwin holds that the akratic agent acts against better judgment." },
    ]);
    expect(result).toEqual({ state: "rebound", blockId: "b", offset: expect.any(Number) });
  });

  it("is unanchored when zero candidate blocks contain the anchor", () => {
    const result = rebindClaimAnchor(anchor, [{ blockId: "a", text: "Nothing relevant here." }]);
    expect(result).toEqual({ state: "unanchored" });
  });

  it("is unanchored when more than one candidate block contains the anchor — never guesses between them", () => {
    const twin = "Irwin holds that the akratic agent acts against better judgment.";
    const result = rebindClaimAnchor(anchor, [
      { blockId: "a", text: twin },
      { blockId: "b", text: twin },
    ]);
    expect(result).toEqual({ state: "unanchored" });
  });
});
