import {
  createForeignSpanAnchor,
  detectForeignScriptSpans,
  detectUntranscribableSpans,
  type DetectedForeignSpan,
  type ForeignScript,
  type ForeignSpanProvenance,
  type ForeignTextDirection,
  type UntranscribableSpan,
} from "@ice/ingestion";
// Deep import: `inspectPdfGlyphRecoveryCandidates` is deliberately NOT
// re-exported from `@ice/ingestion`'s barrel (commit 5d91981, "keep PDF probe
// out of web bundle") so `apps/web` never pulls unpdf's PDF probe machinery
// into the client bundle. Only the worker needs it.
import { inspectPdfGlyphRecoveryCandidates } from "@ice/ingestion/src/pdfGlyphRecovery";
import { reportError } from "@ice/observability";

/**
 * Step 1 (free, deterministic) of Workstream D's foreign-text pipeline: find
 * legitimate foreign-script spans in already-extracted block text, and — for
 * a PDF whose source-scan garbage overlaps a recoverable display-glyph
 * mapping — recover the real script from `pdfGlyphRecovery`'s narrow seam.
 * Neither path ever rewrites the block's stored bytes or guesses a language
 * from glyph shape; every row this module produces carries an honest,
 * factual `sourceProvenance` label.
 */

export interface DetectedBlockForeignSpan {
  textBlockId: string;
  /** Exact stored block substring; mojibake bytes for a `recovered` row. */
  sourceText: string;
  /** Original-script text; equals `sourceText` unless recovered. */
  originalText: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  script: ForeignScript;
  languageHint: string;
  direction: ForeignTextDirection;
  sourceProvenance: ForeignSpanProvenance;
  transcriptionStatus: "legitimate" | "recovered";
}

export interface BlockUntranscribableContext {
  textBlockId: string;
  blockText: string;
  untranscribable: UntranscribableSpan[];
}

function anchorFor(blockText: string, start: number, end: number): { prefix: string; suffix: string } {
  const anchor = createForeignSpanAnchor(blockText, { start, end, text: blockText.slice(start, end) });
  return { prefix: anchor.prefix, suffix: anchor.suffix };
}

function toLegitimateSpan(textBlockId: string, blockText: string, span: DetectedForeignSpan): DetectedBlockForeignSpan {
  const anchor = createForeignSpanAnchor(blockText, span);
  return {
    textBlockId,
    sourceText: span.text,
    originalText: span.text,
    startOffset: span.start,
    endOffset: span.end,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    script: span.script,
    languageHint: span.languageHint,
    direction: span.direction,
    sourceProvenance: span.provenance,
    transcriptionStatus: "legitimate",
  };
}

/**
 * Detects legitimate foreign-script spans in one block, excluding whatever
 * `detectUntranscribableSpans` already flagged as source-scan garbage in the
 * SAME block (a garbled word must never also be offered as a translatable
 * foreign-script quote). Returns both, since the untranscribable spans are
 * also this document's recovery-seam input (see `detectRecoveredForeignSpans`).
 */
export function detectLegitimateForeignSpans(
  textBlockId: string,
  blockText: string,
): { untranscribable: UntranscribableSpan[]; spans: DetectedBlockForeignSpan[] } {
  const untranscribable = detectUntranscribableSpans(blockText);
  const detected = detectForeignScriptSpans(blockText, { excludedSpans: untranscribable });
  const spans = detected.map((span) => toLegitimateSpan(textBlockId, blockText, span));
  return { untranscribable, spans };
}

/**
 * Step 1 recovery seam (Brickhouse case): given this document's blocks
 * (each already scanned for untranscribable spans) and the raw PDF bytes,
 * look for a PDF display-glyph mapping recovery candidate
 * (`inspectPdfGlyphRecoveryCandidates`) whose extracted text appears as an
 * EXACT substring overlapping an untranscribable span in exactly ONE block
 * across the whole document. An absent or ambiguous match is skipped, never
 * guessed — recovering the wrong occurrence would be worse than leaving the
 * honest untranscribable marker in place.
 *
 * Never fails extraction: any pdf.js probe error is caught and reported,
 * leaving every untranscribable marker exactly as it was.
 */
export async function detectRecoveredForeignSpans(
  buffer: Buffer,
  blocks: readonly BlockUntranscribableContext[],
): Promise<DetectedBlockForeignSpan[]> {
  if (!blocks.some((block) => block.untranscribable.length > 0)) return [];

  let candidates;
  try {
    candidates = await inspectPdfGlyphRecoveryCandidates(buffer);
  } catch (error) {
    reportError(error, { scope: "worker.foreignSpans.pdfGlyphRecovery" });
    return [];
  }
  if (candidates.length === 0) return [];

  const recovered: DetectedBlockForeignSpan[] = [];
  for (const candidate of candidates) {
    const matches: { textBlockId: string; blockText: string; start: number; end: number }[] = [];
    for (const block of blocks) {
      if (block.untranscribable.length === 0) continue;
      let from = 0;
      for (;;) {
        const start = block.blockText.indexOf(candidate.extractedText, from);
        if (start < 0) break;
        const end = start + candidate.extractedText.length;
        if (block.untranscribable.some((span) => start < span.end && end > span.start)) {
          matches.push({ textBlockId: block.textBlockId, blockText: block.blockText, start, end });
        }
        from = start + 1;
      }
    }
    // Unique match required. Zero matches means this candidate's mojibake
    // isn't actually present in any untranscribable block (nothing to fix);
    // more than one means we cannot tell which occurrence it recovers.
    if (matches.length !== 1) continue;
    const [match] = matches;
    const { prefix, suffix } = anchorFor(match!.blockText, match!.start, match!.end);
    // The recovered text's own script/language-hint/direction, not the
    // candidate's bare `script` field alone — `detectForeignScriptSpans` is
    // the single source of truth for that mapping, and `pdfGlyphRecovery`'s
    // own invariant guarantees exactly one whole-string span here.
    const recoveredInfo = detectForeignScriptSpans(candidate.recoveredText)[0]!;
    recovered.push({
      textBlockId: match!.textBlockId,
      sourceText: candidate.extractedText,
      originalText: candidate.recoveredText,
      startOffset: match!.start,
      endOffset: match!.end,
      prefix,
      suffix,
      script: candidate.script,
      languageHint: recoveredInfo.languageHint,
      direction: recoveredInfo.direction,
      sourceProvenance: candidate.provenance,
      transcriptionStatus: "recovered",
    });
  }
  return recovered;
}
