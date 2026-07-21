import { db, highlights, noteHighlights, notes } from "@ice/db";
import { phase12FeatureEnabled } from "@ice/config";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

const schema = z.object({
  body: z.string().min(1).max(10000),
  /** Compatibility input retained for legacy reader clients. */
  highlightId: z.string().uuid().optional(),
  highlightIds: z.array(z.string().uuid()).max(50).optional(),
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

  const highlightIds = [...new Set([...(parsed.data.highlightIds ?? []), ...(parsed.data.highlightId ? [parsed.data.highlightId] : [])])];
  const multiLinkEnabled = phase12FeatureEnabled("interactiveReader");
  if (!multiLinkEnabled && highlightIds.length > 1) {
    return NextResponse.json({ error: "Multiple note links are not enabled yet" }, { status: 409 });
  }
  if (highlightIds.length) {
    const owned = await db
      .select({ id: highlights.id })
      .from(highlights)
      .where(and(inArray(highlights.id, highlightIds), eq(highlights.userId, userId), eq(highlights.documentId, doc.documentId)));
    if (owned.length !== highlightIds.length) {
      return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
    }
  }

  const created = await db.transaction(async (tx) => {
    const [note] = await tx
      .insert(notes)
      .values({
        userId,
        documentId: doc.documentId,
        highlightId: highlightIds[0] ?? null,
        body: parsed.data.body,
      })
      .returning();
    if (multiLinkEnabled && highlightIds.length) {
      await tx.insert(noteHighlights).values(highlightIds.map((highlightId) => ({ noteId: note.id, highlightId })));
    }
    return note;
  });

  return NextResponse.json({ ...created, highlightIds });
}
