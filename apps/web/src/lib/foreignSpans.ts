import { matchForeignSpan } from "@ice/ingestion";

/**
 * Pure edition-producer logic for Workstream D's migration-0036-backed
 * `foreign_span` rows (`apps/web/src/lib/edition.ts`'s `getPublishedEdition`).
 * Kept dependency-free (no `@ice/db` import) so it can be unit tested without
 * a database — same reasoning as `roadmapGraph.ts`/`matchNoteToBlock.ts`.
 */

/** The subset of a resolved `foreign_span` row this module needs. Field
 *  names match the Drizzle table 1:1; callers map the query result into this
 *  shape rather than passing raw ORM rows in, so this module never depends
 *  on `@ice/db`'s types. */
export interface ResolvedForeignSpanRow {
  id: string;
  textBlockId: string;
  sourceText: string;
  originalText: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  transliteration: string | null;
  translation: string | null;
  languageCode: string | null;
  languageLabel: string | null;
  direction: "ltr" | "rtl";
  script: "greek" | "hebrew" | "arabic" | "cyrillic" | "cjk";
  translationProvenance: string | null;
  sourceProvenanceKind: "source_text" | "ocr_recovery" | "pdf_glyph_recovery" | "manual";
  sourceProvenanceLabel: string;
  sourceConfidence: number;
  transcriptionStatus: "legitimate" | "recovered";
}

export interface EditionForeignSpanOut {
  id: string;
  textBlockId: string;
  startOffset: number;
  endOffset: number;
  sourceText: string;
  originalText: string;
  transliteration: string;
  translation: string;
  languageCode: string;
  languageLabel: string;
  direction: "ltr" | "rtl";
  script: "greek" | "hebrew" | "arabic" | "cyrillic" | "cjk";
  translationProvenance: "machine_translation";
  sourceProvenance: { kind: ResolvedForeignSpanRow["sourceProvenanceKind"]; label: string; confidence: number };
}

export interface ResolvedEditionForeignSpans {
  spans: EditionForeignSpanOut[];
  /** Recovered-span ranges, keyed by block id — what the untranscribable
   *  filter below subtracts so a recovered span's honest Greek is never
   *  shadowed by its own former "untranscribable" marker. */
  recoveredRangesByBlock: Map<string, Array<{ start: number; end: number }>>;
}

/**
 * Validates/relocates each resolved row against its block's CURRENT stored
 * text (bounds + exact substring first, `matchForeignSpan` relocation as a
 * fallback, drop on failure — never attach a translation to the wrong
 * phrase), and drops any row with no translation content yet (deferred/
 * still-pending rows never reach this function since the caller only
 * queries `status = 'resolved'`, but a defensive check costs nothing).
 */
export function resolveEditionForeignSpans(
  blockTextById: ReadonlyMap<string, string>,
  rows: readonly ResolvedForeignSpanRow[],
): ResolvedEditionForeignSpans {
  const spans: EditionForeignSpanOut[] = [];
  const recoveredRangesByBlock = new Map<string, Array<{ start: number; end: number }>>();

  for (const row of rows) {
    if (!row.translation?.trim() || !row.transliteration?.trim() || !row.languageCode?.trim() || !row.languageLabel?.trim()) {
      continue;
    }
    const blockText = blockTextById.get(row.textBlockId);
    if (blockText === undefined) continue;

    let start = row.startOffset;
    let end = row.endOffset;
    const boundsValid = start >= 0 && end > start && end <= blockText.length;
    const exactMatch = boundsValid && blockText.slice(start, end) === row.sourceText;
    if (!exactMatch) {
      const relocated = matchForeignSpan(blockText, {
        originalText: row.sourceText,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
        prefix: row.prefix,
        suffix: row.suffix,
      });
      if (!relocated) continue; // drop — never attach to the wrong phrase
      start = relocated.start;
      end = relocated.end;
    }

    spans.push({
      id: row.id,
      textBlockId: row.textBlockId,
      startOffset: start,
      endOffset: end,
      sourceText: row.sourceText,
      originalText: row.originalText,
      transliteration: row.transliteration,
      translation: row.translation,
      languageCode: row.languageCode,
      languageLabel: row.languageLabel,
      direction: row.direction,
      script: row.script,
      translationProvenance: "machine_translation",
      sourceProvenance: {
        kind: row.sourceProvenanceKind,
        label: row.sourceProvenanceLabel,
        confidence: row.sourceConfidence,
      },
    });

    if (row.transcriptionStatus === "recovered") {
      const ranges = recoveredRangesByBlock.get(row.textBlockId) ?? [];
      ranges.push({ start, end });
      recoveredRangesByBlock.set(row.textBlockId, ranges);
    }
  }

  return { spans, recoveredRangesByBlock };
}

/**
 * Drops an untranscribable span (recomputed on read, D-23-9) that overlaps a
 * resolved `recovered` foreign span in the same block — otherwise the
 * "untranscribable" chip would shadow the recovered Greek it was recovered
 * from, presenting genuinely-recovered text as unreadable garbage.
 */
export function filterUntranscribableOverlaps<T extends { start: number; end: number }>(
  spans: readonly T[],
  recoveredRanges: readonly { start: number; end: number }[] | undefined,
): T[] {
  if (!recoveredRanges?.length) return [...spans];
  return spans.filter((span) => !recoveredRanges.some((range) => span.start < range.end && span.end > range.start));
}
