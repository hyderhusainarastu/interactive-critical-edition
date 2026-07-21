import type { PassageAnnotation, PassageBlockInput } from "./passageAnnotations";

/** Hard limits approved for v4 section-aware annotation. */
export const V4_ANNOTATION_MAX_CHARS_PER_CHUNK = 12_000;
export const V4_ANNOTATION_MAX_CHUNKS_PER_WORK = 8;

export interface SectionAwareBlock extends PassageBlockInput {
  pageIndex: number;
  blockOrder: number;
  sectionTitle: string | null;
}

export interface SectionAnnotationChunk {
  blocks: PassageBlockInput[];
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
  totalChars: number;
}

function normalizedSectionTitle(value: string | null): string {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";
}

/**
 * Keep chunks section-aware and bounded. A single oversized structural block
 * is clipped rather than discarded, so every part of a long work can receive
 * coverage while the model never sees more than the approved prompt budget.
 */
export function chunkSectionAwareBlocks(
  blocks: readonly SectionAwareBlock[],
  maxChars = V4_ANNOTATION_MAX_CHARS_PER_CHUNK,
  maxChunks = V4_ANNOTATION_MAX_CHUNKS_PER_WORK,
): SectionAnnotationChunk[] {
  const chunks: SectionAnnotationChunk[] = [];
  let current: SectionAnnotationChunk | null = null;
  let currentSection = "";

  const flush = () => {
    if (current && current.blocks.length > 0) chunks.push(current);
    current = null;
  };

  for (const block of blocks) {
    if (chunks.length >= maxChunks) break;
    const text = block.text.trim();
    if (!text) continue;
    const section = normalizedSectionTitle(block.sectionTitle);
    const visibleText = text.slice(0, maxChars);
    const startsSection = current !== null && section !== currentSection;
    const wouldOverflow = current !== null && current.totalChars + visibleText.length > maxChars;
    if (startsSection || wouldOverflow) flush();
    if (chunks.length >= maxChunks) break;

    if (!current) {
      current = {
        blocks: [],
        sectionTitle: block.sectionTitle?.trim() || null,
        pageStart: block.pageIndex,
        pageEnd: block.pageIndex,
        totalChars: 0,
      };
      currentSection = section;
    }
    const remaining = Math.max(0, maxChars - current.totalChars);
    if (remaining === 0) continue;
    current.blocks.push({ blockId: block.blockId, text: visibleText.slice(0, remaining) });
    current.totalChars += Math.min(visibleText.length, remaining);
    current.pageEnd = block.pageIndex;
  }
  if (chunks.length < maxChunks) flush();
  return chunks.slice(0, maxChunks);
}

function normalizedQuote(value: string | null): string {
  return value?.toLocaleLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function quoteOverlap(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const leftWords = new Set(left.split(" ").filter((word) => word.length > 3));
  const rightWords = new Set(right.split(" ").filter((word) => word.length > 3));
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared++;
  return shared >= 4 && shared / Math.min(leftWords.size, rightWords.size) >= 0.7;
}

/**
 * Retain the strongest annotation where two chunk calls explain the same
 * anchored passage. Whole-work guidance dedupes by normalized summary; an
 * anchored note only competes with another note in the same text block.
 */
export function dedupePassageAnnotations(annotations: readonly PassageAnnotation[]): PassageAnnotation[] {
  const output: PassageAnnotation[] = [];
  for (const annotation of annotations) {
    const matchIndex = output.findIndex((existing) => {
      if (existing.isWholeWork || annotation.isWholeWork) {
        return existing.isWholeWork && annotation.isWholeWork && existing.summary.trim().toLocaleLowerCase() === annotation.summary.trim().toLocaleLowerCase();
      }
      return existing.blockId === annotation.blockId && quoteOverlap(normalizedQuote(existing.quote), normalizedQuote(annotation.quote));
    });
    if (matchIndex === -1) {
      output.push(annotation);
    } else if (annotation.confidence > output[matchIndex].confidence) {
      output[matchIndex] = annotation;
    }
  }
  return output;
}

export function annotationScope(
  annotation: PassageAnnotation,
  blocksById: ReadonlyMap<string, SectionAwareBlock>,
): { sectionTitle: string | null; pageIndex: number | null; blockOrder: number | null } {
  const block = annotation.blockId ? blocksById.get(annotation.blockId) : undefined;
  return {
    sectionTitle: block?.sectionTitle ?? null,
    pageIndex: block?.pageIndex ?? null,
    blockOrder: block?.blockOrder ?? null,
  };
}
