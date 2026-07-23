import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { type GrobidBbox, type GrobidResult, processWithGrobid } from "./grobid";
import { ocrLowTextPages } from "./ocr";

export interface ParsedBlock {
  kind: "title" | "header" | "body" | "footer" | "footnote" | "endnote" | "caption" | "bibliography" | "reference";
  text: string;
  marker?: string;
  bbox?: GrobidBbox | null;
}

export interface ParsedPage {
  pageIndex: number;
  text: string;
  blocks: ParsedBlock[];
  isOcr: boolean;
  extractionConfidence: number | null;
}

export interface ParsedDocument {
  text: string;
  detectedTitle: string | null;
  detectedAuthor: string | null;
  pages: ParsedPage[];
  structureState: "full" | "limited";
  metadataConfidence: number;
}

/** Build the reader/analysis transcript only from prose-bearing structural
 * blocks. Authorial notes and bibliography remain persisted and addressable,
 * but never get silently folded into the processed body transcript. */
export function processedTextFromPages(pages: readonly ParsedPage[]): string {
  return pages
    .flatMap((page) => page.blocks)
    .filter((block) => block.kind === "title" || block.kind === "header" || block.kind === "body" || block.kind === "caption")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Merge per-page texts into one document string. Rebuilt from the final page
 *  texts (which include any OCR results) so scanned PDFs whose text layer was
 *  empty still produce non-empty document text (plan 1.4). */
export function mergePageTexts(pageTexts: string[]): string {
  return pageTexts.map((t) => t.trim()).filter(Boolean).join("\n\n");
}

/**
 * D-20-67: a title recovered from a body heading (GROBID's header-author
 * guard rejected the header's own title — see `parsers/grobid.ts`) is real
 * structural evidence, but it is a heuristic fallback rather than GROBID's
 * own header judgment, so it is deliberately kept below the `autoReady`
 * confidence threshold (0.9, see `apps/worker/src/extraction.ts`) — the
 * document still goes to `needs_review` for a human to confirm, rather than
 * asserting a second guess with the same false certainty as the first one
 * that caused this defect. A plain PDF-metadata/first-line fallback (no
 * GROBID title at all) stays at its prior, already-sub-threshold value.
 */
export function metadataConfidenceFor(titleSource: GrobidResult["titleSource"] | undefined, hasFallbackTitle: boolean): number {
  if (titleSource === "header") return 0.95;
  if (titleSource === "body-heading") return 0.7;
  return hasFallbackTitle ? 0.65 : 0;
}

/**
 * PDF extraction via unpdf (pdf.js). Text-layer pages are read directly; pages
 * whose layer is sparse are rendered and OCR'd (scanned documents). When a
 * local GROBID service is configured, its TEI structure (headings, footnotes,
 * bibliography, coordinates) is layered onto the pages and the run is marked
 * "full"; otherwise the honest "limited" (PDF.js block) state is used.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text: mergedText } = await extractText(pdf, { mergePages: true });
  const { text: perPageText } = (await extractText(pdf, { mergePages: false })) as { text: string[] };

  let detectedTitle: string | null = null;
  let detectedAuthor: string | null = null;
  try {
    const meta = await getMeta(pdf);
    const info = meta.info as Record<string, unknown>;
    if (typeof info.Title === "string" && info.Title.trim()) detectedTitle = info.Title.trim();
    if (typeof info.Author === "string" && info.Author.trim()) detectedAuthor = info.Author.trim();
  } catch {
    // Metadata is best-effort — absence isn't a parse failure.
  }

  const pages: ParsedPage[] = perPageText.map((pageText, pageIndex) => ({
    pageIndex,
    text: pageText,
    blocks: pageText.trim() ? [{ kind: "body" as const, text: pageText }] : [],
    isOcr: false,
    extractionConfidence: pageText.trim().length > 40 ? 1 : null,
  }));

  // OCR any sparse pages and fold the recovered text back into BOTH the page
  // record and the merged document text (the previous bug: merged text was
  // taken from the text layer only, so scanned docs stayed empty after OCR).
  const ocr = await ocrLowTextPages(pdf, perPageText);
  for (const result of ocr) {
    const page = pages[result.pageIndex];
    if (!page) continue;
    page.text = result.text;
    page.blocks = [{ kind: "body", text: result.text }];
    page.isOcr = true;
    page.extractionConfidence = result.confidence === null ? null : result.confidence / 100;
  }

  let text = mergePageTexts(pages.map((p) => p.text)) || mergedText.trim();

  if (!detectedTitle) {
    detectedTitle = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && l.length < 200) ?? null;
  }

  const grobid = await processWithGrobid(buffer);
  if (grobid) {
    detectedTitle = grobid.title ?? detectedTitle;
    detectedAuthor = grobid.authors[0] ?? detectedAuthor;
    // A usable TEI result replaces, rather than augments, the PDF.js fallback
    // blocks. Appending was a structural lie: the fallback page body already
    // contains footnote/bibliography glyphs, so appending structured notes
    // showed the same source material twice. PDF.js page text stays on the
    // page record as immutable source evidence; the processed blocks now have
    // one authoritative structural representation.
    const structured = grobid.blocks.filter((block) => block.text.trim().length > 0);
    const hasBody = structured.some((block) => block.kind === "body");
    if (hasBody) {
      for (const page of pages) page.blocks = [];
      for (const block of structured) {
        const index = Math.min(Math.max(block.pageIndex ?? 0, 0), Math.max(0, pages.length - 1));
        const page = pages[index];
        if (page) page.blocks.push({ kind: block.kind, text: block.text, marker: block.marker, bbox: block.bbox });
      }
      text = processedTextFromPages(pages);
    }
  }

  return {
    text,
    detectedTitle,
    detectedAuthor,
    pages,
    // A syntactically valid TEI response without prose blocks is not enough
    // to claim structural fidelity; retain the transparent PDF.js fallback.
    structureState: grobid && processedTextFromPages(pages).length > 0 && grobid.blocks.some((block) => block.kind === "body") ? "full" : "limited",
    metadataConfidence: metadataConfidenceFor(grobid?.title ? grobid.titleSource : undefined, Boolean(detectedTitle)),
  };
}
