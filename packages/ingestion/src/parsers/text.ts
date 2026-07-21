import type { ParsedDocument } from "./pdf";

const NOTE_LINE = /^\s*(?:\[?(\d{1,4}|[ivxlcdm]+)\]?[.)]|(\*+))\s+(.+)$/i;
const HEADING = /^\s*(?:#{1,6}\s+.+|(?:notes?|endnotes?|references|bibliography|works cited)\s*:?)\s*$/i;
const CAPTION = /^\s*(?:figure|fig\.?|table)\s+\d+[.:]/i;

/** Conservative source-text structure. It is deliberately still marked
 * structure-limited: line patterns cannot assert page-layout truth. Where a
 * trailing notes section is recognizable, however, its content is kept out
 * of body blocks so it cannot be duplicated into the processed transcript. */
function splitSourceBlocks(text: string) {
  const lines = text.split("\n");
  const blocks: NonNullable<ParsedDocument["pages"][number]["blocks"]>[number][] = [];
  let apparatus: "footnote" | "endnote" | "bibliography" | null = null;
  let body: string[] = [];
  const flushBody = () => {
    const value = body.join("\n").trim();
    if (value) blocks.push({ kind: "body", text: value });
    body = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLocaleLowerCase();
    if (/^(notes?|endnotes?)\s*:?$/.test(lower)) {
      flushBody();
      blocks.push({ kind: "header", text: trimmed });
      apparatus = "endnote";
      continue;
    }
    if (/^(references|bibliography|works cited)\s*:?$/.test(lower)) {
      flushBody();
      blocks.push({ kind: "header", text: trimmed });
      apparatus = "bibliography";
      continue;
    }
    if (HEADING.test(trimmed) && trimmed) {
      flushBody();
      blocks.push({ kind: blocks.length === 0 && trimmed.startsWith("#") ? "title" : "header", text: trimmed.replace(/^#+\s*/, "") });
      apparatus = null;
      continue;
    }
    const note = trimmed.match(NOTE_LINE);
    if (apparatus === "endnote" && note) {
      flushBody();
      blocks.push({ kind: "endnote", marker: note[1] ?? note[2], text: trimmed });
      continue;
    }
    if (apparatus === "bibliography" && trimmed) {
      flushBody();
      blocks.push({ kind: "bibliography", text: trimmed });
      continue;
    }
    if (CAPTION.test(trimmed)) {
      flushBody();
      blocks.push({ kind: "caption", text: trimmed });
      continue;
    }
    body.push(line);
  }
  flushBody();
  return blocks.length ? blocks : [{ kind: "body" as const, text }];
}

export function parseText(buffer: Buffer, mimeType: string): ParsedDocument {
  const sourceText = buffer.toString("utf-8");
  const firstLine = sourceText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && l.length < 200);

  const detectedTitle =
    mimeType === "text/markdown" && firstLine?.startsWith("#")
      ? firstLine.replace(/^#+\s*/, "")
      : (firstLine ?? null);

  const blocks = splitSourceBlocks(sourceText);
  const text = blocks
    .filter((block) => block.kind === "title" || block.kind === "header" || block.kind === "body" || block.kind === "caption")
    .map((block) => block.text)
    .join("\n\n");
  return {
    text: text || sourceText,
    detectedTitle,
    detectedAuthor: null,
    // Keep exact source bytes in page.text; the structural transcript above is
    // an explicitly limited processing view, never a replacement source file.
    pages: [{ pageIndex: 0, text: sourceText, blocks, isOcr: false, extractionConfidence: 1 }],
    structureState: "limited",
    metadataConfidence: detectedTitle ? 0.65 : 0,
  };
}
