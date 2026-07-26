import assert from "node:assert/strict";
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

// A claim with no design-tier language, no quantitative signals, no
// quotation, no locus citation, no rival-reading phrase, no original-
// language text, no apparatus marker — honestly unscored on both
// dimensions. `scoreBothDimensions` returns an empty array, so no chip.
{
  const scores = scoreBothDimensions("The cat sat on the mat.");
  assert.deepEqual(scores, [], "plain text with no signals scores nothing on either dimension");
  assert.equal(shouldRenderClaimScoreChips(scores), false, "zero scores means no chip is rendered");
}

// Empty/whitespace-only text is the same honest "nothing to score" case.
{
  const scores = scoreBothDimensions("   ");
  assert.deepEqual(scores, []);
  assert.equal(shouldRenderClaimScoreChips(scores), false);
}

// A claim carrying real empirical-evidence signals (RCT design tier +
// p-value + sample size + significance language) scores non-trivially on
// `evidence_strength` — the chip must appear.
{
  const scores = scoreBothDimensions(
    "This randomized controlled trial found p < 0.001 with n=200 participants, indicating a significant effect.",
  );
  assert.ok(scores.length >= 1, "a claim with real empirical signals scores at least one dimension");
  assert.ok(
    scores.some((s) => s.dimension === "evidence_strength" && s.signals.length > 0),
    "the evidence_strength dimension carries its own named signals",
  );
  assert.equal(shouldRenderClaimScoreChips(scores), true, "a real signal means the chip renders");
}

// A claim carrying real humanities-grounding signals (a direct primary-text
// quotation plus a Bekker locus citation) scores non-trivially on
// `textual_support` — the chip must appear, and never gets confused with
// the empirical dimension above (never rendered as one aggregated number).
{
  const scores = scoreBothDimensions(
    'As Aristotle states at NE 1151a20, "virtue is a settled disposition of character" — contra the common reading.',
  );
  assert.ok(scores.length >= 1, "a claim with real textual signals scores at least one dimension");
  const textual = scores.find((s) => s.dimension === "textual_support");
  assert.ok(textual, "the textual_support dimension is present");
  assert.ok(textual!.signals.length > 0, "the textual_support dimension carries its own named signals");
  assert.equal(shouldRenderClaimScoreChips(scores), true);
}

console.log("ClaimScoreChips.test.ts: all assertions passed");
