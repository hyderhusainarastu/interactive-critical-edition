import { parsePdf, type ParsedDocument } from "./parsers/pdf";
import { parseEpub } from "./parsers/epub";
import { parseText } from "./parsers/text";
import { sanitizeExtractedText } from "./sanitizeText";

export type { ParsedDocument, ParsedPage, ParsedBlock } from "./parsers/pdf";
export { mergePageTexts, processedTextFromPages } from "./parsers/pdf";
export { sanitizeExtractedText } from "./sanitizeText";
export {
  detectUntranscribableSpans,
  type UntranscribableSpan,
  type UntranscribableReason,
} from "./untranscribable";
export {
  FOREIGN_SCRIPTS,
  detectForeignScriptSpans,
  createForeignSpanAnchor,
  matchForeignSpan,
  type ForeignScript,
  type ForeignLanguageHint,
  type ForeignTextDirection,
  type ForeignSpanProvenanceKind,
  type ForeignSpanProvenance,
  type DetectedForeignSpan,
  type ForeignSpanAnchor,
  type MatchedForeignSpan,
} from "./foreignText";
export {
  inspectPdfGlyphRecoveryCandidates,
  type PdfGlyphRecoveryCandidate,
} from "./pdfGlyphRecovery";
export { parseTei, type GrobidResult, type GrobidBlock, type GrobidBbox } from "./parsers/grobid";
export { detectFootnotes, type DetectedFootnote } from "./parsers/footnotes";
export {
  extractCitations,
  extractCitationMentions,
  type RawCitation,
  type CitationKind,
  type CitationSourceType,
  type CitationAnchor,
  type CitationSourceInput,
} from "./parsers/citations";
export {
  extractAuthorApparatus,
  type AuthorApparatusKind,
  type ApparatusBlockInput,
  type ExtractedAuthorApparatus,
} from "./parsers/apparatus";
export { collectBoilerplateLines, isEntirelyBoilerplate } from "./parsers/boilerplate";
export { validateUploadContent, scanWithOptionalClamAv } from "./validation";
export * from "./storage";

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedDocument> {
  const parsed = await (() => {
    switch (mimeType) {
      case "application/pdf":
        return parsePdf(buffer);
      case "text/plain":
      case "text/markdown":
        return parseText(buffer, mimeType);
      case "application/epub+zip":
        return parseEpub(buffer);
      default:
        throw new Error(`Unsupported MIME type for parsing: ${mimeType}`);
    }
  })();
  return sanitizeParsedDocument(parsed);
}

function sanitizeParsedDocument(doc: ParsedDocument): ParsedDocument {
  return {
    ...doc,
    text: sanitizeExtractedText(doc.text),
    detectedTitle: doc.detectedTitle === null ? null : sanitizeExtractedText(doc.detectedTitle),
    detectedAuthor: doc.detectedAuthor === null ? null : sanitizeExtractedText(doc.detectedAuthor),
    pages: doc.pages.map((page) => ({
      ...page,
      text: sanitizeExtractedText(page.text),
      blocks: page.blocks.map((block) => ({
        ...block,
        text: sanitizeExtractedText(block.text),
      })),
    })),
  };
}
