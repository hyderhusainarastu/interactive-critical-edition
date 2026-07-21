import { NextResponse } from "next/server";
import { z } from "zod";
import { Buffer } from "node:buffer";
import type { CslJson } from "@/lib/writer";
import { createWriterDocx, createWriterPdf } from "@/lib/writerExport";
import { getOwnedWriterDocument, getWriterProjectWorkspace } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

const querySchema = z.object({ documentId: z.string().uuid(), format: z.enum(["docx", "pdf"]) });

function safeFilename(value: string) { return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "palimnote"; }

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid export request." }, { status: 400 });
  const { projectId } = await params;
  const [workspace, document] = await Promise.all([
    getWriterProjectWorkspace(userId, projectId),
    getOwnedWriterDocument(userId, projectId, parsed.data.documentId),
  ]);
  if (!workspace || !document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const citations = workspace.citations.map((citation) => citation.cslJson as CslJson);
  const filename = safeFilename(document.document.title);
  const bytes = parsed.data.format === "docx"
    ? createWriterDocx(document.document.title, document.document.content, citations)
    : createWriterPdf(document.document.title, document.document.content, citations);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": parsed.data.format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.${parsed.data.format}"`,
      "Cache-Control": "no-store",
    },
  });
}
