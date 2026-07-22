import type { LibraryItem } from "@/lib/library";

/**
 * Client-safe Library search/label helpers (plan §20.1), split out of
 * `lib/library.ts` deliberately: that module imports `@ice/db` (which pulls
 * in `pg`/`pg-boss`, and transitively Node built-ins like `dns`), so any
 * VALUE import from it — not just its types — drags the whole server-only
 * dependency graph into the client bundle the moment a "use client"
 * component imports it. `LibraryView.tsx` previously only imported
 * `library.ts`'s TYPES (erased at compile time, so no runtime import ever
 * happened); importing `SOURCE_TYPE_LABEL` as a real value broke that and
 * failed the whole app at build time with "Module not found: Can't resolve
 * 'dns'". This module has no DB import at all, so both the server loader
 * (`lib/library.ts`) and the client view (`LibraryView.tsx`) can safely
 * import real values from it.
 */

/**
 * Human-readable labels for `learning_resource.resource_type` — the single
 * source of truth (search must also match what the reader sees, e.g.
 * typing "book" should find items labeled "Book").
 */
export const SOURCE_TYPE_LABEL: Record<string, string> = {
  article: "Article",
  book: "Book",
  webpage: "Web article",
  video: "Lecture or video",
  social_post: "Social post",
  dataset: "Dataset",
  "unresolved-citation": "Unresolved citation",
};

/**
 * Case- and diacritic-insensitive normalization for the Library search bar.
 * NFD-decomposes accented characters and strips the resulting combining
 * marks, so "Épistémologie" and "epistemologie" (in any case) compare equal.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Whether one Library item matches a (pre-normalized, non-empty) search
 * term across title, authors, venue, year, DOI, ISBN, and source type —
 * both the raw stored value and the label the reader actually sees.
 */
export function matchesLibrarySearch(item: LibraryItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const haystack = [
    item.title,
    ...item.authors,
    item.venue,
    item.year != null ? String(item.year) : null,
    item.doi,
    item.isbn,
    item.resourceType,
    SOURCE_TYPE_LABEL[item.resourceType],
    // Phase 20.6: records attached under this canonical entry (reviews,
    // editions, translations) are still searchable — finding a review's
    // title must surface the canonical work it hangs off.
    ...(item.attached ?? []).flatMap((attached) => [
      attached.title,
      ...attached.authors,
      attached.year != null ? String(attached.year) : null,
    ]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(normalizeForSearch);
  return haystack.some((value) => value.includes(normalizedQuery));
}
