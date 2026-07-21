import { z } from "zod";

export type ProseMirrorText = { type: "text"; text: string };
export type ProseMirrorBlock = {
  type: "paragraph" | "heading" | "blockquote";
  attrs?: { level?: 1 | 2 | 3 };
  content?: ProseMirrorText[];
};
export type ProseMirrorDocument = { type: "doc"; content: ProseMirrorBlock[] };

export type CslName = { family?: string; given?: string; literal?: string };
export type CslJson = {
  id?: string;
  type: string;
  title: string;
  author?: CslName[];
  issued?: { "date-parts"?: number[][] };
  DOI?: string;
  ISBN?: string;
  URL?: string;
  "container-title"?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
};

const textSchema = z.object({ type: z.literal("text"), text: z.string().max(20_000) }).strict();
const blockSchema = z.object({
  type: z.enum(["paragraph", "heading", "blockquote"]),
  attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }).strict().optional(),
  content: z.array(textSchema).max(1_000).optional(),
}).strict();

export const proseMirrorDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(blockSchema).min(1).max(10_000),
}).strict().superRefine((value, context) => {
  const characters = value.content.reduce((total, block) => total + (block.content ?? []).reduce((sum, node) => sum + node.text.length, 0), 0);
  if (characters > 1_000_000) context.addIssue({ code: "custom", message: "Document is too large." });
});

export const cslJsonSchema = z.object({
  id: z.string().max(256).optional(),
  type: z.string().min(1).max(80),
  title: z.string().min(1).max(2_000),
  author: z.array(z.object({ family: z.string().max(500).optional(), given: z.string().max(500).optional(), literal: z.string().max(1_000).optional() }).strict()).max(100).optional(),
  issued: z.object({ "date-parts": z.array(z.array(z.number().int().min(-4000).max(9999)).min(1).max(3)).max(1).optional() }).strict().optional(),
  DOI: z.string().max(512).optional(),
  ISBN: z.string().max(128).optional(),
  URL: z.string().max(2_000).optional(),
  "container-title": z.string().max(2_000).optional(),
  publisher: z.string().max(2_000).optional(),
  volume: z.string().max(100).optional(),
  issue: z.string().max(100).optional(),
  page: z.string().max(200).optional(),
}).strict();

export function emptyWriterDocument(): ProseMirrorDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function plainTextToProseMirror(value: string): ProseMirrorDocument {
  const content = value.replace(/\r\n?/g, "\n").split("\n").map((text) => ({
    type: "paragraph" as const,
    ...(text ? { content: [{ type: "text" as const, text }] } : {}),
  }));
  return { type: "doc", content: content.length ? content : emptyWriterDocument().content };
}

export function proseMirrorToPlainText(value: unknown): string {
  const parsed = proseMirrorDocumentSchema.safeParse(value);
  if (!parsed.success) return "";
  return parsed.data.content.map((block) => (block.content ?? []).map((node) => node.text).join("")).join("\n");
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : undefined;
}

function normalizeName(value: unknown): CslName | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const family = clean(candidate.family ?? candidate.lastName);
  const given = clean(candidate.given ?? candidate.firstName);
  const literal = clean(candidate.literal ?? candidate.name);
  return family || given || literal ? { ...(family ? { family } : {}), ...(given ? { given } : {}), ...(literal && !family ? { literal } : {}) } : undefined;
}

export function normalizeCslJson(value: unknown): CslJson | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = clean(raw.title);
  if (!title) return null;
  const authorRaw = Array.isArray(raw.author) ? raw.author : Array.isArray(raw.authors) ? raw.authors : [];
  const author = authorRaw.map(normalizeName).filter((name): name is CslName => Boolean(name));
  const issuedRaw = raw.issued as Record<string, unknown> | undefined;
  const dateParts = Array.isArray(issuedRaw?.["date-parts"])
    ? issuedRaw?.["date-parts"] as number[][]
    : typeof raw.published === "string" && /^\d{4}/.test(raw.published) ? [[Number(raw.published.slice(0, 4))]] : undefined;
  const candidate: CslJson = {
    ...(clean(raw.id) ? { id: clean(raw.id) } : {}),
    type: clean(raw.type) ?? "article",
    title,
    ...(author.length ? { author } : {}),
    ...(dateParts ? { issued: { "date-parts": dateParts } } : {}),
    ...(clean(raw.DOI ?? raw.doi) ? { DOI: clean(raw.DOI ?? raw.doi) } : {}),
    ...(clean(raw.ISBN ?? raw.isbn) ? { ISBN: clean(raw.ISBN ?? raw.isbn) } : {}),
    ...(clean(raw.URL ?? raw.url) ? { URL: clean(raw.URL ?? raw.url) } : {}),
    ...(clean(raw["container-title"] ?? raw.containerTitle ?? raw.journal) ? { "container-title": clean(raw["container-title"] ?? raw.containerTitle ?? raw.journal) } : {}),
    ...(clean(raw.publisher) ? { publisher: clean(raw.publisher) } : {}),
    ...(clean(raw.volume) ? { volume: clean(raw.volume) } : {}),
    ...(clean(raw.issue ?? raw.number) ? { issue: clean(raw.issue ?? raw.number) } : {}),
    ...(clean(raw.page ?? raw.pages) ? { page: clean(raw.page ?? raw.pages) } : {}),
  };
  return cslJsonSchema.safeParse(candidate).success ? candidate : null;
}

export function citationKey(citation: CslJson): string {
  return (citation.DOI?.toLowerCase() || citation.ISBN?.replace(/[-\s]/g, "") || `${citation.title}|${citation.author?.[0]?.family ?? ""}|${citation.issued?.["date-parts"]?.[0]?.[0] ?? ""}`).slice(0, 500);
}

