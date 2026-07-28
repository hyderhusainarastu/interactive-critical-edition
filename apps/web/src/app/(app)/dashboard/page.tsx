import Link from "next/link";
import { db, documents, users, works } from "@ice/db";
import { phase12FeatureEnabled, phase25FeatureEnabled } from "@ice/config";
import { and, count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { getClaimAwaitingAttention, getResearchInsightCounts } from "@/lib/researchDashboard";
import { getLatestWriterDraft } from "@/lib/writerData";
import { PageHeader } from "@/components/app/PageHeader";

/**
 * Home (Stage 4 read spec §1). Replaces the counter-led dashboard with an
 * evidence-backed "what should I do next" surface: at most four cards, each
 * naming something real and linkable, never a placeholder for a capability
 * that doesn't exist yet. No new tables, no new AI call — every query below
 * reads data that already exists, same zero-LLM/zero-cache discipline
 * `researchDashboard.ts` already established.
 *
 * The claim-awaiting-attention and latest-Writer-draft cards (spec §1.2
 * items 2 and 4) were originally left out of the Stage 4 lane's own file
 * ownership — their query logic belongs to the Research/Write domains
 * (`lib/researchDashboard.ts`/`lib/writerData.ts`). The
 * continuity-asklibrary-home integration pass wires both in now that those
 * domains are stable, reusing this file's exact card-slot/gating contract
 * (§1.2 items 2 and 4) rather than renegotiating Home's layout.
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const prefs = await getUserPreferences(userId);
  if (!prefs.onboardedAt) redirect("/welcome");

  const [me] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);

  // Card 1: resume reading — the most recently updated saved position among
  // this reader's own ready, non-trashed works. Honestly absent (not a
  // fallback to "most recently uploaded") when nobody has a saved position
  // yet.
  const [resume] = await db
    .select({ workId: works.id, title: works.title })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(
      and(
        eq(works.userId, userId),
        isNull(works.deletedAt),
        eq(documents.processingStatus, "ready"),
        isNotNull(documents.lastPosition),
      ),
    )
    .orderBy(desc(documents.updatedAt))
    .limit(1);

  // Status line input: works currently mid-pipeline.
  const [processingCountRow] = await db
    .select({ value: count() })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.userId, userId), isNull(works.deletedAt), eq(documents.processingStatus, "processing")));
  const processingCount = processingCountRow?.value ?? 0;

  // Card 2 + Card 3 + status line: reuses the existing Phase 29.3 research
  // counts — no new query for the job-status card or the status line. A
  // brand-new/non-research account sees none of the research-gated cards.
  const researchEnabled = phase25FeatureEnabled("research");
  const [researchCounts, claimAwaitingAttention] = await Promise.all([
    researchEnabled ? getResearchInsightCounts(userId) : Promise.resolve(null),
    researchEnabled ? getClaimAwaitingAttention(userId) : Promise.resolve(null),
  ]);
  const researchJobCard =
    researchCounts && researchCounts.runningJobs > 0
      ? { kind: "running" as const, count: researchCounts.runningJobs }
      : researchCounts && researchCounts.failedJobs > 0
        ? { kind: "failed" as const, count: researchCounts.failedJobs }
        : null;

  // Card 4: Stage 6's Writer domain, wired here directly (see the file doc
  // comment above) — same "absent, not placeholder" discipline as the other
  // three: a brand-new/non-Writer account simply sees no fourth card.
  const writerEnabled = phase12FeatureEnabled("writer");
  const latestDraft = writerEnabled ? await getLatestWriterDraft(userId) : null;

  const statusItems: string[] = [];
  if (processingCount > 0) statusItems.push(`${processingCount} work${processingCount === 1 ? "" : "s"} processing`);
  if (researchCounts?.newContradictions) statusItems.push(`${researchCounts.newContradictions} new contradiction${researchCounts.newContradictions === 1 ? "" : "s"}`);
  if (researchCounts?.newMonitorHits) statusItems.push(`${researchCounts.newMonitorHits} new monitor finding${researchCounts.newMonitorHits === 1 ? "" : "s"}`);

  const hasAnyCard = Boolean(resume) || Boolean(claimAwaitingAttention) || Boolean(researchJobCard) || Boolean(latestDraft);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <PageHeader title={`Welcome back${me?.name ? `, ${me.name}` : ""}`} description={me?.email} />

      <div className="app-reveal-stagger flex flex-col gap-4">
        {resume && (
          <Link
            href={`/works/${resume.workId}/reader`}
            className="app-card app-lift app-press app-mount rounded-lg px-5 py-4"
          >
            <div className="text-sm text-[var(--color-text-muted)]">Continue reading</div>
            <div className="mt-1 text-lg font-medium text-[var(--color-text)]">{resume.title}</div>
          </Link>
        )}

        {claimAwaitingAttention && (
          <Link
            href={`/research/claims/${claimAwaitingAttention.id}`}
            className="app-card app-lift app-press app-mount rounded-lg px-5 py-4"
          >
            <div className="text-sm text-[var(--color-text-muted)]">
              A claim awaiting review{(claimAwaitingAttention.workTitle ?? claimAwaitingAttention.corpusItemTitle) ? ` — ${claimAwaitingAttention.workTitle ?? claimAwaitingAttention.corpusItemTitle}` : ""}
            </div>
            <div className="mt-1 text-lg font-medium text-[var(--color-text)]">{claimAwaitingAttention.claimText}</div>
          </Link>
        )}

        {researchJobCard && (
          <Link href="/research" className="app-card app-lift app-press app-mount rounded-lg px-5 py-4">
            <div className="text-sm text-[var(--color-text-muted)]">
              {researchJobCard.kind === "running" ? "Research is running" : "Research paused"}
            </div>
            <div className="mt-1 text-lg font-medium text-[var(--color-text)]">
              {researchJobCard.kind === "running"
                ? `${researchJobCard.count} job${researchJobCard.count === 1 ? "" : "s"} in progress`
                : `${researchJobCard.count} job${researchJobCard.count === 1 ? "" : "s"} need attention`}
            </div>
          </Link>
        )}

        {latestDraft && (
          <Link
            href={`/writer/${latestDraft.projectId}`}
            className="app-card app-lift app-press app-mount rounded-lg px-5 py-4"
          >
            <div className="text-sm text-[var(--color-text-muted)]">Latest Writer draft — {latestDraft.projectTitle}</div>
            <div className="mt-1 text-lg font-medium text-[var(--color-text)]">{latestDraft.documentTitle}</div>
          </Link>
        )}

        {!hasAnyCard && (
          <p className="app-empty app-mount rounded-lg px-5 py-8 text-[var(--color-text-muted)]">
            Nothing to resume yet — <Link href="/upload" className="underline">upload a work</Link> to get started.
          </p>
        )}
      </div>

      {statusItems.length > 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">
          {processingCount > 0 ? (
            <Link href="/works" className="underline">
              {statusItems[0]}
            </Link>
          ) : (
            statusItems[0]
          )}
          {statusItems.slice(1).map((item) => (
            <span key={item}> · {item}</span>
          ))}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href="/library" className="app-control app-press rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]">
          Library
        </Link>
        <Link href="/upload" className="app-control app-press rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)]">
          Upload a work
        </Link>
      </div>
    </div>
  );
}
