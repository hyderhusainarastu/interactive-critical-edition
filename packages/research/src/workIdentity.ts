import { canonicalizeDoi, canonicalizeIsbn, titleKey } from "./normalize";
import type { RawResource } from "./types";

/**
 * Canonical work identity — the difference between a *record* and a *work*.
 *
 * Record-level dedup (see `normalize.ts`) collapses two catalogue entries that
 * describe the same artifact. It cannot collapse a book with a review OF that
 * book, or with a different edition of it, because those are genuinely
 * different records with different DOIs, different titles, and different
 * authors. They should all survive as records.
 *
 * But a reader must see ONE Library entry per work. Measured on a real
 * production run over a paper citing eight works, the accepted set contained
 * "Aristotle's Ethical Theory" four times, "Aristotle's Philosophy of Action"
 * five times (including two Japanese-language review articles), and "Ethics
 * with Aristotle" four times — every one of them individually correct.
 *
 * This module answers "which work is this record about?" so the reader gets a
 * single entry with its reviews and editions attached, rather than a list that
 * repeats the same book five times.
 */

/** How a record relates to the work it belongs to. */
export type RecordRole = "primary" | "review" | "edition" | "translation" | "excerpt";

export interface WorkIdentityKey {
  /** Stable key for the WORK (not the record). Records sharing it are one work. */
  key: string;
  /** Best-guess canonical title of the work itself, review framing stripped. */
  canonicalTitle: string;
  /** Surname of the work's author (not the reviewer). */
  authorSurname: string | null;
  role: RecordRole;
  /** Why this role was assigned — stored so a wrong grouping is explainable. */
  evidence: string;
}

/**
 * Review titles wrap the work's own title in reviewer framing. These are the
 * shapes actually observed in catalogue data, in the order they must be tried:
 * the more specific patterns first, since several can match one title.
 */
const REVIEW_PATTERNS: { re: RegExp; label: string }[] = [
  // "[Recensão a] X" / "[Review of] X"
  { re: /^\s*\[\s*(?:recens[ãa]o\s+a|review\s+of|rezension)\s*\]\s*/i, label: "bracketed review marker" },
  // "Review: X" / "Reviewed Work: X" / "Book Review: X"
  { re: /^\s*(?:book\s+)?review(?:ed\s+work)?s?\s*[:—-]\s*/i, label: "review prefix" },
  // "X. Reviewed by Y" / "X - Reviewed by Y"
  { re: /\s*[.\-–—]\s*reviewed\s+by\s+.+$/i, label: "reviewed-by suffix" },
  // "X, by Author" — a review convention, not part of the title
  { re: /,\s*by\s+[A-Z][^,]{2,60}\.?\s*$/i, label: "by-author suffix" },
  // "Author: Title" review-listing form handled separately (needs author list)
];

/** Edition/translation markers that must not fragment a work's identity. */
const EDITION_MARKERS =
  /\b(?:ed(?:ition)?\.?\s*\d+|\d+(?:st|nd|rd|th)\s+ed(?:ition)?\.?|revised\s+ed(?:ition)?\.?|reprint(?:ed)?|new\s+ed(?:ition)?\.?|abridged|paperback|hardcover)\b/gi;

/**
 * Trim punctuation noise. Leading brackets are deliberately preserved: review
 * markers arrive as "[Recensão a] …", and stripping the bracket first stops
 * the review patterns from ever matching.
 */
