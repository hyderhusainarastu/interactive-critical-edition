import type { RawResource } from "./types";

/**
 * Deduplication identity (plan §33): dedup by DOI, then ISBN, then canonical
 * URL, then normalized title+author+year. `normalizedKey` returns the highest
 * -precedence key available so two records for the same work collapse even when
 * they came from different providers with different metadata completeness.
 */

/** Lowercase, strip protocol/query/fragment/tracking, drop trailing slash. */
export function canonicalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    u.hash = "";
    // Drop common tracking params so the same page doesn't dedup as distinct.
    const drop = [...u.searchParams.keys()].filter((k) => /^utm_|^(fbclid|gclid|ref|si)$/i.test(k));
    for (const k of drop) u.searchParams.delete(k);
    const host = u.host.replace(/^www\./, "").toLowerCase();
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    const search = u.searchParams.toString();
    return `${host}${path}${search ? `?${search}` : ""}`;
  } catch {
    return url.trim().toLowerCase() || null;
  }
}

/** Normalize a DOI to its bare `10.x/...` lowercase form. */
export function canonicalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const m = doi.trim().toLowerCase().match(/10\.\d{4,9}\/[^\s"'<>]+/);
  return m ? m[0].replace(/[.,;)]+$/, "") : null;
}

/** ISBN → digits only (and X), 10 or 13 length. */
export function canonicalizeIsbn(isbn: string | null | undefined): string | null {
  if (!isbn) return null;
  const digits = isbn.replace(/[^0-9xX]/g, "").toUpperCase();
  return digits.length === 10 || digits.length === 13 ? digits : null;
}

/** Significant-word title key: lowercase, alphanumerics, drop short/stopwords. */
const STOP = new Set(["the", "and", "for", "with", "from", "into", "a", "an", "of", "on", "in", "to"]);
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .sort()
    .join(" ")
    .trim();
}

function surnameKey(authors: string[]): string {
  const first = authors[0];
  if (!first) return "";
  const parts = first.trim().split(/[\s,]+/).filter(Boolean);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export interface Identifiable {
  doi?: string | null;
  isbn?: string | null;
  url?: string | null;
  title: string;
  authors?: string[];
  year?: number | null;
}

/**
 * Highest-precedence dedup key. Prefixed by kind so a DOI never collides with a
 * URL that happens to match its text. Returns null only when there is truly no
 * usable identity (no title and no identifier) — such a resource is dropped.
 */
export function normalizedKey(r: Identifiable): string | null {
  const doi = canonicalizeDoi(r.doi);
  if (doi) return `doi:${doi}`;
  const isbn = canonicalizeIsbn(r.isbn);
  if (isbn) return `isbn:${isbn}`;
  const url = canonicalizeUrl(r.url);
  if (url) return `url:${url}`;
  const tk = titleKey(r.title);
  if (!tk) return null;
  const parts = ["title", tk];
  const surname = surnameKey(r.authors ?? []);
  if (surname) parts.push(surname);
  if (r.year) parts.push(String(r.year));
  return parts.join(":");
}

/**
 * Deduplicate resources by normalized key, keeping the most complete record
 * (prefers one with a DOI/ISBN, then more populated fields). Merges the missing
 * identifiers from dropped duplicates so a later projection has the best data.
 */
export function dedupeResources(resources: RawResource[]): RawResource[] {
  const byKey = new Map<string, RawResource>();
  const completeness = (r: RawResource) =>
    (r.doi ? 4 : 0) + (r.isbn ? 3 : 0) + (r.year ? 1 : 0) + (r.authors.length ? 1 : 0) + (r.snippet ? 1 : 0);
  for (const r of resources) {
    const key = normalizedKey(r);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, r);
      continue;
    }
    // Keep the richer record; backfill identifiers from the other.
    const [keep, drop] = completeness(r) > completeness(existing) ? [r, existing] : [existing, r];
    keep.doi ??= drop.doi;
    keep.isbn ??= drop.isbn;
    keep.url ??= drop.url;
    keep.year ??= drop.year;
    if (!keep.authors.length) keep.authors = drop.authors;
    keep.snippet ??= drop.snippet;
    byKey.set(key, keep);
  }
  return [...byKey.values()];
}
