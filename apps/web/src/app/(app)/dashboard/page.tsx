import Link from "next/link";
import { db, documents, users, works } from "@ice/db";
import { phase25FeatureEnabled } from "@ice/config";
import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { getLibrary } from "@/lib/library";
import { STATUS_LABEL } from "@/lib/status";
import { getResearchInsightCounts, hasResearchInsightSignal } from "@/lib/researchDashboard";
import { PageHeader } from "@/components/app/PageHeader";
import { ResearchInsightModule } from "@/components/dashboard/ResearchInsightModule";

/**
 * Overview (plan §34.4 9.5) — this route used to BE the uploads list; that
 * content moved to `/works`. This page is now a light cross-cutting summary:
 * counts and a continue-reading nudge, not a duplicate of either `/works` or
 * `/library`. The onboarding redirect is kept here too (duplicated with
 * `/works`, not centralized into the layout — a cosmetic reorg is not the
 * moment to touch shared auth-adjacent code).
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const prefs = await getUserPreferences(userId);
  if (!prefs.onboardedAt) redirect("/welcome");

  const [me] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);

  const myWorks = await db
    .select({ workId: works.id, title: works.title, status: documents.processingStatus, updatedAt: documents.updatedAt })
    .from(works)
    .leftJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(desc(works.createdAt));

  const statusCounts = myWorks.reduce<Record<string, number>>((acc, w) => {
    const key = w.status ?? "uploaded";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const continueReading = myWorks.find((w) => w.status === "ready") ?? null;

  // Source counts only become nonzero once a work has been analyzed under the
  // canonical pipeline. The Library page itself can still focus an upload
  // before then; this dashboard card intentionally reports only sources.
  const library = await getLibrary(userId);
  const toReadCount = library.items.filter((item) => item.readingStatus === null || item.readingStatus === "planned").length;

  // Phase 29.3 reverse-direction lane: the module mounts only when the
  // Research workspace flag is on AND there's a real signal to show — a
  // brand-new/non-research account renders nothing here (`hasResearchInsightSignal`).
  const researchEnabled = phase25FeatureEnabled("research");
  const researchCounts = researchEnabled ? await getResearchInsightCounts(userId) : null;
  const showResearchModule = researchCounts !== null && hasResearchInsightSignal(researchCounts);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <PageHeader title={`Welcome back${me?.name ? `, ${me.name}` : ""}`} description={me?.email} />

      {continueReading && (
        <Link
          href={`/works/${continueReading.workId}/reader`}
          className="app-card app-lift app-press app-mount rounded-lg px-5 py-4"
        >
          <div className="text-sm text-[var(--color-text-muted)]">Continue reading</div>
          <div className="mt-1 text-lg font-medium text-[var(--color-text)]">{continueReading.title}</div>
        </Link>
      )}

      <div className="app-reveal-stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/works" className="app-card app-lift app-press app-mount rounded-lg px-5 py-4">
          <div className="text-2xl font-semibold text-[var(--color-text)]">{myWorks.length}</div>
          <div className="text-sm text-[var(--color-text-muted)]">
            {myWorks.length === 1 ? "work uploaded" : "works uploaded"}
          </div>
        </Link>
        <Link href="/library" className="app-card app-lift app-press app-mount rounded-lg px-5 py-4">
          <div className="text-2xl font-semibold text-[var(--color-text)]">{toReadCount}</div>
          <div className="text-sm text-[var(--color-text-muted)]">Library items to read</div>
        </Link>
        <div className="app-card app-mount rounded-lg px-5 py-4">
          <div className="text-2xl font-semibold text-[var(--color-text)]">
            {statusCounts.processing ?? 0}
          </div>
          <div className="text-sm text-[var(--color-text-muted)]">
            {STATUS_LABEL.processing}
          </div>
        </div>
      </div>

      {showResearchModule && researchCounts && <ResearchInsightModule counts={researchCounts} />}

      <div className="flex flex-wrap gap-2">
        <Link href="/works" className="app-control app-press rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]">
          Uploaded works
        </Link>
        <Link href="/library" className="app-control app-press rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]">
          Library
        </Link>
        <Link href="/graph" className="app-control app-press rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]">
          Visualization
        </Link>
        <Link href="/upload" className="app-control app-press rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)]">
          Upload a work
        </Link>
      </div>
    </div>
  );
}
