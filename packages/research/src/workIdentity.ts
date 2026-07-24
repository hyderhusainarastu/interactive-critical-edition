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

/**
 * D-23-19 (floors attempt 4/5 — the wrong-work-link CLASS): a bibliographic
 * provider indexes a book's published REVIEW/notice as its own record whose
 * title substantially overlaps — often literally repeats — the reviewed
 * work's title. `titleOverlap` happily accepts these, so a citation to the
 * WORK mis-links to a review OF the work. Observed in the actual floors-run
 * corpus: "Love and Friendship in Plato and Aristotle (review)"; a review
 * header carried verbatim as a Crossref title, "Book Reviews … Pp. xxiii +
 * 441, $50.00 (cloth)"; "Richmond Lattimore: The Odyssey of Homer. … Pp. 374.
 * … Cloth, $8.95."; "Sarah Broadie and Christopher Rowe (eds) … Pp. x+468.
 * £15.00 (Pbk)." These guards read ONLY the candidate's own title for signals
 * that never appear in a genuine work's title — an appended "(review)"/
 * "[review]" document-type tag, a pagination notice ("Pp. 374"/"Pp. x+468"),
 * or a binding notice ("(cloth)"/"(Pbk)") — so a review notice is rejected
 * while a same-titled monograph is untouched. Deliberately grounded in the
 * real corpus, not speculative; deliberately omits a bare currency signal,
 * which a legitimate title can carry ("$2.00 a Day").
 *
 * Adversarial verification (post-merge) found the original marker also
 * matched titles STARTING with "Review"/"Reviews of"/"Review:" — a prefix
 * shape that never actually appears in any of the four corpus examples above
 * (all four are caught by the suffix tag alone or by pagination/binding), but
 * DOES match real, legitimately-citable titles: journal names used as a
 * title field ("Review of Economic Studies", "Reviews of Modern Physics") and
 * genuine review-articles that this exact scholarly domain cites directly as
 * primary sources ("Review of Aristotle's Ethics, by W. D. Ross"). Vetoing
 * those would silently turn a correct resolution into a false "unresolved"
 * with no recovery path. The prefix branch was removed as unneeded weight —
 * the suffix tag is what the real bypass needed, and it carries much lower
 * false-positive risk, since "(review)"/"[review]" is a document-type tag an
 * index appends rather than an organic part of an authored title.
 *
 * Shared (issue #2): the same predicate that vetoes a citation mis-link is
 * also the review signal `deriveWorkIdentity` folds into its role decision,
 * so a review notice attaches under its primary rather than surfacing as a
 * separate Library entry. Exported from here — the module that already owns
 * work-identity vocabulary — and imported by `apps/worker/src/analyze.ts`. */
const REVIEW_TITLE_MARKER = /\(\s*review\s*\)\s*$|\[\s*review\s*\]\s*$/i;
const PAGINATION_NOTICE = /\bpp\.\s*[ivxlcdm\d]/i;
const BINDING_NOTICE = /\((?:cloth|paper|pbk|hbk|hardback|paperback|hardcover)\)/i;

export function isReviewTitle(title: string): boolean {
  return REVIEW_TITLE_MARKER.test(title) || PAGINATION_NOTICE.test(title) || BINDING_NOTICE.test(title);
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

  // Issue #3, fragmentation vector (a): a leading POSSESSIVE of a cited author
  // ("Aristotle's Nicomachean Ethics") is authorship, not a title word, yet
  // `titleKey` keeps "aristotle" as a title token — so the possessive and
  // non-possessive forms of one work ("Aristotle's Nicomachean Ethics" vs
  // "Nicomachean Ethics") fragment into two keys. Strip the possessive token
  // from the KEY (only), and only when it names an author the citing document
  // actually cites — a topical possessive of an uncited name is left intact.
  // The displayed `canonicalTitle` keeps the original wording untouched.
  let keyTitle = working;
  const possessive = working.match(/^([A-Z][A-Za-z.\-'’]*?)['’]s\s+(.{4,})$/);
  if (possessive && cited.has(surnameOf(possessive[1]))) {
    keyTitle = tidy(possessive[2]);
    evidence.push("leading possessive of cited author stripped from key");
  }

  const surnames = record.authors.map(surnameOf).filter(Boolean);
  // Prefer an author the citing document names — that is the work's author, not
  // the reviewer who happens to occupy the same metadata field. Failing that,
  // look for a cited surname inside the title itself, which is where review
  // records put the author of the work under review.
  const titleTokens = new Set(
    tidy(record.title).toLowerCase().split(/[\s,.:;–—-]+/).map((t) => t.replace(/[^a-z'’-]/g, "")).filter(Boolean),
  );
  // The significant tokens of the FINAL work-key title (after the possessive
  // strip above). Issue #3, fragmentation vector (b): a token that is part of
  // THIS work's own title must never be mistaken for its author. Without this,
  // a mis-parsed citation surname that happens to be a title word ("Nicomachean")
  // leaks through `citedInTitle` and becomes the author, splitting the work.
  const keyTitleTokens = new Set(titleKey(keyTitle).split(" ").filter(Boolean));
  const citedInTitle = [...cited].find((s) => titleTokens.has(s) && !keyTitleTokens.has(s)) ?? null;

  const isReview =
    review.markers.length > 0 ||
    evidence.includes("author-prefixed review listing") ||
    // Issue #2: a review NOTICE ("… (review)", a pagination/binding notice) is
    // a review of the work, not the work — same predicate the citation-linker
    // vetoes, so such a record attaches under its primary via the fold below.
    isReviewTitle(record.title);
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
  const tk = [...new Set(titleKey(keyTitle).split(" ").filter(Boolean))].sort().join(" ");
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
    if (!key.startsWith("work:")) continue;
    if (key.split(":").length !== 2) continue; // already carries an author
    const prefix = `${key}:`;
    const candidates = [...groups.keys()].filter((k) => k.startsWith(prefix));
    if (candidates.length !== 1) continue;
    // A review/edition-only identity (no primary) folds into its unique
    // authored match unconditionally — it is explicitly ABOUT the named work.
    // An authorless PRIMARY — a bare title with no author metadata, the residue
    // of the issue #3 possessive/citedInTitle hardening — also folds into its
    // unique authored twin, but only when the title is specific enough (≥2
    // significant tokens) that a generic one-word title ("Ethics") can never
    // dissolve into an unrelated work. Precision over recall.
    if (group.entries.some((e) => e.id.role === "primary")) {
      const tokenCount = key.slice("work:".length).split(" ").filter(Boolean).length;
      if (tokenCount < 2) continue;
    }
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
