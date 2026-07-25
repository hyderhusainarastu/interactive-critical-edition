// Relative-only imports, no `@ice/db`/`@/*` alias: this module is pure
// (no I/O, no DB) and invoked directly via bare `tsx` for its unit test —
// same portability convention as `components/graph/graphSceneScaling.ts`.

/**
 * Workstream G (v.5) avatar upload — `AccountProfileForm.tsx`'s client-side
 * downscale produces a `data:image/...;base64,...` URL that lands directly
 * in `users.image` (the owner-authorized "data-URL upload" decision — see
 * docs/PROJECT-LOG.md: the `documents` Storage bucket's PDF/TXT/MD MIME
 * allowlist blocks image objects, and `next.config` has no images loader
 * configured, so a separate Storage/CDN path isn't available here). This
 * module holds the two PURE decisions around that upload — what dimensions
 * a downscale should target, and whether a submitted data URL is a
 * plausible small image — kept separate from the client component (which
 * needs a real `<canvas>`/`Image`) and the server action (which needs
 * `@ice/db`) so both can share one tested source of truth for the 100KB cap.
 */

/** Post-encode byte cap (the compressed image payload, not raw pixels). */
export const AVATAR_MAX_BYTES = 100 * 1024;

/** Client-side downscale target — an avatar never needs to be larger than
 *  this on any surface it's rendered (profile card, ProfileMenu header, nav
 *  trigger), so downscaling before compression keeps the 100KB cap
 *  reachable without visibly ugly compression artifacts. */
export const AVATAR_MAX_DIMENSION = 256;

const SUPPORTED_AVATAR_MIME_TYPES = ["png", "jpeg", "webp"] as const;
export type SupportedAvatarMimeType = (typeof SUPPORTED_AVATAR_MIME_TYPES)[number];

const AVATAR_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/;

/**
 * Target dimensions for a client-side canvas downscale: unchanged if
 * already within `maxDimension` on both axes, otherwise scaled down
 * (preserving aspect ratio) so the longer edge equals `maxDimension`.
 * Never upscales — a small source image stays small.
 */
export function clampAvatarDimensions(
  width: number,
  height: number,
  maxDimension: number = AVATAR_MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: maxDimension, height: maxDimension };
  if (width <= maxDimension && height <= maxDimension) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Decoded byte length of a base64 payload (ignoring `=` padding), without
 *  allocating a Buffer — cheap enough to call on every keystroke-adjacent
 *  upload attempt, and identical on both the browser (no Buffer) and the
 *  server action that re-validates it. */
export function base64ByteLength(base64: string): number {
  const withoutPadding = base64.replace(/=+$/, "");
  return Math.floor((withoutPadding.length * 3) / 4);
}

export type AvatarValidationResult =
  | { ok: true; mimeType: SupportedAvatarMimeType; bytes: number }
  | { ok: false; error: string };

/**
 * Server-side re-validation of a submitted avatar data URL — never trusts
 * that the client's own downscale actually ran. Checks the `data:image/
 * (png|jpeg|webp);base64,` prefix and the decoded byte size, nothing else
 * (no image-library decode here; the browser's own `<img>` render is the
 * only place this ever gets interpreted as pixels, same as
 * `InitialsAvatar.tsx`'s plain `<img src={dataUrl}>`).
 */
export function validateAvatarDataUrl(dataUrl: string, maxBytes: number = AVATAR_MAX_BYTES): AvatarValidationResult {
  const trimmed = dataUrl.trim();
  const match = AVATAR_DATA_URL_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false, error: "That doesn't look like a supported image (PNG, JPEG, or WebP)." };
  }
  const mimeType = match[1] as SupportedAvatarMimeType;
  const bytes = base64ByteLength(match[2]);
  if (bytes === 0) {
    return { ok: false, error: "That image appears to be empty." };
  }
  if (bytes > maxBytes) {
    return { ok: false, error: `That image is too large (${Math.ceil(bytes / 1024)}KB) — choose a smaller photo.` };
  }
  return { ok: true, mimeType, bytes };
}
