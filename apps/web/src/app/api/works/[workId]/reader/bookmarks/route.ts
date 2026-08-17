import { bookmarks, db } from "@ice/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { getOwnedDocument } from "@/lib/library/works";
import { notFound } from "@/lib/api/apiResponse";

const positionSchema = z.union([
  z.object({ kind: z.literal("pdf"), page: z.number().int().positive() }),
  z.object({ kind: z.literal("text"), paragraphIndex: z.number().int().min(0) }),
  z.object({ kind: z.literal("processed"), pageIndex: z.number().int().min(0), textBlockId: z.string().uuid() }),
]);

const schema = z.object({
  position: positionSchema,
  label: z.string().max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { workId } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const doc = await getOwnedDocument(workId, userId);
  if (!doc) {
    return notFound();
  }

  const [created] = await db
    .insert(bookmarks)
    .values({
      userId,
      documentId: doc.documentId,
      position: parsed.data.position,
      label: parsed.data.label ?? null,
    })
    .returning();

  return NextResponse.json(created);
}
