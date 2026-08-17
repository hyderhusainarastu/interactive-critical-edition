import { describe, expect, it } from "vitest";
import { claimContentHash, normalizeClaimText } from "./claimContentHash";

/** A frozen, known-input digest. This is the whole point of the test: the
 *  hash is a persisted dedup key (`research_claim.content_hash`), so any
 *  future change to how text is normalized silently re-identifies every
 *  already-stored claim. Changing this constant must be a deliberate,
 *  migration-backed decision, never a passing side effect. */
const KNOWN_TEXT = "Virtue is a kind of knowledge.";
const KNOWN_HASH = "b2f5ef87ec0537967ae8df80e7e1e40399f39db746c8a5657cd10f4fc5915827";

describe("normalizeClaimText", () => {
  it("case-folds, collapses whitespace, and trims", () => {
    expect(normalizeClaimText("  Virtue   IS a\tkind of\nknowledge.  ")).toBe("virtue is a kind of knowledge.");
  });

  it("leaves already-normalized text unchanged", () => {
    expect(normalizeClaimText("virtue is a kind of knowledge.")).toBe("virtue is a kind of knowledge.");
  });
});

describe("claimContentHash", () => {
  it("produces the exact expected digest for a known input", () => {
    expect(claimContentHash(KNOWN_TEXT)).toBe(KNOWN_HASH);
  });

  it("produces a 64-character lowercase hex sha256 digest", () => {
    expect(claimContentHash(KNOWN_TEXT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(claimContentHash(KNOWN_TEXT)).toBe(claimContentHash(KNOWN_TEXT));
  });

  it("ignores differences that normalization erases", () => {
    expect(claimContentHash("  VIRTUE   is a\tkind of\nknowledge.  ")).toBe(KNOWN_HASH);
  });

  it("changes when the claim's wording really changes", () => {
    expect(claimContentHash("Virtue is not a kind of knowledge.")).not.toBe(KNOWN_HASH);
  });
});
