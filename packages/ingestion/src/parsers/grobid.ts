export interface GrobidBlock {
  kind: "title" | "header" | "body" | "footnote" | "bibliography" | "reference";
  text: string;
  pageIndex?: number;
}

export interface GrobidResult {
  title: string | null;
  authors: string[];
  blocks: GrobidBlock[];
  tei: string;
}

const decodeXml = (value: string) => value.replaceAll(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">") .replaceAll(/\s+/g, " ").trim();
const matches = (xml: string, expression: RegExp) => [...xml.matchAll(expression)].map((match) => decodeXml(match[1] ?? "")).filter(Boolean);

/** Local, opt-in GROBID adapter. Missing configuration deliberately means
 * disabled, never a failed upload or a public-document transfer. */
export async function processWithGrobid(buffer: Buffer): Promise<GrobidResult | null> {
  const baseUrl = process.env.GROBID_URL?.replace(/\/$/, "");
  if (!baseUrl) return null;
  const body = new FormData();
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  body.append("input", new Blob([bytes], { type: "application/pdf" }), "document.pdf");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${baseUrl}/api/processFulltextDocument`, { method: "POST", body, signal: controller.signal });
    if (!response.ok) return null;
    const tei = await response.text();
    if (!tei.includes("<TEI")) return null;
    const title = matches(tei, /<title[^>]*type=["']main["'][^>]*>([\s\S]*?)<\/title>/i)[0] ?? matches(tei, /<title[^>]*>([\s\S]*?)<\/title>/i)[0] ?? null;
    const authors = matches(tei, /<persName[^>]*>([\s\S]*?)<\/persName>/gi);
    const blocks: GrobidBlock[] = [
      ...(title ? [{ kind: "title" as const, text: title }] : []),
      ...matches(tei, /<head[^>]*>([\s\S]*?)<\/head>/gi).map((text) => ({ kind: "header" as const, text })),
      ...matches(tei, /<p[^>]*>([\s\S]*?)<\/p>/gi).map((text) => ({ kind: "body" as const, text })),
      ...matches(tei, /<note[^>]*>([\s\S]*?)<\/note>/gi).map((text) => ({ kind: "footnote" as const, text })),
      ...matches(tei, /<biblStruct[^>]*>([\s\S]*?)<\/biblStruct>/gi).map((text) => ({ kind: "reference" as const, text })),
    ];
    return { title, authors: [...new Set(authors)], blocks, tei };
  } catch { return null; } finally { clearTimeout(timeout); }
}
