import assert from "node:assert/strict";
import { avatarBackgroundColor, hueForId, initialsForName } from "./avatarColor";

/**
 * Workstream G (v.5) InitialsAvatar's deterministic-hue/initials logic. Run
 * via `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `chartGeometry.test.ts`).
 */

// --- hueForId ----------------------------------------------------------

// Deterministic: the same id always produces the same hue.
assert.equal(hueForId("user-123"), hueForId("user-123"));
// Different ids very likely produce different hues (not a strict
// requirement of the algorithm, but a sanity check that it isn't constant).
assert.notEqual(hueForId("user-123"), hueForId("user-456"));
// Always a valid hue in [0, 360).
for (const id of ["a", "", "  ", "a-very-long-uuid-1234-5678-9abc-def0", "😀emoji-id"]) {
  const hue = hueForId(id);
  assert.ok(hue >= 0 && hue < 360, `hue for ${JSON.stringify(id)} must be in [0, 360)`);
  assert.ok(Number.isInteger(hue));
}
// Null/undefined/empty all degrade to a fixed, still-valid hue rather than
// throwing or producing NaN.
{
  const hueNull = hueForId(null);
  const hueUndefined = hueForId(undefined);
  const hueEmpty = hueForId("");
  assert.equal(hueNull, hueUndefined);
  assert.equal(hueNull, hueEmpty);
  assert.ok(Number.isInteger(hueNull) && hueNull >= 0 && hueNull < 360);
}

// --- avatarBackgroundColor -----------------------------------------------

assert.equal(avatarBackgroundColor(0), "hsl(0deg 42% 32%)");
assert.equal(avatarBackgroundColor(200), "hsl(200deg 42% 32%)");
// Out-of-range/negative hues wrap into [0, 360) rather than emitting an
// invalid CSS value.
assert.equal(avatarBackgroundColor(-10), "hsl(350deg 42% 32%)");
assert.equal(avatarBackgroundColor(370), "hsl(10deg 42% 32%)");
assert.equal(avatarBackgroundColor(360), "hsl(0deg 42% 32%)");

// --- initialsForName -------------------------------------------------------

assert.equal(initialsForName("Ada Lovelace"), "AL");
assert.equal(initialsForName("Ada Katherine Lovelace"), "AL", "first + LAST word, not first two words");
assert.equal(initialsForName("Ada"), "AD", "a single word uses its own first two letters");
assert.equal(initialsForName("A"), "A", "a one-letter name has no second letter to add");
assert.equal(initialsForName(""), "?", "no name and no fallback seed degrades to a plain placeholder");
assert.equal(initialsForName(null), "?");
assert.equal(initialsForName(undefined), "?");
assert.equal(initialsForName("   "), "?", "whitespace-only name is treated as absent");
assert.equal(initialsForName(null, "user-abc"), "U", "falls back to the seed's first character when there's no name");
assert.equal(initialsForName("", ""), "?", "an empty fallback seed still degrades to the placeholder, not an empty string");
// Always uppercase, regardless of input casing.
assert.equal(initialsForName("ada lovelace"), "AL");
assert.equal(initialsForName(null, "zed"), "Z");

console.log("avatarColor.test.ts: all assertions passed");
