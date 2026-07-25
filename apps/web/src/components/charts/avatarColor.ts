/**
 * Workstream G (v.5): pure helpers behind `InitialsAvatar.tsx` — a
 * deterministic per-user color plus a two-letter fallback, kept separate
 * from the component (same "pure math, tsx-testable, no DOM" split as
 * `chartGeometry.ts` and `apps/web/src/components/graph/
 * graphSceneScaling.ts`) so the hash/initials logic is unit-tested without
 * rendering anything.
 */

/**
 * A deterministic hue (0-359) derived from a user id — the same id always
 * produces the same hue, with no lookup table or server round-trip needed.
 * A simple rolling hash (not cryptographic; collisions across different ids
 * landing on the same hue are fine, this is a visual accent, not an
 * identity check) over the id's UTF-16 code units. An empty/missing id
 * falls back to a fixed seed rather than hashing an empty string to a
 * constant hue for everyone with no id.
 */
export function hueForId(id: string | null | undefined): number {
  const safeId = id && id.length > 0 ? id : "palimnote-avatar";
  let hash = 0;
  for (let i = 0; i < safeId.length; i++) {
    // `| 0` keeps the accumulator a 32-bit signed int so the hash is
    // identical across every JS engine (no float drift from repeated
    // multiplication), matching the determinism this function promises.
    hash = (hash * 31 + safeId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** Fixed saturation/lightness for every hue: dark and moderately saturated
 *  enough that white initials text clears WCAG AA (4.5:1) against any hue
 *  on the wheel, so the per-user variation is hue-only, never a legibility
 *  gamble. */
const AVATAR_SATURATION = 42;
const AVATAR_LIGHTNESS = 32;

/** The avatar's background as a CSS `hsl()` string for a given hue. */
export function avatarBackgroundColor(hue: number): string {
  const safeHue = ((Math.round(hue) % 360) + 360) % 360;
  return `hsl(${safeHue}deg ${AVATAR_SATURATION}% ${AVATAR_LIGHTNESS}%)`;
}

/**
 * A one- or two-letter initials fallback: two words -> first letter of
 * each; one word -> its first two letters; nothing usable -> the first
 * character of `fallbackSeed` (typically the user id) or `"?"`. Always
 * uppercase, always at most 2 characters.
 */
export function initialsForName(name: string | null | undefined, fallbackSeed?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) {
    const seed = (fallbackSeed ?? "").trim();
    return seed.length > 0 ? seed[0]!.toUpperCase() : "?";
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}
