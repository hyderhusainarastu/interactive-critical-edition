import { z } from "zod";

export type ProseMirrorText = { type: "text"; text: string };
/** `heading`'s own optional level, unchanged from before Phase 28.5. */
export type ProseMirrorHeadingAttrs = { level?: 1 | 2 | 3 };
/**
 * Phase 28.5 (Writer evidence insertion): a `blockquote` node produced by
 * the Evidence panel's "Insert" action carries the research claim it came
 * from, never bare quoted text with no traceable source. `excerpt` is a
 * denormalized copy of the node's own `content` text — kept on `attrs` too
 * so the citation/anchor machinery can read it without re-parsing `content`.
 * `workTitle` is nullable: a corpus-item-sourced claim may have no owned
 * `work` at all (see `research_claim`'s `work_id`/`corpus_item_id` XOR).
 */
export type ProseMirrorEvidenceAttrs = { researchClaimId: string; excerpt: string; workTitle: string | null };
export type ProseMirrorBlock = {
  type: "paragraph" | "heading" | "blockquote";
  attrs?: ProseMirrorHeadingAttrs | ProseMirrorEvidenceAttrs;
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
const headingAttrsSchema = z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }).strict();
/** Phase 28.5: the shape `buildEvidenceBlockquote()` writes — see
 *  `ProseMirrorEvidenceAttrs`'s doc comment for why `workTitle` is nullable. */
const evidenceAttrsSchema = z.object({
  researchClaimId: z.string().uuid(),
  excerpt: z.string().min(1).max(20_000),
  workTitle: z.string().max(2_000).nullable(),
}).strict();
const blockSchema = z.object({
  type: z.enum(["paragraph", "heading", "blockquote"]),
  // A union, not one shared shape: `blockquote` nodes written by the
  // Evidence panel carry `evidenceAttrsSchema`, while `paragraph`/`heading`
  // keep the pre-existing `{level}` shape. Without this widening,
  // `proseMirrorDocumentSchema.safeParse` would reject ANY document
  // containing an evidence blockquote, and `proseMirrorToPlainText` (which
  // calls `safeParse` and returns `""` on failure) would silently blank out
  // the entire draft the next time it loaded — not just drop the quote.
  attrs: z.union([headingAttrsSchema, evidenceAttrsSchema]).optional(),
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

/**
 * Phase 28.5: the Evidence panel's "Insert" node — a real ProseMirror
 * `blockquote`, not plain appended text (unlike the pre-existing MLA
 * `insertCitation` helper). `excerpt` must be the claim's own
 * `supporting_excerpt` (a literal, re-verified substring of the source),
 * never paraphrased or model-generated at insert time.
 */
export function buildEvidenceBlockquote(params: { researchClaimId: string; excerpt: string; workTitle: string | null }): ProseMirrorBlock {
  return {
    type: "blockquote",
    attrs: { researchClaimId: params.researchClaimId, excerpt: params.excerpt, workTitle: params.workTitle },
    content: [{ type: "text", text: params.excerpt }],
  };
}

/** A plain, visible marker paragraph — used when an evidence insertion has
 *  no resolvable citation ("citation unresolved") or no locatable passage
 *  ("passage not currently locatable"), so the gap is honest and visible
 *  rather than silently absent. */
export function buildEvidenceMarker(text: string): ProseMirrorBlock {
  return { type: "paragraph", content: [{ type: "text", text }] };
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

/**
 * Phase 28.5: pure honesty gate + CSL construction for citing a research
 * claim's OWN source work, split from the DB read the same way `@ice/roadmap`
 * is split from `lib/roadmap.ts`'s traversal (`docs/PROJECT-LOG.md` Design
 * Decisions) — the fields here are already-fetched real `bibliographic_record`
 * columns (the self-matched-by-title record `lib/research/chambers.ts`'s
 * `loadPositionSourceCredibility` also reads), never anything model-generated.
 *
 * A bare title is deliberately NOT treated as a "resolvable" identity on its
 * own: `bibliographic_record.title` always exists once ANY record matched,
 * so gating on title alone would make the "no resolvable identity" branch
 * unreachable and defeat the honesty check this exists to enforce. At least
 * one of author/year/DOI/URL must also be present.
 */
export function buildCslFromWorkBibliographicFields(fields: {
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
}): CslJson | null {
  if (!fields.authors && !fields.year && !fields.doi && !fields.url) return null;
  return normalizeCslJson({
    type: "book",
    title: fields.title,
    author: fields.authors ? [{ literal: fields.authors }] : undefined,
    issued: fields.year ? { "date-parts": [[fields.year]] } : undefined,
    DOI: fields.doi ?? undefined,
    URL: fields.url ?? undefined,
  });
}

/** Same honesty gate as above, applied to a `research_corpus_item`'s own
 *  provider-supplied fields (never model-generated — plan §Schema's
 *  `research_corpus_item` doc comment: "no model writes to
 *  `research_corpus_item`"). `authors` is the provider's raw display-name
 *  array; non-string entries are dropped rather than guessed at. */
export function buildCslFromCorpusItemFields(fields: {
  title: string;
  authors: unknown;
  year: number | null;
  doi: string | null;
  url: string | null;
  venue: string | null;
}): CslJson | null {
  const authorNames = Array.isArray(fields.authors) ? fields.authors.filter((value): value is string => typeof value === "string") : [];
  if (!authorNames.length && !fields.year && !fields.doi && !fields.url) return null;
  return normalizeCslJson({
    type: "article-journal",
    title: fields.title,
    author: authorNames.map((name) => ({ literal: name })),
    issued: fields.year ? { "date-parts": [[fields.year]] } : undefined,
    DOI: fields.doi ?? undefined,
    URL: fields.url ?? undefined,
    "container-title": fields.venue ?? undefined,
  });
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
