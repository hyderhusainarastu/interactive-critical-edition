import type { CslJson, CslName } from "../writer";

/**
 * Phase 29.3 (reverse-direction ScholarLens port): BibTeX/RIS/APA/Chicago
 * citation export, adapted from `_format_bibtex`/`_format_ris`/`_format_apa`/
 * `_format_chicago` in ScholarLens's `api.py` (owner-licensed, see
 * docs/architecture/scholarlens-integration-plan.md) to operate on this
 * project's CSL-JSON shape (`writer.ts`'s `CslJson`) instead of ScholarLens's
 * `paper` model, alongside the existing `mlaWorksCited`/`mlaParenthetical`.
 *
 * Every formatter here is a pure function of one `CslJson` record. Fields
 * that aren't present are omitted from the output — nothing is invented
 * (no "Unknown Author", no fabricated year) except where a citation style's
 * own convention calls for a specific placeholder for "author unknown" or
 * "no date" (BibTeX/RIS have no such convention, so those two formats never
 * emit one); see `cslToBibTeX`'s missing-required-field comment for the one
 * place a gap is called out explicitly rather than silently.
 */

export type CitationExportFormat = "bibtex" | "ris" | "apa" | "chicago";

export const CITATION_EXPORT_FORMATS: readonly CitationExportFormat[] = ["bibtex", "ris", "apa", "chicago"];

export const CITATION_EXPORT_CONTENT_TYPE: Record<CitationExportFormat, string> = {
  bibtex: "application/x-bibtex; charset=utf-8",
  ris: "application/x-research-info-systems; charset=utf-8",
  apa: "text/plain; charset=utf-8",
  chicago: "text/plain; charset=utf-8",
};

export const CITATION_EXPORT_EXTENSION: Record<CitationExportFormat, string> = {
  bibtex: "bib",
  ris: "ris",
  apa: "txt",
  chicago: "txt",
};

function year(citation: CslJson): number | undefined {
  return citation.issued?.["date-parts"]?.[0]?.[0];
}

/** A name's surname for keying/sorting: the real family name, else a whole
 * literal (organizations, single-token names), else the given name as a
 * last resort — never fabricated. */
function surname(name?: CslName): string {
  return name?.family || name?.literal || name?.given || "";
}

