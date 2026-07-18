import { db, documents, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";

const schema = z.object({
  title: z.string().min(1).max(500),
  authorName: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const [work] = await db
    .select({ id: works.id })
    .from(works)
    .where(and(eq(works.id, workId), eq(works.userId, userId)))
    .limit(1);
  if (!work) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(works)
    .set({
      title: parsed.data.title,
      authorName: parsed.data.authorName || null,
      updatedAt: new Date(),
    })
    .where(eq(works.id, workId));

  await db
    .update(documents)
    .set({ processingStatus: "ready", updatedAt: new Date() })
    .where(
      and(eq(documents.workId, workId), eq(documents.processingStatus, "needs_review")),
    );

  return NextResponse.json({ ok: true });
}
