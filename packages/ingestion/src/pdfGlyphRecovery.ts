import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import {
  detectForeignScriptSpans,
  type ForeignScript,
  type ForeignSpanProvenance,
} from "./foreignText";

export interface PdfGlyphRecoveryCandidate {
  pageIndex: number;
  extractedText: string;
  recoveredText: string;
  script: ForeignScript;
  originalCharCodes: number[];
  provenance: ForeignSpanProvenance & {
    kind: "pdf_glyph_recovery";
    method: "pdfjs_operator_font_char";
    automatic: false;
  };
}

interface PdfGlyph {
  unicode?: unknown;
  fontChar?: unknown;
  originalCharCode?: unknown;
}

function glyphString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0x10ffff) {
    return String.fromCodePoint(value);
  }
  return null;
}

/**
 * Inspects pdf.js's public operator list for the narrow case where the
 * display-font character is valid foreign script but broken ToUnicode maps
 * the same glyph to different extracted text.
 *
 * This is a candidate seam, not an automatic rewrite. It cannot recover a
 * custom embedded font whose operator glyph exposes only PUA/Latin values,
 * and it never guesses from glyph shape. Callers should prefer source text,
 * then configured OCR (for example `OCR_LANGUAGE=eng+ell`), and persist a
 * candidate only with the provenance below. Otherwise the honest
 * untranscribable marker remains.
 */
export async function inspectPdfGlyphRecoveryCandidates(
  buffer: Buffer,
): Promise<PdfGlyphRecoveryCandidate[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pdfjs = await getResolvedPDFJS();
  const candidates: PdfGlyphRecoveryCandidate[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const operators = await page.getOperatorList() as {
      fnArray: number[];
      argsArray: unknown[][];
    };
    for (let index = 0; index < operators.fnArray.length; index += 1) {
      const op = operators.fnArray[index];
      if (op !== pdfjs.OPS.showText && op !== pdfjs.OPS.showSpacedText) continue;
      const glyphs = operators.argsArray[index]?.[0];
      if (!Array.isArray(glyphs)) continue;

      let extractedText = "";
      let recoveredText = "";
      const originalCharCodes: number[] = [];
      for (const rawGlyph of glyphs) {
        if (typeof rawGlyph === "number") continue; // spacing adjustment
        const glyph = rawGlyph as PdfGlyph;
        const extracted = glyphString(glyph.unicode);
        const recovered = glyphString(glyph.fontChar);
        if (!extracted || !recovered) continue;
        extractedText += extracted;
        recoveredText += recovered;
        if (typeof glyph.originalCharCode === "number") originalCharCodes.push(glyph.originalCharCode);
      }
      if (!extractedText || !recoveredText || extractedText === recoveredText) continue;

      const recoveredSpans = detectForeignScriptSpans(recoveredText);
      if (recoveredSpans.length !== 1) continue;
      const [span] = recoveredSpans;
      if (span!.start !== 0 || span!.end !== recoveredText.length) continue;
      const extractedSpans = detectForeignScriptSpans(extractedText);
      if (extractedSpans.some((candidate) => candidate.script === span!.script)) continue;

      candidates.push({
        pageIndex: pageNumber - 1,
        extractedText,
        recoveredText,
        script: span!.script,
        originalCharCodes,
        provenance: {
          kind: "pdf_glyph_recovery",
          label: "PDF display-glyph mapping recovery",
          confidence: 0.85,
          method: "pdfjs_operator_font_char",
          automatic: false,
        },
      });
    }
  }
  return candidates;
}
