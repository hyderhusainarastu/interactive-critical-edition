/**
 * `localStorage`-backed read/write of the last-visited Knowledge Map
 * contexts (charter §8 "recent contexts", spec §1.1's `recentContexts.ts`
 * row). Pure functions over an injected `StorageLike`, so this file is
 * unit-testable without any DOM mocking beyond a plain in-memory stub —
 * same precedent as `WorkspacePreferencesProvider.tsx`/`GlobalRagSidebar.tsx`
 * already using `localStorage` for client-only, non-DB-worthy state (spec
 * §1.1's own note on why this isn't a database table).
 *
 * Namespaced per `userId` (a shared browser profile — e.g. a kiosk/shared
 * machine — must never show one signed-in user's recent contexts to
 * another) and capped at `MAX_RECENT_CONTEXTS` entries, most-recent-first,
 * deduplicated by `(kind, id)` — revisiting an existing entry moves it to
 * the front rather than creating a second row for the same context.
 */
import type { GraphContextKind } from "@ice/graph-display";

export const MAX_RECENT_CONTEXTS = 8;

export interface RecentContextEntry {
  kind: GraphContextKind;
  id: string;
  /** Snapshotted at visit time so the chooser can render a card with no
   *  extra fetch — deliberately NOT re-validated/re-fetched by this module
   *  (it has no network access); a stale/deleted context still shows its
   *  last-known label here, and resolving whether it's still valid is the
   *  caller's job (the same `checkContext`/omission-announcement machinery
   *  `@ice/graph-display/reconstruct.ts` already defines for URL-state
   *  restoration generally). */
  label: string;
  subtitle: string;
  visitedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function recentContextsStorageKey(userId: string): string {
  return `palimnote:knowledge-map:recent-contexts:${userId}`;
}

function isRecentContextEntry(value: unknown): value is RecentContextEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kind === "string" &&
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    typeof v.subtitle === "string" &&
    typeof v.visitedAt === "string"
  );
}

/** Tolerant of a missing key, corrupted JSON, or a shape from a future/past
 *  schema version — every failure mode degrades to an empty list rather
 *  than throwing, since this is best-effort convenience state, not a
 *  durable record (see this module's own doc comment). */
export function readRecentContexts(userId: string, storage: StorageLike): RecentContextEntry[] {
  const raw = storage.getItem(recentContextsStorageKey(userId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentContextEntry);
  } catch {
    return [];
  }
}

/** Records a visit: moves an existing `(kind, id)` entry to the front (with
 *  its label/subtitle refreshed to whatever was just visited, since the
 *  entity's own display name may have changed since it was last recorded)
 *  or inserts a new one, then truncates to `MAX_RECENT_CONTEXTS`. Returns
 *  the updated list — the caller re-renders from this return value rather
 *  than re-reading storage, so a write is always observably reflected
 *  immediately. */
export function recordRecentContext(
  userId: string,
  entry: Omit<RecentContextEntry, "visitedAt">,
  storage: StorageLike,
  now: () => string = () => new Date().toISOString(),
): RecentContextEntry[] {
  const existing = readRecentContexts(userId, storage);
  const withoutThisOne = existing.filter((e) => !(e.kind === entry.kind && e.id === entry.id));
  const next = [{ ...entry, visitedAt: now() }, ...withoutThisOne].slice(0, MAX_RECENT_CONTEXTS);
  storage.setItem(recentContextsStorageKey(userId), JSON.stringify(next));
  return next;
}

export function clearRecentContexts(userId: string, storage: StorageLike): void {
  storage.removeItem(recentContextsStorageKey(userId));
}

/** Real-browser storage accessor — `null` during SSR/when `localStorage`
 *  is unavailable (private browsing in some engines throws on access), so
 *  a caller can degrade to "no recent contexts" rather than crash. Kept
 *  separate from the pure functions above so tests never need a real
 *  `window`. */
export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
