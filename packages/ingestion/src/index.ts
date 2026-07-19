import { parsePdf, type ParsedDocument } from "./parsers/pdf";
import { parseEpub } from "./parsers/epub";
import { parseText } from "./parsers/text";

export type { ParsedDocument, ParsedPage, ParsedBlock } from "./parsers/pdf";
export { mergePageTexts } from "./parsers/pdf";
export { parseTei, type GrobidResult, type GrobidBlock, type GrobidBbox } from "./parsers/grobid";
export { detectFootnotes, type DetectedFootnote } from "./parsers/footnotes";
export { extractCitations, type RawCitation, type CitationKind } from "./parsers/citations";
export { validateUploadContent, scanWithOptionalClamAv } from "./validation";
export * from "./storage";

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedDocument> {
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
}
