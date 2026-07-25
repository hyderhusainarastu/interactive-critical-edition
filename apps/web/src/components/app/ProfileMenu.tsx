"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { InitialsAvatar } from "@/components/charts";
import { logoutAction } from "@/lib/actions";

const PROFILE_LINKS = [
  { href: "/account/profile", label: "Profile" },
  { href: "/account/usage", label: "Usage" },
  { href: "/account/plan", label: "Plan" },
];

/**
 * Structured exactly like `AppShell.tsx`'s `PreferencesMenu` (relative
 * wrapper, `aria-expanded`/`aria-controls` trigger, absolute `role="dialog"`
 * panel with `app-panel-enter`, Escape closes, focus returns to the trigger
 * via `requestAnimationFrame`) — same interaction contract, different
 * content. Replaces the header's standalone `hidden lg:block` "Log out"
 * form; `MobileDrawer`'s own logout is untouched (out of this menu's reach
 * below `md`).
 */
export function ProfileMenu({
  id,
  name,
  email,
  image,
  userId,
  onClose,
}: {
  id: string;
  name: string | null | undefined;
  email: string | null | undefined;
  image: string | null | undefined;
  userId: string;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <section
      id={id}
      role="dialog"
      className="app-panel-enter absolute end-0 top-11 z-40 w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-xl"
      aria-label="Account menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <InitialsAvatar userId={userId} name={name} imageSrc={image} size={36} />
          <div className="min-w-0">
            {name && <p className="truncate text-sm font-medium text-[var(--color-text)]">{name}</p>}
            <p className="truncate text-xs text-[var(--color-text-muted)]">{email}</p>
          </div>
        </div>
        <button ref={closeButtonRef} type="button" className="app-control app-icon-button h-7 w-7" aria-label="Close account menu" onClick={onClose}>×</button>
      </div>
      <nav className="flex flex-col" aria-label="Account">
        {PROFILE_LINKS.map((link) => (
          <Link key={link.href} href={link.href} data-sound="click" onClick={onClose} className="app-control rounded-md px-2 py-1.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]">
            {link.label}
          </Link>
        ))}
        <button
          type="button"
          className="app-control rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]"
          onClick={() => {
            onClose();
            window.dispatchEvent(new CustomEvent("palimnote:open-feedback"));
          }}
        >
          Feedback
        </button>
      </nav>
      <form action={logoutAction} className="mt-2 border-t border-[var(--color-border)] pt-2">
        <button type="submit" className="app-control w-full rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]">
          Sign out
        </button>
      </form>
    </section>
  );
}
