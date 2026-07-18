import type { ParsedDocument } from "./pdf";

export function parseText(buffer: Buffer, mimeType: string): ParsedDocument {
  const text = buffer.toString("utf-8");
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && l.length < 200);

  const detectedTitle =
    mimeType === "text/markdown" && firstLine?.startsWith("#")
      ? firstLine.replace(/^#+\s*/, "")
      : (firstLine ?? null);

  return { text, detectedTitle, detectedAuthor: null };
}
