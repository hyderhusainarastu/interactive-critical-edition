"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { tabDisabledReason, type WorkProcessingStatus } from "@/components/read/workAttention";
import { WorkContextHeaderTitle } from "./WorkContextHeaderTitle";

/**
 * Persistent work-context tab strip (Stage 4 spec §3.2), seven tabs in the
 * charter's exact order. One implementation-time correction to the spec's
 * own exploratory reasoning: §3.2 describes this as a server component
 * carrying no client state, with only the title-registration half moved
 * into a client leaf. In practice the active tab still has to be derived
 * from the *current route*, which in the App Router is only available via
 * a client hook (`useSelectedLayoutSegment`, the idiomatic primitive a
 * parent layout uses to know which of its own children is active — there
 * is no server-side equivalent). This file is therefore "use client" in
 * full; `WorkContextHeaderTitle` is still mounted as its own leaf per spec,
 * even though nothing would break by inlining its one hook call here,
 * because keeping its lifetime independent and its intent single-purpose
 * costs nothing.
 */

type TabKey = "reader" | "sources" | "roadmap" | "curriculum" | "diagnostic" | "graph" | "details";

interface TabDef {
  key: TabKey;
  label: string;
  /** The child segment `useSelectedLayoutSegment()` reports when this tab
   *  is active — `null` for the Details tab, which is this layout's own
   *  index route with no further segment. */
  segment: string | null;
  href: (workId: string) => string;
  /** True when this tab needs the work to be `ready` and not trashed. */
  gated: boolean;
}

const TABS: TabDef[] = [
  { key: "reader", label: "Reader", segment: "reader", href: (id) => `/works/${id}/reader`, gated: true },
  { key: "sources", label: "Sources", segment: "sources", href: (id) => `/works/${id}/sources`, gated: true },
  { key: "roadmap", label: "Roadmap", segment: "roadmap", href: (id) => `/works/${id}/roadmap`, gated: true },
  { key: "curriculum", label: "Curriculum", segment: "curriculum", href: (id) => `/works/${id}/curriculum`, gated: true },
  { key: "diagnostic", label: "Concept Check", segment: "diagnostic", href: (id) => `/works/${id}/diagnostic`, gated: true },
  // Not gated (spec §3.2): disabling an already-working route would be a
  // functionality loss, which charter §5 forbids — only reachability is in
  // scope here, deeper work-context integration is deferred (spec §9.1).
  { key: "graph", label: "Knowledge Map", segment: "graph", href: (id) => `/works/${id}/graph`, gated: false },
  { key: "details", label: "Details", segment: null, href: (id) => `/works/${id}`, gated: false },
];

export function WorkContextHeader({
  workId,
  title,
  status,
  deletedAt,
}: {
  workId: string;
  title: string;
  status: WorkProcessingStatus;
  deletedAt: string | null;
}) {
  const segment = useSelectedLayoutSegment();
  const reason = tabDisabledReason({ status, deletedAt });

  return (
    <div className="mx-auto max-w-4xl px-6 pt-6">
      <WorkContextHeaderTitle title={title} />
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-[var(--color-text)]">{title}</h1>
      <nav aria-label={`${title} sections`} className="app-reveal mt-4 flex flex-wrap gap-x-5 gap-y-1 overflow-x-auto border-b border-[var(--color-border)] text-sm">
        {TABS.map((tab) => {
          const isActive = segment === tab.segment;
          const disabled = tab.gated && Boolean(reason);
          if (disabled) {
            return (
              <span
                key={tab.key}
                aria-disabled="true"
                title={reason ?? undefined}
                className="flex shrink-0 flex-col items-start gap-0.5 border-b-2 border-transparent pb-2 pt-1 text-[var(--color-text-muted)] opacity-60"
              >
                <span className="font-medium">{tab.label}</span>
                <span className="text-[0.62rem] normal-case tracking-normal">{reason}</span>
              </span>
            );
          }
          return (
            <Link
              key={tab.key}
              href={tab.href(workId)}
              aria-current={isActive ? "page" : undefined}
              className="app-control shrink-0 border-b-2 pb-2 pt-1 font-medium"
              style={{
                borderColor: isActive ? "var(--color-accent-ink)" : "transparent",
                color: isActive ? "var(--color-text)" : "var(--color-text-muted)",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
