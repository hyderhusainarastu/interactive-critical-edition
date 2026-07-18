import { db, highlights } from "@ice/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

const anchorSchema = z.union([
  z.object({
    kind: z.literal("pdf"),
    page: z.number().int().positive(),
    quote: z.string().min(1).max(2000),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
  }),
  z.object({
    kind: z.literal("text"),
    paragraphIndex: z.number().int().min(0),
    quote: z.string().min(1).max(2000),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
  }),
]);

const schema = z.object({
  anchor: anchorSchema,
  color: z.enum(["gold", "green", "ink", "burgundy"]).default("gold"),
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

  const doc = await getOwnedDocument(workId, userId);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [created] = await db
    .insert(highlights)
    .values({
      userId,
      documentId: doc.documentId,
      anchor: parsed.data.anchor,
      color: parsed.data.color,
    })
    .returning();

  return NextResponse.json(created);
}
