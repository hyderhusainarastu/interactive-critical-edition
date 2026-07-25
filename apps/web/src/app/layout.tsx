import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_NAME } from "@/lib/brand";
import { PreferenceBootstrap } from "@/components/app/PreferenceBootstrap";
import { InteractionSoundRoot } from "@/components/app/InteractionSoundRoot";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: SITE_NAME,
  description:
    "A text is never alone. Upload a difficult scholarly work and get a traceable critical edition around it — resolved citations, passage-anchored annotations, a unified Library, dependency-ordered reading routes, an explorable knowledge graph, and answers grounded in your own library.",
};

/**
 * `PageTransition` deliberately does NOT wrap `{children}` here anymore.
 * It used to (cross-fading every route change), but for `(app)` routes
 * `{children}` resolves to `AppShell` — header, account/preferences menus,
 * command palette, mobile drawer — not just the routed page content. An
 * authenticated route's async Server Component work (dashboard's DB
 * queries, etc.) streams in over one or more chunks after the shell's
 * initial paint, and `AnimatePresence`'s `mode="wait"` bookkeeping reacts
 * to that late-arriving content by tearing down and rebuilding the whole
 * wrapped subtree a second time, ~150-200ms after first mount — silently
 * discarding any `useState` in between, including a menu a user had just
 * opened. Reproduced live: the account and preferences menus opening then
 * instantly closing was this exact remount. `AppShell.tsx` now applies
 * `PageTransition` itself, scoped to only `<main>`'s routed content, so
 * the persistent chrome around it never sits inside the animated/remounting
 * boundary. Non-`(app)` routes (auth pages, landing, privacy/terms/
 * development) lose the root-level cross-fade as a result — an accepted,
 * purely cosmetic trade-off; none of them hold interactive state that a
 * remount could lose the way the app shell's menus did.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head><PreferenceBootstrap /></head>
      <body className="min-h-full flex flex-col"><InteractionSoundRoot>{children}</InteractionSoundRoot></body>
    </html>
  );
}
