import { db, highlights, notes } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

const schema = z.object({
  body: z.string().min(1).max(10000),
  highlightId: z.string().uuid().optional(),
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

  if (parsed.data.highlightId) {
    const [owned] = await db
      .select({ id: highlights.id })
      .from(highlights)
      .where(
        and(eq(highlights.id, parsed.data.highlightId), eq(highlights.userId, userId)),
      )
      .limit(1);
    if (!owned) {
      return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
    }
  }

  const [created] = await db
    .insert(notes)
    .values({
      userId,
      documentId: doc.documentId,
      highlightId: parsed.data.highlightId ?? null,
      body: parsed.data.body,
    })
    .returning();

  return NextResponse.json(created);
}