function nameForMla(name?: CslName): string {
  if (!name) return "";
  return name.family || name.literal || name.given || "";
}

export function mlaParenthetical(citation: CslJson, locator?: string): string {
  const author = nameForMla(citation.author?.[0]);
  return `(${[author || shortTitle(citation.title), clean(locator)].filter(Boolean).join(" ")})`;
}

function shortTitle(title: string): string {
  const words = title.split(/\s+/).slice(0, 4).join(" ");
  return words || "Untitled";
}

function mlaName(name?: CslName, first = true): string {
  if (!name) return "";
  if (name.literal) return name.literal;
  if (!name.family) return name.given ?? "";
  return first ? `${name.family}, ${name.given ?? ""}`.trim() : `${name.given ?? ""} ${name.family}`.trim();
}

export function mlaWorksCited(citation: CslJson): string {
  const authors = citation.author?.map((author, index) => mlaName(author, index === 0)).filter(Boolean).join(", ");
  const year = citation.issued?.["date-parts"]?.[0]?.[0];
  const publication = [citation["container-title"], citation.volume ? `vol. ${citation.volume}` : undefined, citation.issue ? `no. ${citation.issue}` : undefined, year ? String(year) : undefined, citation.page ? `pp. ${citation.page}` : undefined].filter(Boolean).join(", ");
  const terminal = citation.DOI ? `https://doi.org/${citation.DOI.replace(/^https?:\/\/doi\.org\//i, "")}` : citation.URL;
  return [authors, authors ? `“${citation.title}."` : `“${citation.title}."`, publication ? `${publication}.` : citation.publisher ? `${citation.publisher}${year ? `, ${year}` : ""}.` : undefined, terminal].filter(Boolean).join(" ");
}

export function sortMlaCitations(citations: CslJson[]): CslJson[] {
  return [...citations].sort((left, right) => nameForMla(left.author?.[0]).localeCompare(nameForMla(right.author?.[0])) || left.title.localeCompare(right.title));
}

export function parseBibtex(input: string): CslJson[] {
  // End at the next entry (or EOF), not the first `}`: regular BibTeX
  // fields like `title={...}` contain braces themselves.
  const entries = [...input.matchAll(/@([a-zA-Z]+)\s*\{\s*([^,]+),([\s\S]*?)(?=\n\s*@|$)/g)];
  return entries.flatMap(([, rawType, id, body]) => {
    const fields = Object.fromEntries([...body.matchAll(/(\w+)\s*=\s*(?:\{([^{}]*)\}|"([^"]*)"|([^,\n}]+))/g)].map(([, key, braced, quoted, bare]) => [key.toLowerCase(), (braced ?? quoted ?? bare).trim()]));
    const author = String(fields.author ?? "").split(/\s+and\s+/i).filter(Boolean).map((value) => {
      const [family, given] = value.includes(",") ? value.split(/,\s*/, 2) : [value.split(/\s+/).at(-1), value.split(/\s+/).slice(0, -1).join(" ")];
      return { family: family?.trim(), given: given?.trim() };
    });
    const normalized = normalizeCslJson({
      id,
      type: rawType.toLowerCase() === "book" ? "book" : rawType.toLowerCase() === "incollection" ? "chapter" : "article-journal",
      title: fields.title,
      author,
      issued: fields.year ? { "date-parts": [[Number(fields.year)]] } : undefined,
      DOI: fields.doi,
      ISBN: fields.isbn,
      URL: fields.url,
      "container-title": fields.journal ?? fields.booktitle,
      publisher: fields.publisher,
      volume: fields.volume,
      issue: fields.number,
      page: fields.pages,
    });
    return normalized ? [normalized] : [];
  });
}

export function parseRis(input: string): CslJson[] {
  const records = input.split(/(?:^|\n)ER\s{2}-\s*/).map((record) => record.trim()).filter(Boolean);
  return records.flatMap((record) => {
    const fields = new Map<string, string[]>();
    for (const [, tag, value] of record.matchAll(/(?:^|\n)([A-Z0-9]{2})\s{2}-\s*(.*)/g)) fields.set(tag, [...(fields.get(tag) ?? []), value.trim()]);
    const year = fields.get("PY")?.[0]?.match(/\d{4}/)?.[0] ?? fields.get("Y1")?.[0]?.match(/\d{4}/)?.[0];
    const authors = (fields.get("AU") ?? []).map((value) => {
      const [family, given] = value.includes(",") ? value.split(/,\s*/, 2) : [value, undefined];
      return { family, given };
    });
    const type = fields.get("TY")?.[0] === "BOOK" ? "book" : "article-journal";
    const normalized = normalizeCslJson({
      type,
      title: fields.get("TI")?.[0] ?? fields.get("T1")?.[0],
      author: authors,
      issued: year ? { "date-parts": [[Number(year)]] } : undefined,
      DOI: fields.get("DO")?.[0],
      ISBN: fields.get("SN")?.[0],
      URL: fields.get("UR")?.[0],
      "container-title": fields.get("JO")?.[0] ?? fields.get("T2")?.[0],
      publisher: fields.get("PB")?.[0],
      volume: fields.get("VL")?.[0],
      issue: fields.get("IS")?.[0],
      page: fields.get("SP")?.[0] && fields.get("EP")?.[0] ? `${fields.get("SP")?.[0]}-${fields.get("EP")?.[0]}` : fields.get("SP")?.[0],
    });
    return normalized ? [normalized] : [];
  });
}
