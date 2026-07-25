import assert from "node:assert/strict";
import { filterUntranscribableOverlaps, resolveEditionForeignSpans, type ResolvedForeignSpanRow } from "./foreignSpans";

/**
 * Pure module, no `@ice/db`/DB import — run with
 *   pnpm --filter web exec tsx apps/web/src/lib/foreignSpans.test.ts
 * (same convention as `graphEdgeCategory.test.ts`).
 */

function row(overrides: Partial<ResolvedForeignSpanRow> & Pick<ResolvedForeignSpanRow, "id" | "textBlockId">): ResolvedForeignSpanRow {
  return {
    sourceText: "abg",
    originalText: "αβγ",
    startOffset: 4,
    endOffset: 7,
    prefix: "See ",
    suffix: " here.",
    transliteration: "alpha beta gamma",
    translation: "the letters alpha, beta, gamma",
    languageCode: "el",
    languageLabel: "Ancient Greek",
    direction: "ltr",
    script: "greek",
    translationProvenance: "machine_translation",
    sourceProvenanceKind: "pdf_glyph_recovery",
    sourceProvenanceLabel: "PDF display-glyph mapping recovery",
    sourceConfidence: 0.85,
    transcriptionStatus: "recovered",
    ...overrides,
  };
}

// 1. Exact bounds/substring match: emitted as-is.
{
  const blockText = "See abg here.";
  const blockTextById = new Map([["block-1", blockText]]);
  const { spans, recoveredRangesByBlock } = resolveEditionForeignSpans(blockTextById, [
    row({ id: "span-1", textBlockId: "block-1" }),
  ]);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.startOffset, 4);
  assert.equal(spans[0]!.endOffset, 7);
  assert.equal(spans[0]!.translation, "the letters alpha, beta, gamma");
  assert.deepEqual(recoveredRangesByBlock.get("block-1"), [{ start: 4, end: 7 }]);
}

// 2. Stored offsets stale (block text shifted) but the exact substring is
//    still uniquely present — relocated via matchForeignSpan, not dropped.
{
  const blockText = "A preface was added. See abg here.";
  const blockTextById = new Map([["block-1", blockText]]);
  const { spans } = resolveEditionForeignSpans(blockTextById, [
    // startOffset/endOffset point at the OLD (pre-preface) location.
    row({ id: "span-1", textBlockId: "block-1", startOffset: 4, endOffset: 7 }),
  ]);
  assert.equal(spans.length, 1);
  const relocatedStart = blockText.indexOf("abg");
  assert.equal(spans[0]!.startOffset, relocatedStart);
  assert.equal(spans[0]!.endOffset, relocatedStart + 3);
}

// 3. Relocation fails (source text no longer present at all) — dropped,
//    never attached to the wrong phrase.
{
  const blockText = "The passage was rewritten entirely.";
  const blockTextById = new Map([["block-1", blockText]]);
  const { spans } = resolveEditionForeignSpans(blockTextById, [
    row({ id: "span-1", textBlockId: "block-1" }),
  ]);
  assert.equal(spans.length, 0);
}

// 4. Block id not present at all (a row from a different run's blocks) —
//    dropped, not a crash.
{
  const blockTextById = new Map([["block-2", "unrelated text"]]);
  const { spans } = resolveEditionForeignSpans(blockTextById, [
    row({ id: "span-1", textBlockId: "block-1" }),
  ]);
  assert.equal(spans.length, 0);
}

// 5. No translation content — dropped (only rows with translation content
//    are ever emitted, per the plan).
{
  const blockText = "See abg here.";
  const blockTextById = new Map([["block-1", blockText]]);
  const { spans } = resolveEditionForeignSpans(blockTextById, [
    row({ id: "span-1", textBlockId: "block-1", translation: "" }),
    row({ id: "span-2", textBlockId: "block-1", translation: null }),
  ]);
  assert.equal(spans.length, 0);
}

// 6. A `legitimate` (not `recovered`) resolved row never contributes to
//    `recoveredRangesByBlock` — only a genuinely recovered span should ever
//    suppress an untranscribable marker.
{
  const blockText = "The concept ἀρετὴ appears.";
  const blockTextById = new Map([["block-1", blockText]]);
  const { spans, recoveredRangesByBlock } = resolveEditionForeignSpans(blockTextById, [
    row({
      id: "span-1",
      textBlockId: "block-1",
      sourceText: "ἀρετὴ",
      originalText: "ἀρετὴ",
      startOffset: 12,
      endOffset: 17,
      transcriptionStatus: "legitimate",
      sourceProvenanceKind: "source_text",
      sourceProvenanceLabel: "extracted source text",
      sourceConfidence: 1,
    }),
  ]);
  assert.equal(spans.length, 1);
  assert.equal(recoveredRangesByBlock.has("block-1"), false);
}

// filterUntranscribableOverlaps: drops an overlapping span, keeps a disjoint one.
{
  const untranscribableSpans = [
    { start: 4, end: 7, reason: "private_use" },
    { start: 20, end: 25, reason: "script_mixture" },
  ];
  const kept = filterUntranscribableOverlaps(untranscribableSpans, [{ start: 4, end: 7 }]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.start, 20);
}

// filterUntranscribableOverlaps: no recovered ranges for this block — passes
// every span through unchanged.
{
  const untranscribableSpans = [{ start: 0, end: 3, reason: "private_use" }];
  const kept = filterUntranscribableOverlaps(untranscribableSpans, undefined);
  assert.deepEqual(kept, untranscribableSpans);
}

console.log("foreignSpans.test.ts: all assertions passed");
