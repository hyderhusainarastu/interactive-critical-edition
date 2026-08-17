import { db, highlights } from "@ice/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { getOwnedDocument } from "@/lib/library/works";
import { notFound } from "@/lib/api/apiResponse";

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
  z.object({
    kind: z.literal("processed"),
    pageIndex: z.number().int().min(0),
    textBlockId: z.string().uuid(),
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
