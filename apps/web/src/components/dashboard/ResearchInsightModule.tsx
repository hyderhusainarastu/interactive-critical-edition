import Link from "next/link";
import type { ResearchInsightCounts } from "@/lib/researchDashboard";

/**
 * Compact, zero-LLM research insight-feed module for the signed-in
 * dashboard (Phase 29.3 reverse-direction lane — "ScholarLens's pure-DB-read
 * dashboard pattern... as a Palimnote dashboard module"). Purely
 * presentational: `page.tsx` decides whether to render this at all
 * (flag-off or all-zero-and-no-projects both mean "don't mount it", per
 * `hasResearchInsightSignal`) — this component itself never fabricates an
 * empty state.
 *
 * Styling matches the dashboard's own existing stat-tile cards
 * (`.app-card`/`.app-mount`, `.app-control` for the interactive link) — the
 * same primitives already used a few lines up in `page.tsx`, which already
 * only animate under `prefers-reduced-motion: no-preference` (see
 * `globals.css`), so no new motion/reduced-motion handling is needed here.
 */
export function ResearchInsightModule({ counts }: { counts: ResearchInsightCounts }) {
  const stats: Array<{ label: string; value: number; emphasize?: boolean }> = [
    { label: "Active projects", value: counts.activeProjects },
    { label: "Claims awaiting review", value: counts.claimsAwaitingReview },
    { label: "New contradictions (7d)", value: counts.newContradictions, emphasize: counts.newContradictions > 0 },
    { label: "Active debates", value: counts.activeDebateClusters },
    { label: "Jobs running", value: counts.runningJobs },
    { label: "Jobs failed", value: counts.failedJobs, emphasize: counts.failedJobs > 0 },
  ];

  return (
    <section className="app-card app-mount rounded-lg px-5 py-4" aria-label="Research activity" data-research-insight-module>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-[var(--color-text)]">Research activity</h2>
        <Link href="/research" className="app-control text-xs underline text-[var(--color-text-muted)]">
          Open Research →
        </Link>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Research insight counts">
        {stats.map((stat) => (
          <li key={stat.label}>
            <div
              className="text-xl font-semibold"
              data-stat-value
              style={{ color: stat.emphasize ? "var(--color-credibility-warning)" : "var(--color-text)" }}
            >
              {stat.value}
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">{stat.label}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