function tidy(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .replace(/\(\s*\)/g, " ") // parens emptied by marker removal
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’]+/, "")
    .replace(/[\s"'“”‘’()\[\].,;:]+$/, "") // includes dangling openers
    .trim();
}

/**
 * Strip reviewer framing from a title, returning the work's own title plus the
 * evidence for what was stripped. Applied repeatedly, since a real title can
 * carry more than one layer ("Review: X, by Y").
 */
export function stripReviewFraming(title: string): { title: string; markers: string[] } {
  let out = tidy(title);
  const markers: string[] = [];
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const { re, label } of REVIEW_PATTERNS) {
      const next = out.replace(re, "");
      if (next !== out && tidy(next).length >= 4) {
        out = tidy(next);
        markers.push(label);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { title: out, markers };
}

/** Remove edition/printing wording so "…, ed. 2" and the first edition agree. */
export function stripEditionMarkers(title: string): { title: string; markers: string[] } {
  const found = title.match(EDITION_MARKERS);
  if (!found) return { title: tidy(title), markers: [] };
  return { title: tidy(title.replace(EDITION_MARKERS, " ")), markers: found.map((m) => m.trim()) };
}

function surnameOf(name: string): string {
  const parts = name.trim().split(/[\s,]+/).filter(Boolean);
  return (name.includes(",") ? parts[0] : parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Derive the canonical work identity for one discovered record.
 *
 * `citedAuthorSurnames` — surnames the citing document actually names — is what
 * makes reviewer-vs-author disambiguation possible: in "David Charles,
 * Aristotle's Philosophy of Action. Reviewed by Jane Doe", the catalogue may
 * list either person as the record's author. The one the document cites is the
 * work's author; the other is the reviewer.
 */
export function deriveWorkIdentity(
  record: Pick<RawResource, "title" | "authors" | "year" | "doi" | "isbn" | "resourceType">,
  opts: { citedAuthorSurnames?: ReadonlySet<string> } = {},
): WorkIdentityKey {
  const cited = opts.citedAuthorSurnames ?? new Set<string>();
  const review = stripReviewFraming(record.title);
  const edition = stripEditionMarkers(review.title);
  const canonicalTitle = edition.title || tidy(record.title);

  const evidence: string[] = [...review.markers, ...edition.markers];

  let working = canonicalTitle;

  // "… — David Charles: Aristotle's Philosophy of Action". Catalogues prefix a
  // review's title with the author being reviewed, sometimes mid-string. Split
  // at the LAST colon when the text before it ends with an author the citing
  // document actually names — an ordinary colon-subtitle is never touched,
  // because its left side is a title, not a cited surname.
  const lastColon = working.lastIndexOf(":");
  if (lastColon > 0 && working.length - lastColon > 7) {
    const before = working.slice(0, lastColon).trim().split(/[\s,]+/).filter(Boolean);
    const tail = (before[before.length - 1] ?? "").toLowerCase().replace(/[^a-z'’-]/g, "");
    if (cited.has(tail)) {
      working = tidy(working.slice(lastColon + 1));
      evidence.push("author-prefixed review listing");
    }
  }

  // "David Charles , Aristotle's Philosophy of Action" — the same convention
  // with a comma instead of a colon.
  const leading = working.match(/^([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2})\s*,\s*(.{6,})$/);
  if (leading && cited.has(surnameOf(leading[1]))) {
    working = tidy(leading[2]);
    evidence.push("author-prefixed review listing");
  }

  // "Ethics with Aristotle. Sarah Broadie" — catalogues also APPEND the author
  // to the title. Observed in production splitting one book across two works.
  // Only stripped when the trailing name is an author the document cites, so a
  // title genuinely ending in a proper noun is never truncated.
  const trailing = working.match(/^(.{6,}?)\s*[.\-–—]\s*([A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,2})\s*$/);
  if (trailing && cited.has(surnameOf(trailing[2]))) {
    working = tidy(trailing[1]);
    evidence.push("author-suffixed listing");
  }

  const surnames = record.authors.map(surnameOf).filter(Boolean);
  // Prefer an author the citing document names — that is the work's author, not
  // the reviewer who happens to occupy the same metadata field. Failing that,
  // look for a cited surname inside the title itself, which is where review
  // records put the author of the work under review.
  const titleTokens = new Set(
    tidy(record.title).toLowerCase().split(/[\s,.:;–—-]+/).map((t) => t.replace(/[^a-z'’-]/g, "")).filter(Boolean),
  );
  const citedInTitle = [...cited].find((s) => titleTokens.has(s)) ?? null;

  const isReview = review.markers.length > 0 || evidence.includes("author-prefixed review listing");
  const isEdition = edition.markers.length > 0;
  const role: RecordRole = isReview ? "review" : isEdition ? "edition" : "primary";

  const citedAuthor = surnames.find((s) => cited.has(s)) ?? citedInTitle;
  // A review's listed author is the reviewer, so it must never key the work.
  // Without a cited author to anchor it, a review keys on its title alone.
  const authorSurname = citedAuthor ?? (isReview ? null : surnames[0] ?? null);

  // Identity is title+author, NOT the identifier: a review carries its own DOI,
  // and keying on the identifier is exactly what splits one work into five
  // entries. Tokens are de-duplicated because review titles often repeat the
  // work's title verbatim alongside it.
  const tk = [...new Set(titleKey(working).split(" ").filter(Boolean))].sort().join(" ");
  const key = tk
    ? `work:${tk}${authorSurname ? `:${authorSurname}` : ""}`
    : `record:${canonicalizeDoi(record.doi) ?? canonicalizeIsbn(record.isbn) ?? tidy(record.title).toLowerCase()}`;

  return {
    key,
    canonicalTitle: working,
    authorSurname,
    role,
    evidence: evidence.length ? evidence.join("; ") : "title/author match",
  };
}

export interface WorkGroup<T> {
  key: string;
  canonicalTitle: string;
  authorSurname: string | null;
  /** The record that should represent this work in the Library. */
  primary: T;
  /** Reviews, editions and translations, attached rather than listed beside. */
  related: { record: T; role: RecordRole; evidence: string }[];
}

/**
 * Group records into works. The representative is chosen deliberately: a
 * `primary` record always beats a review, and among equals the richer record
 * (identifier, year, authors) wins — so the Library shows the book, with its
 * reviews hanging off it, rather than whichever record happened to sort first.
 */
export function groupByWork<T>(
  records: T[],
  read: (r: T) => Pick<RawResource, "title" | "authors" | "year" | "doi" | "isbn" | "resourceType">,
  opts: { citedAuthorSurnames?: ReadonlySet<string> } = {},
): WorkGroup<T>[] {
  const groups = new Map<string, { id: WorkIdentityKey; entries: { record: T; id: WorkIdentityKey }[] }>();
  for (const record of records) {
    const id = deriveWorkIdentity(read(record), opts);
    const g = groups.get(id.key);
    if (g) g.entries.push({ record, id });
    else groups.set(id.key, { id, entries: [{ record, id }] });
  }

  // A review whose author could not be identified keys on its title alone. If
  // exactly one authored work shares that title, the review belongs to it —
  // "[Recensão a] Aristotle's Philosophy of Action" is a review of the book,
  // not a separate work. Ambiguity (two authors, same title) leaves it alone.
  for (const [key, group] of [...groups]) {
    if (key.split(":").length !== 2) continue; // already carries an author
    if (group.entries.some((e) => e.id.role === "primary")) continue;
    const prefix = `${key}:`;
    const candidates = [...groups.keys()].filter((k) => k.startsWith(prefix));
    if (candidates.length !== 1) continue;
    const target = groups.get(candidates[0])!;
    target.entries.push(...group.entries);
    groups.delete(key);
  }

  const rank = (e: { record: T; id: WorkIdentityKey }) => {
    const raw = read(e.record);
    return (
      (e.id.role === "primary" ? 100 : e.id.role === "edition" ? 50 : 0) +
      (raw.doi ? 4 : 0) + (raw.isbn ? 3 : 0) + (raw.year ? 2 : 0) + (raw.authors.length ? 1 : 0)
    );
  };

  return [...groups.values()].map(({ entries }) => {
    const sorted = [...entries].sort((a, b) => rank(b) - rank(a));
    const [head, ...rest] = sorted;
    return {
      key: head.id.key,
      // Take the canonical title from the representative, which is the record
      // least likely to be carrying reviewer framing.
      canonicalTitle: head.id.canonicalTitle,
      authorSurname: head.id.authorSurname,
      primary: head.record,
      related: rest.map((e) => ({ record: e.record, role: e.id.role, evidence: e.id.evidence })),
    };
  });
}
