import { db, documents, works } from "@ice/db";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";

/** Lists the current user's ready-to-read works — used by the reader's split-pane work picker. */
export async function GET() {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;

  const rows = await db
    .select({ workId: works.id, title: works.title, authorName: works.authorName })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.userId, userId), eq(documents.processingStatus, "ready"), isNull(works.deletedAt)));

  return NextResponse.json(rows);
}
