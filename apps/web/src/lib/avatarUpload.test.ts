import assert from "node:assert/strict";
import { AVATAR_MAX_BYTES, base64ByteLength, clampAvatarDimensions, validateAvatarDataUrl } from "./avatarUpload";

/**
 * Pure module, no `@ice/db`/`@/*` import — run directly:
 *   pnpm --filter web exec tsx apps/web/src/lib/avatarUpload.test.ts
 * (same convention as `foreignSpans.test.ts`/`graphSceneScaling.test.ts`).
 */

function makeBase64OfLength(byteLength: number): string {
  return Buffer.alloc(byteLength, 1).toString("base64");
}

function main() {
  // clampAvatarDimensions
  assert.deepEqual(clampAvatarDimensions(120, 80), { width: 120, height: 80 }, "already within bounds is unchanged");
  assert.deepEqual(clampAvatarDimensions(1024, 512), { width: 256, height: 128 }, "downscales preserving aspect ratio, longer edge hits the cap");
  assert.deepEqual(clampAvatarDimensions(512, 1024), { width: 128, height: 256 });
  assert.deepEqual(clampAvatarDimensions(256, 256), { width: 256, height: 256 }, "exactly at the cap is unchanged");
  assert.deepEqual(clampAvatarDimensions(0, 0), { width: 256, height: 256 }, "degenerate input falls back to the cap rather than 0x0");

  // base64ByteLength
  const oneKb = makeBase64OfLength(1024);
  assert.equal(base64ByteLength(oneKb), 1024);
  assert.equal(base64ByteLength(""), 0);

  // validateAvatarDataUrl — accepted shapes
  const smallPng = `data:image/png;base64,${makeBase64OfLength(500)}`;
  const okPng = validateAvatarDataUrl(smallPng);
  assert.equal(okPng.ok, true);
  if (okPng.ok) {
    assert.equal(okPng.mimeType, "png");
    assert.equal(okPng.bytes, 500);
  }
  assert.equal(validateAvatarDataUrl(`data:image/jpeg;base64,${makeBase64OfLength(500)}`).ok, true);
  assert.equal(validateAvatarDataUrl(`data:image/webp;base64,${makeBase64OfLength(500)}`).ok, true);

  // Rejected: wrong prefix / unsupported type / not a data URL at all
  assert.equal(validateAvatarDataUrl("not-a-data-url").ok, false);
  assert.equal(validateAvatarDataUrl(`data:image/gif;base64,${makeBase64OfLength(500)}`).ok, false, "gif is not in the supported set");
  assert.equal(validateAvatarDataUrl(`data:text/plain;base64,${makeBase64OfLength(500)}`).ok, false);
  assert.equal(validateAvatarDataUrl(`data:image/svg+xml;base64,${makeBase64OfLength(500)}`).ok, false, "svg is deliberately excluded (script risk)");

  // Rejected: empty payload
  assert.equal(validateAvatarDataUrl("data:image/png;base64,").ok, false);

  // Rejected: over the 100KB cap, right at the boundary is fine
  const atCap = validateAvatarDataUrl(`data:image/png;base64,${makeBase64OfLength(AVATAR_MAX_BYTES)}`);
  assert.equal(atCap.ok, true, "exactly at the cap is accepted");
  const overCap = validateAvatarDataUrl(`data:image/png;base64,${makeBase64OfLength(AVATAR_MAX_BYTES + 1)}`);
  assert.equal(overCap.ok, false, "one byte over the cap is rejected");
  if (!overCap.ok) assert.match(overCap.error, /too large/);

  // A malicious payload can't smuggle a larger MIME/size claim past the cap
  // by lying about a mismatched declared size — this validator only ever
  // trusts the actual decoded byte length, never a claimed one, so there is
  // no separate "spoofed size" case to test: the byte count is always
  // recomputed from the real base64 payload.

  console.log("avatarUpload.test.ts: all assertions passed");
}

main();
