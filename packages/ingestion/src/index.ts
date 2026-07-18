import { parsePdf, type ParsedDocument } from "./parsers/pdf";
import { parseText } from "./parsers/text";

export type { ParsedDocument } from "./parsers/pdf";
export { detectFootnotes, type DetectedFootnote } from "./parsers/footnotes";
export { extractCitations, type RawCitation, type CitationKind } from "./parsers/citations";
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
    default:
      throw new Error(`Unsupported MIME type for parsing: ${mimeType}`);
  }
}
