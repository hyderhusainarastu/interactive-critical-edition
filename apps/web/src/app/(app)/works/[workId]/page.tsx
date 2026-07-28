import { db, documents, processingRuns, works } from "@ice/db";
import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { WorkStatusPanel } from "./WorkStatusPanel";

export default async function WorkPage({
  params,
}: {
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;

  const [row] = await db
    .select({
      title: works.title,
      documentId: documents.id,
      authorName: works.authorName,
      status: documents.processingStatus,
      extractedTitle: documents.extractedTitle,
      extractedAuthor: documents.extractedAuthor,
      processingError: documents.processingError,
      originalFilename: documents.originalFilename,
      deletedAt: works.deletedAt,
    })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.id, workId), eq(works.userId, session.user.id)))
    .limit(1);

  if (!row) notFound();
  const [run] = await db.select({
    version: processingRuns.version,
    pipelineVersion: processingRuns.pipelineVersion,
    stage: processingRuns.stage,
    stageSourceIndex: processingRuns.stageSourceIndex,
    stageSourceTotal: processingRuns.stageSourceTotal,
    structureState: processingRuns.structureState,
    runStatus: processingRuns.status,
    published: processingRuns.isPublished,
    note: processingRuns.note,
  }).from(processingRuns).where(eq(processingRuns.documentId, row.documentId)).orderBy(desc(processingRuns.version)).limit(1);

  // No title/heading rendered here (Stage 4 spec §3.2/§3.5) — the work
  // context layout one level up (`layout.tsx`) already shows the title as
  // part of the persistent tab strip; repeating it here would put the same
  // fact twice on the same screen, directly below the tabs.
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 pb-12 pt-6">
      <p className="text-sm text-[var(--color-text-muted)]">{row.originalFilename}</p>
      <WorkStatusPanel
        workId={workId}
        initial={{ ...row, deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null, processingRun: run ?? null }}
      />
    </div>
  );
}
