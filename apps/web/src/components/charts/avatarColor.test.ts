import { describe, expect, it } from "vitest";
import { avatarBackgroundColor, hueForId, initialsForName } from "./avatarColor";

/**
 * Workstream G (v.5) InitialsAvatar's deterministic-hue/initials logic. Run
 * via `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `chartGeometry.test.ts`).
 */

// --- hueForId ----------------------------------------------------------

describe("hueForId", () => {
  // Deterministic: the same id always produces the same hue.
  it("is deterministic — the same id always produces the same hue", () => {
    expect(hueForId("user-123")).toBe(hueForId("user-123"));
  });

  // Different ids very likely produce different hues (not a strict
  // requirement of the algorithm, but a sanity check that it isn't constant).
  it("very likely produces different hues for different ids (sanity check that it isn't constant)", () => {
    expect(hueForId("user-123")).not.toBe(hueForId("user-456"));
  });

  // Always a valid hue in [0, 360).
  it("always returns an integer hue in [0, 360)", () => {
    for (const id of ["a", "", "  ", "a-very-long-uuid-1234-5678-9abc-def0", "😀emoji-id"]) {
      const hue = hueForId(id);
      // message: `hue for ${JSON.stringify(id)} must be in [0, 360)`
      expect(hue >= 0 && hue < 360).toBeTruthy();
      expect(Number.isInteger(hue)).toBeTruthy();
    }
  });

  // Null/undefined/empty all degrade to a fixed, still-valid hue rather than
  // throwing or producing NaN.
  it("degrades null/undefined/empty to one fixed, still-valid hue rather than throwing or producing NaN", () => {
    const hueNull = hueForId(null);
    const hueUndefined = hueForId(undefined);
    const hueEmpty = hueForId("");
    expect(hueNull).toBe(hueUndefined);
    expect(hueNull).toBe(hueEmpty);
    expect(Number.isInteger(hueNull) && hueNull >= 0 && hueNull < 360).toBeTruthy();
  });
});

// --- avatarBackgroundColor -----------------------------------------------

describe("avatarBackgroundColor", () => {
  it("emits the hsl() string for an in-range hue", () => {
    expect(avatarBackgroundColor(0)).toBe("hsl(0deg 42% 32%)");
    expect(avatarBackgroundColor(200)).toBe("hsl(200deg 42% 32%)");
  });

  // Out-of-range/negative hues wrap into [0, 360) rather than emitting an
  // invalid CSS value.
  it("wraps out-of-range/negative hues into [0, 360) rather than emitting an invalid CSS value", () => {
    expect(avatarBackgroundColor(-10)).toBe("hsl(350deg 42% 32%)");
    expect(avatarBackgroundColor(370)).toBe("hsl(10deg 42% 32%)");
    expect(avatarBackgroundColor(360)).toBe("hsl(0deg 42% 32%)");
  });
});

// --- initialsForName -------------------------------------------------------

describe("initialsForName", () => {
  it("takes the first and last word's initials", () => {
    expect(initialsForName("Ada Lovelace")).toBe("AL");
  });

  it("first + LAST word, not first two words", () => {
    expect(initialsForName("Ada Katherine Lovelace")).toBe("AL");
  });

  it("a single word uses its own first two letters", () => {
    expect(initialsForName("Ada")).toBe("AD");
  });

  it("a one-letter name has no second letter to add", () => {
    expect(initialsForName("A")).toBe("A");
  });

  it("no name and no fallback seed degrades to a plain placeholder", () => {
    expect(initialsForName("")).toBe("?");
    expect(initialsForName(null)).toBe("?");
    expect(initialsForName(undefined)).toBe("?");
  });

  it("whitespace-only name is treated as absent", () => {
    expect(initialsForName("   ")).toBe("?");
  });

  it("falls back to the seed's first character when there's no name", () => {
    expect(initialsForName(null, "user-abc")).toBe("U");
  });

  it("an empty fallback seed still degrades to the placeholder, not an empty string", () => {
    expect(initialsForName("", "")).toBe("?");
  });

  // Always uppercase, regardless of input casing.
  it("is always uppercase, regardless of input casing", () => {
    expect(initialsForName("ada lovelace")).toBe("AL");
    expect(initialsForName(null, "zed")).toBe("Z");
  });
});
