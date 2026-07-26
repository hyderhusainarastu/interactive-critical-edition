import { NextResponse } from "next/server";
import { z } from "zod";
import { insertClaimEvidenceIntoDocument } from "@/lib/research/writerEvidence";
import { isWriterApiError, requireWriterEvidenceApiUser } from "@/lib/writerApi";

/**
 * Phase 28.5: the Evidence panel's "Insert" action. Appends a real
 * ProseMirror blockquote (plus, when applicable, an honest "citation
 * unresolved" and/or "passage not currently locatable" marker) to the
 * document's current DB content, and links a `writer_citation` row built
 * only from the claim's own real bibliographic identity.
 */
const postSchema = z.object({ claimId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const userId = await requireWriterEvidenceApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid claim." }, { status: 400 });
  const { projectId, documentId } = await params;
  const result = await insertClaimEvidenceIntoDocument(userId, projectId, documentId, parsed.data.claimId);
  if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result, { status: 201 });
}
