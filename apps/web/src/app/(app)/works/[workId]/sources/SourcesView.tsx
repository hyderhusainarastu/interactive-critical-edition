import Link from "next/link";
import type { LibraryItem } from "@/lib/library";
import { CredibilityMeter } from "@/components/CredibilityMeter";
import { CATEGORY_META } from "@/components/shared/annotationMeta";
import { AuthorityBadge, type Authority } from "../reader/EditionReader";

/**
 * One work's own resolved sources (Stage 4 read spec §3.4) — unfiltered,
 * un-paginated at realistic single-work scale, reusing the same visual
 * language `LibraryView.tsx` uses for a Library row rather than the
 * component itself (that page is a full search/filter surface over the
 * *whole* library; this is a plain, unfiltered list scoped to one work).
 * Each card links to `/library/[resourceId]` for full detail, credibility
 * evidence, and (when eligible) the "acquire this source" flow, rather than
 * duplicating that page's own logic here.
 */
export function SourcesView({ title, items }: { title: string; items: LibraryItem[] }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 pb-12 pt-6">
      <p className="text-sm text-[var(--color-text-muted)]">
        Every source the research pipeline recommended for &ldquo;{title}&rdquo;, with its credibility, provenance, and
        access status. Not settled scholarship — verify against the sources themselves.
      </p>

      {items.length === 0 ? (
        <p className="app-empty app-mount rounded-lg px-5 py-8 text-[var(--color-text-muted)]">
          No sources have been resolved for this work yet.
        </p>
      ) : (
        <ul className="app-reveal-stagger flex flex-col gap-3">
          {items.map((item) => (
            <SourceCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceCard({ item }: { item: LibraryItem }) {
  const primaryRole = item.roles[0];
  return (
    <li className="app-card app-lift app-mount rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/library/${item.id}`} className="font-medium text-[var(--color-text)] underline">
            {item.title}
          </Link>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {item.authors.length > 0 ? `${item.authors.join(", ")} · ` : ""}
            {item.year ? `${item.year} · ` : ""}
            {item.provider}
          </p>
        </div>
        {primaryRole && (
          <span className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[0.68rem] uppercase tracking-wide text-[var(--color-text-muted)]">
            {CATEGORY_META[primaryRole.relationship as keyof typeof CATEGORY_META]?.label ?? primaryRole.relationship}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.credibility ? (
          <>
            {item.credibility.authority && <AuthorityBadge authority={item.credibility.authority as Authority} />}
            <CredibilityMeter score={item.credibility.score} />
          </>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">
            {item.credibilityAbsence === "cited-not-assessed"
              ? "Cited — not independently assessed"
              : item.credibilityAbsence === "stale-assessment"
                ? "Credibility assessment unavailable for the current run"
                : "Credibility not assessed"}
          </span>
        )}
        {item.peerReviewed === true && <span className="text-xs text-[var(--color-text-muted)]">· Peer reviewed</span>}
        {item.hasAssociatedWork && (
          <span className="text-xs text-[var(--color-accent-green)]">· Already in your library</span>
        )}
      </div>

      {primaryRole?.rationale && <p className="mt-2 text-sm text-[var(--color-text-muted)]">{primaryRole.rationale}</p>}

      {item.attached.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-2 text-xs text-[var(--color-text-muted)]">
          {item.attached.map((related) => (
            <li key={related.id}>
              <span className="capitalize">{related.role}</span>: {related.url ? (
                <a href={related.url} target="_blank" rel="noreferrer" className="underline">
                  {related.title}
                </a>
              ) : (
                related.title
              )}
            </li>
          ))}
        </ul>
      )}

      {!item.hasAssociatedWork && (
        <Link href={`/library/${item.id}`} className="app-control mt-2 inline-block text-xs underline">
          View in Library →
        </Link>
      )}
    </li>
  );
}
