"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/account/profile", label: "Profile" },
  { href: "/account/usage", label: "Usage" },
  { href: "/account/plan", label: "Plan" },
];

/** Small client boundary so the tab underline can use `usePathname()` — same
 *  active-link pattern as `AppShell.tsx`'s primary nav — without forcing the
 *  whole `/account/*` page tree to be a client component. */
export function AccountTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-[var(--color-border)]" aria-label="Account sections">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`app-control -mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? "border-[var(--color-accent-ink)] text-[var(--color-text)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
