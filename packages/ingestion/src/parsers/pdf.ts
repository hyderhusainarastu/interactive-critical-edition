import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { type GrobidBbox, processWithGrobid } from "./grobid";
import { ocrLowTextPages } from "./ocr";

export interface ParsedBlock {
  kind: "title" | "header" | "body" | "footnote" | "bibliography" | "reference";
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

/** Merge per-page texts into one document string. Rebuilt from the final page
 *  texts (which include any OCR results) so scanned PDFs whose text layer was
 *  empty still produce non-empty document text (plan 1.4). */
export function mergePageTexts(pageTexts: string[]): string {
  return pageTexts.map((t) => t.trim()).filter(Boolean).join("\n\n");
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

  const text = mergePageTexts(pages.map((p) => p.text)) || mergedText.trim();

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
    for (const block of grobid.blocks) {
      if (block.kind === "title") continue; // title captured as metadata, not a page block
      const index = Math.min(Math.max(block.pageIndex ?? 0, 0), Math.max(0, pages.length - 1));
      const page = pages[index];
      if (page) page.blocks.push({ kind: block.kind, text: block.text, marker: block.marker, bbox: block.bbox });
    }
  }

  return {
    text,
    detectedTitle,
    detectedAuthor,
    pages,
    structureState: grobid ? "full" : "limited",
    metadataConfidence: grobid?.title ? 0.95 : detectedTitle ? 0.65 : 0,
  };
}
