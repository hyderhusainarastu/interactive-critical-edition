import { bookmarks, db } from "@ice/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

const positionSchema = z.union([
  z.object({ kind: z.literal("pdf"), page: z.number().int().positive() }),
  z.object({ kind: z.literal("text"), paragraphIndex: z.number().int().min(0) }),
]);

const schema = z.object({
  position: positionSchema,
  label: z.string().max(200).optional(),
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

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const doc = await getOwnedDocument(workId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
