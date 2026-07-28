import { NextResponse } from "next/server";
import { z } from "zod";
import { proseMirrorDocumentSchema } from "@/lib/writer";
import { getOwnedWriterDocument, saveWriterDocumentIfCurrent } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: proseMirrorDocumentSchema.optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  reason: z.enum(["autosave", "manual_save", "revision_restore"]).optional(),
  // Stage 6 spec §4.3's flagged follow-up, now implemented: optional and
  // additive. An older or non-conflict-aware client simply omits this
  // field, which is byte-for-byte the same unconditional last-write-wins
  // behavior as before this field existed — see `saveWriterDocumentIfCurrent`'s
  // own doc comment.
  expectedUpdatedAt: z.string().optional(),
}).refine((input) => input.title !== undefined || input.content !== undefined || input.sortOrder !== undefined);

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid document update." }, { status: 400 });
  const { projectId, documentId } = await params;
  if (!await getOwnedWriterDocument(userId, projectId, documentId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const result = await saveWriterDocumentIfCurrent(
    documentId,
    {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
    },
    parsed.data.reason ?? "autosave",
    parsed.data.expectedUpdatedAt,
  );
  if (result.status === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (result.status === "conflict") return NextResponse.json({ conflict: true, latest: result.latest }, { status: 409 });
  return NextResponse.json(result.document);
}