function alnumOnly(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// BibTeX
// ---------------------------------------------------------------------------

const BIBTEX_ENTRY_TYPE: Record<string, string> = {
  book: "book",
  chapter: "incollection",
  "article-journal": "article",
  article: "article",
};

/** Required fields per BibTeX entry type, keyed by the label used in the
 * missing-field comment. `container-title` plays two roles depending on
 * entry type (journal name for an article, book title for a chapter) — see
 * the `journal`/`booktitle` branch below. */
const BIBTEX_REQUIRED_FIELDS: Record<string, string[]> = {
  article: ["author", "title", "journal", "year"],
  incollection: ["author", "title", "booktitle", "publisher", "year"],
  book: ["author", "title", "publisher", "year"],
  misc: ["title"],
};

function bibtexEscape(value: string): string {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function bibtexAuthorName(name: CslName): string {
  if (name.literal) return name.literal;
  if (name.family && name.given) return `${name.family}, ${name.given}`;
  return name.family || name.given || "";
}

function bibtexKey(citation: CslJson): string {
  const author = alnumOnly(surname(citation.author?.[0]));
  const y = year(citation);
  const firstWord = alnumOnly(citation.title.split(/\s+/)[0] ?? "");
  const key = `${author}${y ?? ""}${firstWord}`;
  return key || "citation";
}

function bibtexPages(page?: string): string | undefined {
  return page ? page.replace(/\s*-+\s*/g, "--") : undefined;
}

export function cslToBibTeX(citation: CslJson): string {
  const entryType = BIBTEX_ENTRY_TYPE[citation.type] ?? "misc";
  const required = BIBTEX_REQUIRED_FIELDS[entryType] ?? BIBTEX_REQUIRED_FIELDS.misc;

  const authorField = citation.author?.length ? citation.author.map(bibtexAuthorName).filter(Boolean).join(" and ") : undefined;
  const y = year(citation);
  const container = citation["container-title"];

  const rawFields: Array<[string, string | undefined]> = [
    ["title", citation.title],
    ["author", authorField],
    entryType === "article" ? ["journal", container] : entryType === "incollection" ? ["booktitle", container] : ["journal", undefined],
    ["publisher", entryType === "incollection" || entryType === "book" ? citation.publisher : undefined],
    ["year", y !== undefined ? String(y) : undefined],
    ["volume", citation.volume],
    ["number", citation.issue],
    ["pages", bibtexPages(citation.page)],
    ["doi", citation.DOI],
    ["isbn", citation.ISBN],
    ["url", citation.URL],
  ];
  const fields = rawFields.filter((entry): entry is [string, string] => entry[1] !== undefined);

  const present = new Set(fields.map(([field]) => field));
  const missing = required.filter((field) => !present.has(field));
  const comment = missing.length ? `% Missing required BibTeX field(s) for this ${entryType} entry: ${missing.join(", ")}\n` : "";

  const body = fields.map(([field, value]) => `  ${field} = {${bibtexEscape(value)}},`).join("\n");
  return `${comment}@${entryType}{${bibtexKey(citation)},\n${body}\n}`;
}

// ---------------------------------------------------------------------------
// RIS
// ---------------------------------------------------------------------------

const RIS_TYPE: Record<string, string> = {
  book: "BOOK",
  chapter: "CHAP",
  "article-journal": "JOUR",
  article: "JOUR",
  webpage: "ELEC",
};

function risAuthorName(name: CslName): string {
  if (name.literal) return name.literal;
  if (name.family && name.given) return `${name.family}, ${name.given}`;
  return name.family || name.given || "";
}

function risLine(tag: string, value: string | undefined): string | undefined {
  return value ? `${tag}  - ${value}` : undefined;
}

export function cslToRIS(citation: CslJson): string {
  const type = RIS_TYPE[citation.type] ?? "GEN";
  const y = year(citation);
  const [pageStart, pageEnd] = citation.page ? citation.page.split(/\s*-+\s*/, 2) : [undefined, undefined];

  const lines = [
    risLine("TY", type),
    risLine("TI", citation.title),
    ...(citation.author ?? []).map((author) => risLine("AU", risAuthorName(author))),
    risLine("PY", y !== undefined ? String(y) : undefined),
    risLine(type === "JOUR" ? "JO" : "T2", citation["container-title"]),
    risLine("VL", citation.volume),
    risLine("IS", citation.issue),
    risLine("SP", pageStart),
    risLine("EP", pageEnd),
    risLine("PB", citation.publisher),
    risLine("DO", citation.DOI),
    risLine("SN", citation.ISBN),
    risLine("UR", citation.URL),
    "ER  - ",
  ].filter((line): line is string => line !== undefined);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Shared author-list helpers (APA / Chicago)
// ---------------------------------------------------------------------------

function initialsFor(given: string): string {
  return given
    .trim()
    .split(/\s+/)
    .map((word) => word.split("-").map((part) => (part ? `${part[0]?.toUpperCase()}.` : "")).join("-"))
    .join(" ");
}

/** "Family, G." for a real family name (with initials for the given name),
 * else the literal/given name as-is — never inventing an initial for a name
 * with no given-name data. */
function apaName(name: CslName): string {
  if (name.literal) return name.literal;
  if (!name.family) return name.given ?? "";
  const initials = name.given ? initialsFor(name.given) : undefined;
  return initials ? `${name.family}, ${initials}` : name.family;
}

function apaAuthorList(authors?: CslName[]): string | undefined {
  if (!authors?.length) return undefined;
  const names = authors.map(apaName).filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;
  // APA 7: first 19 authors, ellipsis, then the final author.
  return `${names.slice(0, 19).join(", ")}, ... ${names.at(-1)}`;
}

function doiOrUrl(citation: CslJson): string | undefined {
  if (citation.DOI) return `https://doi.org/${citation.DOI.replace(/^https?:\/\/doi\.org\//i, "")}`;
  return citation.URL;
}

// ---------------------------------------------------------------------------
// APA
// ---------------------------------------------------------------------------

function apaContainer(citation: CslJson): string | undefined {
  if (citation["container-title"]) {
    const issueNumbering = citation.volume ? `, ${citation.volume}${citation.issue ? `(${citation.issue})` : ""}` : "";
    const pages = citation.page ? `, ${citation.page}` : "";
    return `${citation["container-title"]}${issueNumbering}${pages}.`;
  }
  if (citation.publisher) return `${citation.publisher}.`;
  return undefined;
}

export function cslToAPA(citation: CslJson): string {
  const author = apaAuthorList(citation.author);
  const y = year(citation);
  const parts = [
    author,
    y !== undefined ? `(${y}).` : undefined,
    // Without an author, APA moves the title into the author position; it is
    // not italicized/quoted either way in this plain-text export.
    `${citation.title}.`,
    apaContainer(citation),
    doiOrUrl(citation),
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Chicago (author-date)
// ---------------------------------------------------------------------------

function chicagoName(name: CslName, first: boolean): string {
  if (name.literal) return name.literal;
  if (!name.family) return name.given ?? "";
  if (!first) return `${name.given ?? ""} ${name.family}`.trim();
  // A dangling ", " with nothing after it (a family name with no given
  // name — common for classical/single-name authors) must not leak into
  // the output as a trailing comma.
  return name.given ? `${name.family}, ${name.given}` : name.family;
}

/** Chicago's "A, B, and C" join needs the Oxford "and" only before the final
 * name (and only among <=3 authors — 4+ collapses to "First et al."), which
 * a plain Array#join can't express, so it's built explicitly. */
function chicagoAuthorList(authors?: CslName[]): string | undefined {
  if (!authors?.length) return undefined;
  if (authors.length === 1) return chicagoName(authors[0], true);
  if (authors.length <= 3) {
    const names = authors.map((author, index) => chicagoName(author, index === 0)).filter(Boolean);
    return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
  }
  return `${chicagoName(authors[0], true)} et al.`;
}

function chicagoContainer(citation: CslJson): string | undefined {
  if (citation["container-title"]) {
    const volumeIssue = citation.volume ? ` ${citation.volume}${citation.issue ? ` (${citation.issue})` : ""}` : "";
    const pages = citation.page ? `: ${citation.page}` : "";
    const prefix = citation.type === "chapter" ? "In " : "";
    return `${prefix}${citation["container-title"]}${volumeIssue}${pages}.`;
  }
  if (citation.publisher) return `${citation.publisher}.`;
  return undefined;
}

export function cslToChicago(citation: CslJson): string {
  const author = chicagoAuthorList(citation.author);
  const y = year(citation);
  const link = doiOrUrl(citation);
  const parts = [
    author,
    y !== undefined ? `${y}.` : undefined,
    `“${citation.title}.”`,
    chicagoContainer(citation),
    link ? `${link}.` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Combining / list export
// ---------------------------------------------------------------------------

const FORMATTERS: Record<CitationExportFormat, (citation: CslJson) => string> = {
  bibtex: cslToBibTeX,
  ris: cslToRIS,
  apa: cslToAPA,
  chicago: cslToChicago,
};

/** Renders a full export body for a list of citations, honoring an empty
 * list (produces an empty string rather than throwing or emitting an
 * empty/malformed entry). */
export function formatCitationList(citations: CslJson[], format: CitationExportFormat): string {
  return citations.map(FORMATTERS[format]).join("\n\n");
}
