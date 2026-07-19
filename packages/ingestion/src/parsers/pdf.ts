import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { processWithGrobid } from "./grobid";
import { ocrLowTextPages } from "./ocr";

export interface ParsedPage {
  pageIndex: number;
  text: string;
  blocks: Array<{ kind: "title" | "header" | "body" | "footnote" | "bibliography" | "reference"; text: string }>;
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

/**
 * Text-layer PDF extraction via unpdf (pdf.js under the hood, per plan
 * §5/§10). Scanned/OCR PDFs aren't handled here — Phase 2 scope is
 * text-layer only; a near-empty extraction result is the signal a
 * later OCR fallback (plan §10 step 3) would act on.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text: mergedText } = await extractText(pdf, { mergePages: true });
  const { text: perPageText } = await extractText(pdf, { mergePages: false }) as { text: string[] };
  const text = mergedText;

  let detectedTitle: string | null = null;
  let detectedAuthor: string | null = null;
  try {
    const meta = await getMeta(pdf);
    const info = meta.info as Record<string, unknown>;
    if (typeof info.Title === "string" && info.Title.trim()) {
      detectedTitle = info.Title.trim();
    }
    if (typeof info.Author === "string" && info.Author.trim()) {
      detectedAuthor = info.Author.trim();
    }
  } catch {
    // Metadata is best-effort — absence isn't a parse failure.
  }

  if (!detectedTitle) {
    const firstLine = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && l.length < 200);
    detectedTitle = firstLine ?? null;
  }

  const grobid = await processWithGrobid(buffer);
  const pages: ParsedPage[] = perPageText.map((pageText, pageIndex) => ({
    pageIndex,
    text: pageText,
    blocks: [{ kind: "body" as const, text: pageText }],
    isOcr: false,
    extractionConfidence: pageText.trim().length > 40 ? 1 : null,
  }));
  const ocr = await ocrLowTextPages(pdf, perPageText);
  for (const result of ocr) {
    const page = pages[result.pageIndex];
    if (!page) continue;
    page.text = result.text;
    page.blocks = [{ kind: "body", text: result.text }];
    page.isOcr = true;
    page.extractionConfidence = result.confidence === null ? null : result.confidence / 100;
  }
  if (grobid) {
    detectedTitle = grobid.title ?? detectedTitle;
    detectedAuthor = grobid.authors[0] ?? detectedAuthor;
    for (const block of grobid.blocks) {
      const index = Math.min(block.pageIndex ?? 0, Math.max(0, pages.length - 1));
      if (pages[index]) pages[index].blocks.push({ kind: block.kind, text: block.text });
    }
  }
  return { text, detectedTitle, detectedAuthor, pages, structureState: grobid ? "full" : "limited", metadataConfidence: grobid?.title ? 0.95 : detectedTitle ? 0.65 : 0 };
}
