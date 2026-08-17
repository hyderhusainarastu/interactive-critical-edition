import { db, documents } from "@ice/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { getOwnedDocument } from "@/lib/library/works";
import { notFound } from "@/lib/api/apiResponse";

const schema = z.union([
  z.object({ kind: z.literal("pdf"), page: z.number().int().positive() }),
  z.object({ kind: z.literal("text"), paragraphIndex: z.number().int().min(0) }),
  z.object({ kind: z.literal("processed"), pageIndex: z.number().int().min(0), textBlockId: z.string().uuid() }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { workId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const doc = await getOwnedDocument(workId, userId);
  if (!doc) {
    return notFound();
  }

  await db
    .update(documents)
    .set({ lastPosition: parsed.data, updatedAt: new Date() })
    .where(eq(documents.id, doc.documentId));

  return NextResponse.json({ ok: true });
}
