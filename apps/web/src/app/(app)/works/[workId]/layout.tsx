import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { db, documents, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { WorkContextHeader } from "./WorkContextHeader";

/**
 * Work context layout (Stage 4 spec §3.2). Does the ONE ownership/identity
 * fetch every child route under `/works/[workId]/*` used to duplicate, and
 * renders the persistent tab strip above whatever the active tab's own
 * page fetches and renders.
 *
 * Deliberately resolves a trashed work too (mirrors `getOwnedWork()`'s own
 * trash-inclusive semantics — see that function's doc comment in
 * `apps/web/src/lib/works.ts`) rather than importing/extending that helper:
 * `apps/web/src/lib/**` is outside this lane's file ownership, and the
 * query this layout needs is a narrow superset anyway (it also wants
 * `documents.processingStatus`, which `getOwnedWork()` doesn't select).
 *
 * `{children}` gets no wrapping width/padding here — several tabs manage
 * their own container width already (`RoadmapView`'s `mx-auto max-w-4xl`,
 * the Reader's deliberately full-bleed `flex min-h-screen`), and imposing a
 * second, different container here would fight whichever one runs.
 */
export default async function WorkLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workId: string }>;
}) {
  const session = await requireSession();
  const { workId } = await params;

  const [row] = await db
    .select({
      id: works.id,
      title: works.title,
      deletedAt: works.deletedAt,
      status: documents.processingStatus,
    })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.id, workId), eq(works.userId, session.user.id)))
    .limit(1);

  if (!row) notFound();

  return (
    <>
      <WorkContextHeader
        workId={row.id}
        title={row.title}
        status={row.status ?? "uploaded"}
        deletedAt={row.deletedAt ? row.deletedAt.toISOString() : null}
      />
      {children}
    </>
  );
}
