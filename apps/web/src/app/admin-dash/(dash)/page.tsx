import { AnimatedStat, LineChart, type AnimatedStatFormat } from "@/components/charts";
import { requireAdminDash } from "@/lib/adminDash";
import { getAdminOverview } from "@/lib/adminDashData";

// `AnimatedStat` is a Client Component; a Server Component page like this
// one can only hand it a preset FORMAT NAME, never a format FUNCTION
// (functions can't cross the server->client boundary — see
// AnimatedStat.tsx's own doc comment for the real error this produced
// before the preset shape existed).
function StatTile({ label, value, format }: { label: string; value: number; format?: AnimatedStatFormat }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-lg font-semibold text-[var(--color-text)]">
        <AnimatedStat value={value} format={format} label={label} />
      </p>
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}

/**
 * Workstream H (v.5) overview — the one page allowed to show spend (plan
 * §H: "AI spend $ — admin sees cost", the sanctioned exception to the
 * project's no-user-facing-cost-figures rule).
 */
export default async function AdminDashOverviewPage() {
  await requireAdminDash();
  const overview = await getAdminOverview();

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="overview-tiles-heading">
        <h2 id="overview-tiles-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Platform
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Active users" value={overview.tiles.activeUsers} />
          <StatTile label="Deleted accounts" value={overview.tiles.deletedUsers} />
          <StatTile label="Documents" value={overview.tiles.documents} />
          <StatTile label="Storage used" value={overview.tiles.storageBytes} format="bytes" />
          <StatTile label="AI spend" value={overview.tiles.aiSpendUsd} format="usd" />
          <StatTile label="Tokens (prompt + completion)" value={overview.tiles.totalTokens} />
          <StatTile label="Ask Library messages" value={overview.tiles.chatMessages} />
          <StatTile label="Page views" value={overview.tiles.pageViews} />
        </div>
      </section>

      <section aria-labelledby="daily-trends-heading">
        <h2 id="daily-trends-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Last 30 days
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="app-card rounded-lg p-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text)]">AI spend</h3>
            <LineChart
              series={[{ label: "Spend (USD)", values: overview.daily.spend }]}
              xLabels={overview.daily.labels}
              yFormat={(v) => `$${v.toFixed(2)}`}
              title="AI spend per day, last 30 days"
              emptyLabel="No AI spend in the last 30 days."
            />
          </div>
          <div className="app-card rounded-lg p-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text)]">Uploads</h3>
            <LineChart
              series={[{ label: "Documents uploaded", values: overview.daily.uploads }]}
              xLabels={overview.daily.labels}
              title="Documents uploaded per day, last 30 days"
              emptyLabel="No uploads in the last 30 days."
            />
          </div>
          <div className="app-card rounded-lg p-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text)]">Ask Library questions</h3>
            <LineChart
              series={[{ label: "Questions asked", values: overview.daily.chats }]}
              xLabels={overview.daily.labels}
              title="Ask Library questions per day, last 30 days"
              emptyLabel="No Ask Library activity in the last 30 days."
            />
          </div>
          <div className="app-card rounded-lg p-4">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text)]">Signups</h3>
            <LineChart
              series={[{ label: "New accounts", values: overview.daily.signups }]}
              xLabels={overview.daily.labels}
              title="New accounts per day, last 30 days"
              emptyLabel="No signups in the last 30 days."
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="run-health-heading">
        <h2 id="run-health-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Critical-edition run health
        </h2>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Runs" value={overview.runHealth.totalRuns} />
          <StatTile label="Published" value={overview.runHealth.publishedRuns} />
          <StatTile label="Degraded" value={overview.runHealth.degradedRuns} />
          <StatTile label="Research cost" value={overview.runHealth.researchCostUsd} format="usd" />
        </div>
        {overview.runHealth.byStage.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {overview.runHealth.byStage.map((r) => (
              <span
                key={`${r.status}/${r.stage ?? "—"}`}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)]"
              >
                {r.status}
                {r.stage ? ` · ${r.stage}` : ""}: <span className="tabular-nums text-[var(--color-text)]">{r.count}</span>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
