import { BarChart, LineChart, RadarChart, Sparkline } from "@/components/charts";
import { requireSession } from "@/lib/auth";
import { getAccountUsageSnapshot } from "@/lib/accountUsage";

export default async function AccountUsagePage() {
  const session = await requireSession();
  const snapshot = await getAccountUsageSnapshot(session.user.id);

  return (
    <div className="flex flex-col gap-8">
      <section className="app-card rounded-lg p-5" aria-labelledby="docs-over-time-heading">
        <h2 id="docs-over-time-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Documents uploaded</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Last six months.</p>
        <BarChart className="mt-4" data={snapshot.docsOverTime} title="Documents uploaded per month" emptyLabel="No documents yet — upload your first work to see it here." />
      </section>

      <section className="app-card rounded-lg p-5" aria-labelledby="reading-progress-heading">
        <h2 id="reading-progress-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Reading progress</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Works you&apos;ve started and finished, by month.</p>
        <LineChart
          className="mt-4"
          series={[
            { label: "Started", values: snapshot.readingProgressStarted },
            { label: "Completed", values: snapshot.readingProgressCompleted },
          ]}
          xLabels={snapshot.readingProgressLabels}
          title="Reading progress by month"
          emptyLabel="No reading activity yet — mark a work as reading or completed to see it here."
        />
      </section>

      <section className="app-card rounded-lg p-5" aria-labelledby="concept-mastery-heading">
        <h2 id="concept-mastery-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Concept mastery</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Your top self-assessed and inferred concepts.</p>
        <RadarChart
          className="mt-4"
          axes={snapshot.conceptAxes}
          series={[{ label: "Mastery", values: snapshot.conceptValues }]}
          title="Concept mastery"
          emptyLabel="No concept ratings yet — rate your understanding of a concept to see it here."
        />
      </section>

      <section className="app-card flex items-center justify-between gap-4 rounded-lg p-5" aria-labelledby="chat-activity-heading">
        <div>
          <h2 id="chat-activity-heading" className="font-serif text-lg font-semibold text-[var(--color-text)]">Ask Library activity</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Questions asked over the last two weeks.</p>
        </div>
        <Sparkline values={snapshot.chatActivity} title="Ask Library questions per day, last 14 days" />
      </section>
    </div>
  );
}
