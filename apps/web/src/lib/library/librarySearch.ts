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
 * Whether ANY visible item carries a real (non-null) `resource_role.reader_level`
 * (owner-reported defect, register-tentative D-23-50). Every current write
 * path into `resource_role` — the citation-projection path and the v3/v4
 * promotion path in `apps/worker/src/analyze.ts` — sets `readerLevel: null`
 * ("applies at every level"; confirmed in production: 406/406 `resource_role`
 * rows are null-level as of this fix). `matchesReaderLevel` treats null as
 * matching every selected level by design (universal material must stay
 * reachable in every view), so a level filter over data that is entirely
 * null is a mathematically correct no-op, not a wiring bug — every option
 * yields an identical result set. Rather than offering a control that visibly
 * changes nothing, the Library only renders the reader-level filter when at
 * least one item's roles actually differentiate by level; this is a genuine
 * data check with no feature flag, so the filter reappears on its own the
 * moment a future write path starts setting a real level — no code change
 * needed here when that happens.
 */
export function hasReaderLevelSignal(items: Pick<LibraryItem, "roles">[]): boolean {
  return items.some((item) => rolesHaveReaderLevelSignal(item.roles));
}

/**
 * Flat-roles sibling of `hasReaderLevelSignal` for callers that hold
 * `resource_role` rows directly rather than Library items grouping them
 * (the Curriculum page's `computeCurriculum` reads roles for ONE work,
 * D-23-8 — same vacuous-filter defect, different data shape). Same rule:
 * a reader-level filter is only offerable when at least one role carries a
 * real (non-null) level; over all-null data every option returns the
 * identical set, so the control must be replaced by an honest note instead.
 */
export function rolesHaveReaderLevelSignal(roles: ReadonlyArray<{ readerLevel: string | null }>): boolean {
  return roles.some((role) => role.readerLevel != null);
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
