import { describe, expect, it } from "vitest";
import { scoreBothDimensions } from "@ice/claims";
import { shouldRenderClaimScoreChips } from "./ClaimScoreChips";

/**
 * Phase 29.3 reverse-direction lane, Item 1: the chip-visibility rule
 * (`shouldRenderClaimScoreChips`) must say "no chip" for a claim neither
 * scorer found any real signal in, and "show chips" the moment at least one
 * dimension carries a real signal — this is the exact predicate
 * `ClaimScoreChips` itself calls, not a re-implemented copy, so this test
 * can't silently drift from the component's real behavior. No DB import
 * here, so no DATABASE_URL is needed — same convention as
 * `annotationMeta.test.ts`/`librarySearch.test.ts`:
 *
 *   pnpm --filter web exec tsx src/components/shared/ClaimScoreChips.test.ts
 */

describe("shouldRenderClaimScoreChips", () => {
  // A claim with no design-tier language, no quantitative signals, no
  // quotation, no locus citation, no rival-reading phrase, no original-
  // language text, no apparatus marker — honestly unscored on both
  // dimensions. `scoreBothDimensions` returns an empty array, so no chip.
  it("plain text with no signals scores nothing on either dimension, so no chip is rendered", () => {
    const scores = scoreBothDimensions("The cat sat on the mat.");
    expect(scores).toEqual([]);
    expect(shouldRenderClaimScoreChips(scores)).toBe(false);
  });

  // Empty/whitespace-only text is the same honest "nothing to score" case.
  it("empty/whitespace-only text is the same honest \"nothing to score\" case", () => {
    const scores = scoreBothDimensions("   ");
    expect(scores).toEqual([]);
    expect(shouldRenderClaimScoreChips(scores)).toBe(false);
  });

  // A claim carrying real empirical-evidence signals (RCT design tier +
  // p-value + sample size + significance language) scores non-trivially on
  // `evidence_strength` — the chip must appear.
  it("a claim with real empirical-evidence signals scores evidence_strength and renders the chip", () => {
    const scores = scoreBothDimensions(
      "This randomized controlled trial found p < 0.001 with n=200 participants, indicating a significant effect.",
    );
    // message: "a claim with real empirical signals scores at least one dimension"
    expect(scores.length >= 1).toBeTruthy();
    // message: "the evidence_strength dimension carries its own named signals"
    expect(scores.some((s) => s.dimension === "evidence_strength" && s.signals.length > 0)).toBeTruthy();
    // message: "a real signal means the chip renders"
    expect(shouldRenderClaimScoreChips(scores)).toBe(true);
  });

  // A claim carrying real humanities-grounding signals (a direct primary-text
  // quotation plus a Bekker locus citation) scores non-trivially on
  // `textual_support` — the chip must appear, and never gets confused with
  // the empirical dimension above (never rendered as one aggregated number).
  it("a claim with real humanities-grounding signals scores textual_support and renders the chip", () => {
    const scores = scoreBothDimensions(
      'As Aristotle states at NE 1151a20, "virtue is a settled disposition of character" — contra the common reading.',
    );
    // message: "a claim with real textual signals scores at least one dimension"
    expect(scores.length >= 1).toBeTruthy();
    const textual = scores.find((s) => s.dimension === "textual_support");
    // message: "the textual_support dimension is present"
    expect(textual).toBeTruthy();
    // message: "the textual_support dimension carries its own named signals"
    expect(textual!.signals.length > 0).toBeTruthy();
    expect(shouldRenderClaimScoreChips(scores)).toBe(true);
  });
});
