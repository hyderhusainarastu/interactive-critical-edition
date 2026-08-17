import { describe, expect, it } from "vitest";
import { AVATAR_MAX_BYTES, base64ByteLength, clampAvatarDimensions, validateAvatarDataUrl } from "@/lib/auth/avatarUpload";

/**
 * Pure module, no `@ice/db`/`@/*` import — run directly:
 *   pnpm --filter web exec tsx apps/web/src/lib/avatarUpload.test.ts
 * (same convention as `foreignSpans.test.ts`/`graphSceneScaling.test.ts`.)
 */

function makeBase64OfLength(byteLength: number): string {
  return Buffer.alloc(byteLength, 1).toString("base64");
}

describe("clampAvatarDimensions", () => {
  it("already within bounds is unchanged", () => {
    expect(clampAvatarDimensions(120, 80)).toEqual({ width: 120, height: 80 });
  });

  it("downscales preserving aspect ratio, longer edge hits the cap", () => {
    expect(clampAvatarDimensions(1024, 512)).toEqual({ width: 256, height: 128 });
    expect(clampAvatarDimensions(512, 1024)).toEqual({ width: 128, height: 256 });
  });

  it("exactly at the cap is unchanged", () => {
    expect(clampAvatarDimensions(256, 256)).toEqual({ width: 256, height: 256 });
  });

  it("degenerate input falls back to the cap rather than 0x0", () => {
    expect(clampAvatarDimensions(0, 0)).toEqual({ width: 256, height: 256 });
  });
});

describe("base64ByteLength", () => {
  it("returns the decoded byte length, and 0 for an empty payload", () => {
    const oneKb = makeBase64OfLength(1024);
    expect(base64ByteLength(oneKb)).toBe(1024);
    expect(base64ByteLength("")).toBe(0);
  });
});

describe("validateAvatarDataUrl", () => {
  // validateAvatarDataUrl — accepted shapes
  it("accepts png/jpeg/webp data URLs and reports the real mime type and byte count", () => {
    const smallPng = `data:image/png;base64,${makeBase64OfLength(500)}`;
    const okPng = validateAvatarDataUrl(smallPng);
    expect(okPng.ok).toBe(true);
    if (okPng.ok) {
      expect(okPng.mimeType).toBe("png");
      expect(okPng.bytes).toBe(500);
    }
    expect(validateAvatarDataUrl(`data:image/jpeg;base64,${makeBase64OfLength(500)}`).ok).toBe(true);
    expect(validateAvatarDataUrl(`data:image/webp;base64,${makeBase64OfLength(500)}`).ok).toBe(true);
  });

  // Rejected: wrong prefix / unsupported type / not a data URL at all
  it("rejects a wrong prefix, an unsupported type, or something that is not a data URL at all", () => {
    expect(validateAvatarDataUrl("not-a-data-url").ok).toBe(false);
    // "gif is not in the supported set"
    expect(validateAvatarDataUrl(`data:image/gif;base64,${makeBase64OfLength(500)}`).ok).toBe(false);
    expect(validateAvatarDataUrl(`data:text/plain;base64,${makeBase64OfLength(500)}`).ok).toBe(false);
    // "svg is deliberately excluded (script risk)"
    expect(validateAvatarDataUrl(`data:image/svg+xml;base64,${makeBase64OfLength(500)}`).ok).toBe(false);
  });

  // Rejected: empty payload
  it("rejects an empty payload", () => {
    expect(validateAvatarDataUrl("data:image/png;base64,").ok).toBe(false);
  });

  // Rejected: over the 100KB cap, right at the boundary is fine.
  //
  // A malicious payload can't smuggle a larger MIME/size claim past the cap
  // by lying about a mismatched declared size — this validator only ever
  // trusts the actual decoded byte length, never a claimed one, so there is
  // no separate "spoofed size" case to test: the byte count is always
  // recomputed from the real base64 payload.
  it("accepts exactly at the cap and rejects one byte over it", () => {
    const atCap = validateAvatarDataUrl(`data:image/png;base64,${makeBase64OfLength(AVATAR_MAX_BYTES)}`);
    // "exactly at the cap is accepted"
    expect(atCap.ok).toBe(true);
    const overCap = validateAvatarDataUrl(`data:image/png;base64,${makeBase64OfLength(AVATAR_MAX_BYTES + 1)}`);
    // "one byte over the cap is rejected"
    expect(overCap.ok).toBe(false);
    if (!overCap.ok) expect(overCap.error).toMatch(/too large/);
  });
});
