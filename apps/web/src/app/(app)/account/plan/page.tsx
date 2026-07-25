import { requireSession } from "@/lib/auth";
import { getAccountPlanCounts } from "@/lib/accountUsage";

/**
 * Decorative-only "usage meters" — the beta is free with no enforced caps,
 * so these percentages are shown purely for the reader's own awareness
 * (never as a real limit) against a generous, clearly-labeled soft
 * reference number. No cost figure anywhere on this page (project-wide
 * no-user-facing-cost-figures rule) — see the admin dashboard for spend.
 */
const SOFT_REFERENCE = { works: 25, documents: 25, chatMessages: 100 };

function meterPercent(value: number, reference: number): number {
  return Math.min(100, Math.round((value / reference) * 100));
}

export default async function AccountPlanPage() {
  const session = await requireSession();
  const counts = await getAccountPlanCounts(session.user.id);

  const meters = [
    { label: "Works uploaded", value: counts.works, reference: SOFT_REFERENCE.works },
    { label: "Documents processed", value: counts.documents, reference: SOFT_REFERENCE.documents },
    { label: "Ask Library messages", value: counts.chatMessages, reference: SOFT_REFERENCE.chatMessages },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="app-card rounded-lg p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg font-semibold text-[var(--color-text)]">Beta (free)</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Every feature is available at no cost during the beta.</p>
          </div>
          <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Current plan</span>
        </div>
      </section>

      <section className="app-card rounded-lg p-5" aria-labelledby="plan-usage-heading">
        <h2 id="plan-usage-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Your usage</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Shown for your own awareness only — the beta has no enforced limits.
        </p>
        <div className="mt-4 flex flex-wrap gap-6">
          {meters.map((meter) => (
            <div key={meter.label} className="flex items-center gap-3">
              <div className="app-progress-ring" style={{ "--progress": meterPercent(meter.value, meter.reference) } as React.CSSProperties} aria-hidden>
                <span>{meter.value}</span>
              </div>
              <span className="text-sm text-[var(--color-text-muted)]">{meter.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="app-card rounded-lg p-5" aria-labelledby="plan-upgrade-heading">
        <h2 id="plan-upgrade-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Plans</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Paid plans aren&apos;t available yet. Everyone uses the same free beta plan while Palimnote is in active
          development.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled aria-disabled="true" className="app-control rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-50">
            Upgrade (coming later)
          </button>
          <button type="button" disabled aria-disabled="true" className="app-control rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] disabled:cursor-not-allowed disabled:opacity-50">
            Manage billing (coming later)
          </button>
        </div>
      </section>
    </div>
  );
}
