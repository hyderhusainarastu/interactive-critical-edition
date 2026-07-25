"use client";

import { useActionState, useRef, useState } from "react";
import { InitialsAvatar } from "@/components/charts";
import { updateProfileAction, type UpdateProfileState } from "@/lib/accountActions";
import { AVATAR_MAX_BYTES, AVATAR_MAX_DIMENSION, base64ByteLength, clampAvatarDimensions } from "@/lib/avatarUpload";

const INITIAL_STATE: UpdateProfileState = { status: "idle" };

/**
 * Client-side downscale: draws the source image onto a canvas at the
 * `clampAvatarDimensions()` target, then re-encodes at decreasing JPEG
 * quality until the resulting data URL fits `AVATAR_MAX_BYTES` (100KB) —
 * the server (`updateProfileAction` → `validateAvatarDataUrl`) re-checks
 * the same cap and never trusts this ran. JPEG (not PNG/WebP) is used for
 * the compression sweep specifically because it's the one format with a
 * quality dial that reliably trades size for fidelity on a photo; a
 * transparent PNG source still downscales fine, just loses alpha (avatars
 * are cropped to a circle in the UI regardless).
 */
async function downscaleToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = clampAvatarDimensions(bitmap.width, bitmap.height, AVATAR_MAX_DIMENSION);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.9;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (base64ByteLength(dataUrl.split(",")[1] ?? "") > AVATAR_MAX_BYTES && quality > 0.2) {
    quality -= 0.15;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return dataUrl;
}

export function AccountProfileForm({
  userId,
  name,
  email,
  image,
}: {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, INITIAL_STATE);
  const [preview, setPreview] = useState<string | null>(image);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string>("");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      return;
    }
    setAvatarError(null);
    try {
      const dataUrl = await downscaleToDataUrl(file);
      setAvatarDataUrl(dataUrl);
      setPreview(dataUrl);
      setRemoveAvatar(false);
    } catch {
      setAvatarError("That image couldn't be processed — try a different photo.");
    }
  }

  return (
    <section className="app-card rounded-lg p-5" aria-labelledby="profile-form-heading">
      <h2 id="profile-form-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Profile</h2>
      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {preview && !removeAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL preview; next/image's loader doesn't handle data URIs.
            <img src={preview} alt="" width={64} height={64} className="rounded-full object-cover" style={{ width: 64, height: 64 }} />
          ) : (
            <InitialsAvatar userId={userId} name={name} size={64} />
          )}
          <div className="flex flex-col gap-1.5">
            <button type="button" className="app-control rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm" onClick={() => fileInputRef.current?.click()}>
              Change photo
            </button>
            {(preview && !removeAvatar) && (
              <button
                type="button"
                className="app-control text-left text-xs text-[var(--color-text-muted)] underline"
                onClick={() => {
                  setPreview(null);
                  setAvatarDataUrl("");
                  setRemoveAvatar(true);
                }}
              >
                Remove photo
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Upload profile photo" onChange={handleFileChange} />
            {avatarError && <p role="alert" className="text-xs text-[var(--color-accent-burgundy)]">{avatarError}</p>}
          </div>
        </div>
        <input type="hidden" name="avatarDataUrl" value={avatarDataUrl} />
        <input type="hidden" name="removeAvatar" value={removeAvatar ? "1" : ""} />

        <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
          Name
          <input name="name" type="text" defaultValue={name ?? ""} required maxLength={200} className="app-control rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2" />
        </label>
        <p className="text-sm text-[var(--color-text-muted)]">{email}</p>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="app-control rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60">
            {pending ? "Saving…" : "Save changes"}
          </button>
          {state.status === "success" && <p className="text-sm text-[var(--color-text-muted)]" role="status">Saved.</p>}
          {state.status === "error" && <p className="text-sm text-[var(--color-accent-burgundy)]" role="alert">{state.message}</p>}
        </div>
      </form>
    </section>
  );
}
