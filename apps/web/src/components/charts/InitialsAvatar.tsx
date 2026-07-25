"use client";

import { useState } from "react";
import { avatarBackgroundColor, hueForId, initialsForName } from "./avatarColor";

export interface InitialsAvatarProps {
  /** The user's own id — the deterministic hue's seed, and the initials
   *  fallback's last resort when there is no name at all. */
  userId: string;
  name?: string | null;
  /** A `data:image/...` URL (Workstream G's profile-photo upload — see the
   *  plan's "avatar = data-URL upload into `users.image`" decision) or an
   *  `http(s)://` URL. Validation of the actual bytes/MIME/size happens
   *  server-side at upload time; this component only decides whether to
   *  attempt rendering it and falls back cleanly if it fails to load. */
  imageSrc?: string | null;
  size?: number;
  className?: string;
}

/**
 * A profile avatar: the uploaded image when one exists and loads
 * successfully, otherwise a deterministic-color initials circle (never a
 * generic silhouette) — see `avatarColor.ts` for the pure hue/initials
 * derivation this renders. A plain `<img>` rather than `next/image` is
 * deliberate: the source is a `data:` URL, which `next/image`'s
 * loader/optimization pipeline isn't built for.
 */
export function InitialsAvatar({ userId, name, imageSrc, size = 36, className }: InitialsAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const trimmedName = name?.trim();
  const label = trimmedName && trimmedName.length > 0 ? `${trimmedName} avatar` : "Account avatar";

  if (imageSrc && !imageFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- data: URL avatar; next/image's loader pipeline doesn't handle data URIs.
      <img
        src={imageSrc}
        alt={label}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`rounded-full object-cover ${className ?? ""}`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  const background = avatarBackgroundColor(hueForId(userId));
  const initials = initialsForName(name, userId);
  const fontSize = Math.max(10, Math.round(size * 0.4));

  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-flex select-none items-center justify-center rounded-full font-medium text-white ${className ?? ""}`}
      style={{ width: size, height: size, background, fontSize }}
    >
      {initials}
    </span>
  );
}
