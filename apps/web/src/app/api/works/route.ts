import { db, documents, works } from "@ice/db";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";

/** Lists the current user's ready-to-read works — used by the reader's split-pane work picker. */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({ workId: works.id, title: works.title, authorName: works.authorName })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.userId, userId), eq(documents.processingStatus, "ready"), isNull(works.deletedAt)));

  return NextResponse.json(rows);
}
