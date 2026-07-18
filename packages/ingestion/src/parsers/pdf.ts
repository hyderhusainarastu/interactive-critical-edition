import { extractText, getDocumentProxy, getMeta } from "unpdf";

export interface ParsedDocument {
  text: string;
  detectedTitle: string | null;
  detectedAuthor: string | null;
}

/**
 * Text-layer PDF extraction via unpdf (pdf.js under the hood, per plan
 * §5/§10). Scanned/OCR PDFs aren't handled here — Phase 2 scope is
 * text-layer only; a near-empty extraction result is the signal a
 * later OCR fallback (plan §10 step 3) would act on.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });

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

  return { text, detectedTitle, detectedAuthor };
}
