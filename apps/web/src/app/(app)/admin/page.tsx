import { aiUsageLogs, db, processingJobs } from "@ice/db";
import { desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";

/**
 * Admin dashboard (plan §20): platform counts, the AI cost/usage view over
 * `ai_usage_logs`, and processing-job health. Read-only aggregates — no
 * user content is surfaced here (support tooling that needs content would
 * be a separate, audit-logged action per §20). Admin-gated (404 otherwise).
 */
export default async function AdminPage() {
  await requireAdmin();

  const [counts] = await db
    .select({
      users: sql<number>`(select count(*) from "user")`,
      works: sql<number>`(select count(*) from work)`,
      documents: sql<number>`(select count(*) from document)`,
      annotations: sql<number>`(select count(*) from annotation)`,
    })
    .from(sql`(select 1) as _`);

  const usageByModel = await db
    .select({
      model: aiUsageLogs.model,
      provider: aiUsageLogs.provider,
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`coalesce(sum(${aiUsageLogs.promptTokens}), 0)`,
      completionTokens: sql<number>`coalesce(sum(${aiUsageLogs.completionTokens}), 0)`,
      cost: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)`,
    })
    .from(aiUsageLogs)
    .groupBy(aiUsageLogs.model, aiUsageLogs.provider)
    .orderBy(desc(sql`count(*)`));

  const totalCost = usageByModel.reduce((s, r) => s + Number(r.cost), 0);
  const totalCalls = usageByModel.reduce((s, r) => s + Number(r.calls), 0);

  const jobStatus = await db
    .select({ status: processingJobs.status, count: sql<number>`count(*)` })
    .from(processingJobs)
    .groupBy(processingJobs.status);

  const recentFailed = await db
    .select({ id: processingJobs.id, jobType: processingJobs.jobType, error: processingJobs.error, updatedAt: processingJobs.updatedAt })
    .from(processingJobs)
    .where(sql`${processingJobs.status} = 'failed'`)
    .orderBy(desc(processingJobs.updatedAt))
    .limit(10);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold text-[var(--color-text)]">Admin</h1>
      <p className="mb-6 text-sm text-[var(--color-text-muted)]">
        Platform health and AI spend. Read-only aggregates — no user content is shown here.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Platform</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Users" value={counts.users} />
          <Stat label="Works" value={counts.works} />
          <Stat label="Documents" value={counts.documents} />
          <Stat label="Annotations" value={counts.annotations} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          AI usage &amp; cost
        </h2>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Total calls" value={totalCalls} />
          <Stat label="Estimated cost" value={`$${totalCost.toFixed(4)}`} />
          <Stat label="Models used" value={usageByModel.length} />
        </div>
        {usageByModel.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No AI calls logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 font-medium">Calls</th>
                  <th className="py-2 pr-4 font-medium">Prompt tok</th>
                  <th className="py-2 pr-4 font-medium">Completion tok</th>
                  <th className="py-2 pr-4 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usageByModel.map((r) => (
                  <tr key={`${r.provider}/${r.model}`} className="border-b border-[var(--color-border)]">
                    <td className="py-2 pr-4 text-[var(--color-text)]">
                      {r.model}
                      <span className="text-[var(--color-text-muted)]"> · {r.provider}</span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{Number(r.calls)}</td>
                    <td className="py-2 pr-4 tabular-nums">{Number(r.promptTokens)}</td>
                    <td className="py-2 pr-4 tabular-nums">{Number(r.completionTokens)}</td>
                    <td className="py-2 pr-4 tabular-nums">${Number(r.cost).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Processing jobs
        </h2>
        <div className="mb-3 flex flex-wrap gap-3">
          {jobStatus.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No jobs yet.</p>
          ) : (
            jobStatus.map((s) => <Stat key={s.status} label={s.status} value={Number(s.count)} />)
          )}
        </div>
        {recentFailed.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium text-[var(--color-accent-burgundy)]">Recent failures</h3>
            <ul className="flex flex-col gap-1 text-sm text-[var(--color-text-muted)]">
              {recentFailed.map((j) => (
                <li key={j.id} className="truncate">
                  <span className="font-mono text-xs">{j.jobType}</span> — {j.error ?? "unknown error"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-lg font-semibold tabular-nums text-[var(--color-text)]">{value}</p>
      <p className="text-xs capitalize text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}
