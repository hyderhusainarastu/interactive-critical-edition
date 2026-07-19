import type { ParsedDocument, ParsedPage } from "./pdf";

type EpubInstance = {
  metadata?: { title?: string; creator?: string };
  flow?: Array<{ id: string }>;
  parse(): void;
  on(event: "end" | "error", callback: (error?: Error) => void): void;
  getChapter(id: string, callback: (error: Error | null, text?: string) => void): void;
};

const asText = (html: string) => html.replaceAll(/<[^>]+>/g, " ").replaceAll(/\s+/g, " ").trim();

/** DRM-free EPUB parser. epub2 reads only the supplied archive; encrypted or
 * malformed EPUBs produce a normal processing failure, never a bypass. */
export async function parseEpub(buffer: Buffer): Promise<ParsedDocument> {
  const imported = await import("epub2") as unknown as { EPub: new (input: Buffer) => EpubInstance };
  const epub = new imported.EPub(buffer);
  await new Promise<void>((resolve, reject) => {
    epub.on("end", () => resolve());
    epub.on("error", (error) => reject(error ?? new Error("Unable to parse EPUB.")));
    epub.parse();
  });
  const chapters = await Promise.all((epub.flow ?? []).map((chapter) => new Promise<string>((resolve, reject) => {
    epub.getChapter(chapter.id, (error, html) => error ? reject(error) : resolve(asText(html ?? "")));
  })));
  const pages: ParsedPage[] = chapters.filter(Boolean).map((text, pageIndex) => ({
    pageIndex,
    text,
    blocks: [{ kind: "body", text }],
    isOcr: false,
    extractionConfidence: 1,
  }));
  const text = pages.map((page) => page.text).join("\n\n");
  return {
    text,
    detectedTitle: epub.metadata?.title?.trim() || null,
    detectedAuthor: epub.metadata?.creator?.trim() || null,
    pages,
    structureState: "limited",
    metadataConfidence: epub.metadata?.title ? 0.9 : 0,
  };
}
