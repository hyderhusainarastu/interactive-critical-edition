/**
 * `localStorage`-backed pinned-node-position persistence for Arrange mode
 * (charter §11 "Arrange mode": "Pinned positions are scoped to the current
 * user/context and may be stored locally if no existing owner-scoped
 * persistence exists... Do not add a database migration solely for saved
 * layout", spec §1.1's `arrangeStore.ts` row / §4.3). Same `StorageLike`
 * injection pattern as `recentContexts.ts`, for the same testability
 * reason.
 *
 * Scoped by the composite key `(userId, contextKind, contextId)` — a
 * user's pinned layout for one context never leaks into another context,
 * and one browser profile's pins for a shared machine never leak across
 * users (same isolation `recentContexts.ts` already provides).
 */
import type { GraphContextKind } from "@ice/graph-display";

export interface PinnedPosition {
  x: number;
  y: number;
}

export type PinnedPositionsByNode = Record<string, PinnedPosition>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function arrangeStoreKey(userId: string, contextKind: GraphContextKind, contextId: string): string {
  return `palimnote:knowledge-map:arrange:${userId}:${contextKind}:${contextId}`;
}

function isPinnedPosition(value: unknown): value is PinnedPosition {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.x === "number" && Number.isFinite(v.x) && typeof v.y === "number" && Number.isFinite(v.y);
}

/** Tolerant of a missing key, corrupted JSON, or malformed entries — same
 *  "best-effort local convenience state, never throws" posture as
 *  `recentContexts.ts`'s `readRecentContexts`. Malformed individual node
 *  entries are dropped rather than invalidating the whole map. */
export function getPinnedPositions(userId: string, contextKind: GraphContextKind, contextId: string, storage: StorageLike): PinnedPositionsByNode {
  const raw = storage.getItem(arrangeStoreKey(userId, contextKind, contextId));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: PinnedPositionsByNode = {};
    for (const [nodeId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPinnedPosition(value)) result[nodeId] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writePinnedPositions(
  userId: string,
  contextKind: GraphContextKind,
  contextId: string,
  positions: PinnedPositionsByNode,
  storage: StorageLike,
): void {
  storage.setItem(arrangeStoreKey(userId, contextKind, contextId), JSON.stringify(positions));
}

/** "Pin" — writes the given node's current `(x, y)` (Z stays band-pinned;
 *  Arrange never moves a node out of its semantic band, charter §8/§11 —
 *  this store deliberately has no Z field at all, so persisting a Z value
 *  by accident isn't even representable). Returns the updated map. */
export function pinPosition(
  userId: string,
  contextKind: GraphContextKind,
  contextId: string,
  nodeId: string,
  position: PinnedPosition,
  storage: StorageLike,
): PinnedPositionsByNode {
  const current = getPinnedPositions(userId, contextKind, contextId, storage);
  const next = { ...current, [nodeId]: position };
  writePinnedPositions(userId, contextKind, contextId, next, storage);
  return next;
}

/** "Unpin" one node — removes its entry only, leaving every other pinned
 *  node untouched. */
export function unpinPosition(
  userId: string,
  contextKind: GraphContextKind,
  contextId: string,
  nodeId: string,
  storage: StorageLike,
): PinnedPositionsByNode {
  const current = getPinnedPositions(userId, contextKind, contextId, storage);
  if (!(nodeId in current)) return current;
  const next = { ...current };
  delete next[nodeId];
  writePinnedPositions(userId, contextKind, contextId, next, storage);
  return next;
}

/** "Reset Layout" — clears every pinned entry for this exact
 *  `(userId, contextKind, contextId)` triple; other contexts are
 *  untouched. */
export function resetLayout(userId: string, contextKind: GraphContextKind, contextId: string, storage: StorageLike): void {
  storage.removeItem(arrangeStoreKey(userId, contextKind, contextId));
}

export function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
