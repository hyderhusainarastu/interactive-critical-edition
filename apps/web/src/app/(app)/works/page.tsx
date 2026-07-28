import Link from "next/link";
import { db, documents, processingRuns, staleActiveExtractMs, works } from "@ice/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { PageHeader } from "@/components/app/PageHeader";
import { ReadingQueueView, type QueueWorkItem } from "./ReadingQueueView";

/**
 * Same "worker heartbeats the run row" stall formula
 * `/api/works/[workId]/status/route.ts` uses (mirrored, not imported — that
 * route isn't in this lane's file ownership). Kept as a plain (non-
 * component) helper so `Date.now()` isn't called directly inside the page
 * component's own body, which this codebase's purity lint forbids (see
 * `RagChatPanel.tsx`'s `formatUpdatedAt` for the same pattern).
 */
function computeStalledDocumentIds(
  runs: Array<{ documentId: string; runStatus: string; updatedAt: Date }>,
  staleMs: number,
): Set<string> {
  const latestByDocument = new Map<string, { runStatus: string; updatedAt: Date }>();
  for (const run of runs) {
    if (!latestByDocument.has(run.documentId)) latestByDocument.set(run.documentId, run);
  }
  const now = Date.now();
  const stalled = new Set<string>();
  for (const [documentId, run] of latestByDocument) {
    const isStalled = run.runStatus === "failed" || (run.runStatus === "running" && now - run.updatedAt.getTime() > staleMs);
    if (isStalled) stalled.add(documentId);
  }
  return stalled;
}

/**
 * Reading Queue (Stage 4 spec §2). Same base query as before (`works` LEFT
 * JOIN `documents`, owner-scoped, non-trashed) — the redesign changes the
 * rendering (attention-first grouping, search, sort, inline retry), not the
 * data model. `processingRuns` is fetched here only for the subset of works
 * currently `processing`, to compute the same "stalled" signal
 * `WorkStatusPanel`/`/api/works/[workId]/status` already compute.
 */
export default async function WorksPage() {
  const session = await requireSession();
  const userId = session.user.id;

  const prefs = await getUserPreferences(userId);
  if (!prefs.onboardedAt) redirect("/welcome");

  const rows = await db
    .select({
      workId: works.id,
      title: works.title,
      authorName: works.authorName,
      status: documents.processingStatus,
      documentId: documents.id,
      updatedAt: documents.updatedAt,
    })
    .from(works)
    .leftJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(desc(documents.updatedAt));

  const processingDocIds = rows
    .filter((row) => row.status === "processing" && row.documentId)
    .map((row) => row.documentId as string);

  let stalledDocumentIds = new Set<string>();
  if (processingDocIds.length > 0) {
    const runs = await db
      .select({ documentId: processingRuns.documentId, runStatus: processingRuns.status, updatedAt: processingRuns.updatedAt })
      .from(processingRuns)
      .where(inArray(processingRuns.documentId, processingDocIds))
      .orderBy(desc(processingRuns.version));
    stalledDocumentIds = computeStalledDocumentIds(runs, staleActiveExtractMs());
  }

  const items: QueueWorkItem[] = rows.map((row) => ({
    workId: row.workId,
    title: row.title,
    authorName: row.authorName,
    status: row.status ?? "uploaded",
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    stalled: row.documentId ? stalledDocumentIds.has(row.documentId) : false,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <PageHeader
        title="Reading Queue"
        description="Your uploaded source files, grouped by what needs your attention."
        actions={<>
          <Link
            href="/works/trash"
            className="app-control app-press rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
          >
            Trash
          </Link>
          <Link
            href="/upload"
            className="app-control app-press rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)]"
          >
            Upload a work
          </Link>
        </>}
      />

      <ReadingQueueView items={items} />
    </div>
  );
}
