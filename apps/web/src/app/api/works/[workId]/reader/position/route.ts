import { db, documents } from "@ice/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

const schema = z.union([
  z.object({ kind: z.literal("pdf"), page: z.number().int().positive() }),
  z.object({ kind: z.literal("text"), paragraphIndex: z.number().int().min(0) }),
  z.object({ kind: z.literal("processed"), pageIndex: z.number().int().min(0), textBlockId: z.string().uuid() }),
]);

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

  const doc = await getOwnedDocument(workId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(documents)
    .set({ lastPosition: parsed.data, updatedAt: new Date() })
    .where(eq(documents.id, doc.documentId));

  return NextResponse.json({ ok: true });
}
