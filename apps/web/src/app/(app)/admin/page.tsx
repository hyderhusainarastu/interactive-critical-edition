import { aiUsageLogs, bibliographicRecords, db, processingJobs, processingRuns, providerAttempts, researchCache } from "@ice/db";
import { desc, eq, sql } from "drizzle-orm";
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

  // ---- v2 critical-edition pipeline (plan §33 §3.4) ----
  const runsByStage = await db
    .select({ status: processingRuns.status, stage: processingRuns.stage, count: sql<number>`count(*)` })
    .from(processingRuns)
    .groupBy(processingRuns.status, processingRuns.stage)
    .orderBy(desc(sql`count(*)`));
  const [runAgg] = await db
    .select({
      total: sql<number>`count(*)`,
      published: sql<number>`count(*) filter (where ${processingRuns.isPublished})`,
      full: sql<number>`count(*) filter (where ${processingRuns.structureState} = 'full')`,
      limited: sql<number>`count(*) filter (where ${processingRuns.structureState} = 'limited')`,
      degraded: sql<number>`count(*) filter (where ${processingRuns.degraded})`,
      cost: sql<number>`coalesce(sum(${processingRuns.aiCostUsd}), 0)`,
    })
    .from(processingRuns);
  const providerStats = await db
    .select({ provider: providerAttempts.provider, status: providerAttempts.status, count: sql<number>`count(*)` })
    .from(providerAttempts)
    .groupBy(providerAttempts.provider, providerAttempts.status);
  const recentSaturation = await db
    .select({ id: processingRuns.id, version: processingRuns.version, note: processingRuns.saturationNote, updatedAt: processingRuns.updatedAt })
    .from(processingRuns)
    .where(eq(processingRuns.degraded, true))
    .orderBy(desc(processingRuns.updatedAt))
    .limit(8);

  // Maintenance: result-cache size + expired rows, and orphaned catalogue
  // records (no analysis references — the documented orphan-sweep candidates).
  const [cacheStats] = await db
    .select({
      total: sql<number>`count(*)`,
      expired: sql<number>`count(*) filter (where ${researchCache.expiresAt} < now())`,
    })
    .from(researchCache);
  const [orphanBib] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bibliographicRecords)
    .where(sql`
      NOT EXISTS (SELECT 1 FROM research_resource rr WHERE rr.bib_record_id = ${bibliographicRecords.id})
      AND NOT EXISTS (SELECT 1 FROM citation c WHERE c.resolved_bib_id = ${bibliographicRecords.id})
      AND NOT EXISTS (SELECT 1 FROM annotation a WHERE a.target_bib_id = ${bibliographicRecords.id})
      AND NOT EXISTS (SELECT 1 FROM graph_edge g WHERE g.target_id = ${bibliographicRecords.id} AND g.target_type = 'bibliographic_record')
    `);

  // Pivot provider stats into provider -> {status: count}.
  const providerPivot = new Map<string, Record<string, number>>();
  for (const row of providerStats) {
    const entry = providerPivot.get(row.provider) ?? {};
    entry[row.status] = Number(row.count);
    providerPivot.set(row.provider, entry);
  }
  const providerRows = [...providerPivot.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const PROVIDER_STATUSES = ["queried", "rate_limited", "unavailable", "failed", "disabled"] as const;

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

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Critical editions (v2)</h2>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="Runs" value={Number(runAgg?.total ?? 0)} />
          <Stat label="Published" value={Number(runAgg?.published ?? 0)} />
          <Stat label="Full structure" value={Number(runAgg?.full ?? 0)} />
          <Stat label="Limited" value={Number(runAgg?.limited ?? 0)} />
          <Stat label="Degraded" value={Number(runAgg?.degraded ?? 0)} />
          <Stat label="Research cost" value={`$${Number(runAgg?.cost ?? 0).toFixed(4)}`} />
        </div>

        {runsByStage.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            {runsByStage.map((r) => (
              <span key={`${r.status}/${r.stage}`} className="rounded border border-[var(--color-border)] px-2 py-1 text-[var(--color-text-muted)]">
                {r.status}{r.stage ? ` · ${r.stage}` : ""}: <span className="tabular-nums text-[var(--color-text)]">{Number(r.count)}</span>
              </span>
            ))}
          </div>
        )}

        {providerRows.length > 0 && (
          <div className="mb-4 overflow-x-auto">
            <h3 className="mb-1 text-sm font-medium">Provider availability</h3>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th className="py-1 pr-4 font-medium">Provider</th>
                  {PROVIDER_STATUSES.map((s) => <th key={s} className="py-1 pr-4 font-medium">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {providerRows.map(([provider, stats]) => (
                  <tr key={provider} className="border-b border-[var(--color-border)]">
                    <td className="py-1 pr-4 text-[var(--color-text)]">{provider}</td>
                    {PROVIDER_STATUSES.map((s) => <td key={s} className="py-1 pr-4 tabular-nums text-[var(--color-text-muted)]">{stats[s] ?? 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {recentSaturation.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-1 text-sm font-medium text-[var(--color-accent-ink)]">Degraded / saturated runs</h3>
            <ul className="flex flex-col gap-1 text-sm text-[var(--color-text-muted)]">
              {recentSaturation.map((r) => (
                <li key={r.id} className="truncate">v{r.version} — {r.note ?? "degraded extraction / research"}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Cache rows" value={Number(cacheStats?.total ?? 0)} />
          <Stat label="Cache expired" value={Number(cacheStats?.expired ?? 0)} />
          <Stat label="Orphan catalogue" value={Number(orphanBib?.count ?? 0)} />
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Expired cache rows are swept on worker startup. Orphan catalogue = bibliographic records no analysis references (eventual cleanup).
        </p>
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
