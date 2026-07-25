import { notFound } from "next/navigation";
import Link from "next/link";
import { Sparkline } from "@/components/charts";
import { requireAdminDash } from "@/lib/adminDash";
import { getAdminUserDetail } from "@/lib/adminDashData";

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const READER_LEVEL_LABEL: Record<string, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
};

function readerLevelText(level: string | null): string {
  return level ? (READER_LEVEL_LABEL[level] ?? level) : "Not set";
}

/**
 * Workstream H (v.5) user drill-down. THE PRIVACY GATE is enforced entirely
 * inside `getAdminUserDetail` (see `adminDashData.ts`'s header comment) —
 * this page only ever renders `detail.transcripts`, which is `null`
 * whenever the gate is closed. There is no conditional-rendering fallback
 * here that could accidentally show gated content; the content simply
 * never arrives from the query layer to begin with.
 */
export default async function AdminDashUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminDash();
  const { id } = await params;
  const detail = await getAdminUserDetail(id);
  if (!detail) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/admin-dash/users" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          ← Back to users
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="font-serif text-xl font-semibold text-[var(--color-text)]">{detail.email}</h2>
          {detail.status === "deleted" && (
            <span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-accent-burgundy)]">
              Deleted {formatDateTime(detail.deletedAt)}
            </span>
          )}
        </div>
        {detail.name && <p className="text-sm text-[var(--color-text-muted)]">{detail.name}</p>}
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Joined {formatDateTime(detail.createdAt)} · id {detail.userId}
        </p>
      </div>

      <section aria-labelledby="user-stats-heading">
        <h3 id="user-stats-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Activity
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Documents" value={String(detail.docsProcessed)} />
          <Stat label="AI spend" value={`$${detail.totalAiCostUsd.toFixed(4)}`} />
          <Stat label="Chat messages" value={String(detail.chatMessages)} />
          <Stat label="Last active" value={formatDateTime(detail.lastActiveAt)} />
          {detail.storageBytes !== null && <Stat label="Storage used" value={`${(detail.storageBytes / (1024 * 1024)).toFixed(2)} MB`} />}
        </div>
      </section>

      <section aria-labelledby="reader-level-heading">
        <h3 id="reader-level-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Reader level
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Stat label="Self-chosen" value={readerLevelText(detail.readerLevelSelfChosen)} />
          <Stat
            label="Inferred from completions"
            value={detail.status === "deleted" ? "Not available (account deleted)" : readerLevelText(detail.readerLevelInferred)}
          />
        </div>
      </section>

      <section aria-labelledby="activity-series-heading">
        <h3 id="activity-series-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Page &amp; event activity, last 30 days
        </h3>
        <p className="mb-2 text-xs text-[var(--color-text-muted)]">
          Content-free by construction — event type and path only, never message text. Survives account deletion.
        </p>
        <Sparkline
          values={detail.usageEventDaily.map((d) => d.value)}
          title="Usage events per day, last 30 days"
        />
      </section>

      <section aria-labelledby="chat-transcripts-heading">
        <h3 id="chat-transcripts-heading" className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Ask Library conversations
        </h3>
        {detail.status === "deleted" ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            This account was deleted — its conversations were removed with it and are not available here.
          </p>
        ) : !detail.dataSharingEnabled ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            This reader has not opted in to research sharing — conversation content is not shown, and this page never
            queries it.
          </p>
        ) : detail.transcripts && detail.transcripts.length > 0 ? (
          <div className="flex flex-col gap-4">
            {detail.transcripts.map((t) => (
              <div key={t.id} className="app-card rounded-lg p-4">
                <p className="mb-2 text-sm font-medium text-[var(--color-text)]">
                  {t.title} <span className="font-normal text-[var(--color-text-muted)]">— {formatDateTime(t.updatedAt)}</span>
                </p>
                <ul className="flex flex-col gap-2">
                  {t.messages.map((m, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium text-[var(--color-text-muted)]">{m.role === "user" ? "Reader" : "Answer"}:</span>{" "}
                      <span className="text-[var(--color-text)]">{m.content}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">Opted in, but no conversations yet.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="text-base font-semibold tabular-nums text-[var(--color-text)]">{value}</p>
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
    </div>
  );
}
