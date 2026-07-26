import { NextResponse } from "next/server";
import { z } from "zod";
import type { CslJson } from "@/lib/writer";
import { CITATION_EXPORT_CONTENT_TYPE, CITATION_EXPORT_EXTENSION, formatCitationList } from "@/lib/writer/citationFormats";
import { getWriterProjectWorkspace } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

const querySchema = z.object({ format: z.enum(["bibtex", "ris", "apa", "chicago"]) });

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "palimnote";
}

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid export request." }, { status: 400 });
  const format = parsed.data.format;
  const { projectId } = await params;
  // 404, not 403: `getWriterProjectWorkspace` is already scoped to the
  // caller's own projects, so an unowned or nonexistent project id is
  // indistinguishable to the client either way.
  const workspace = await getWriterProjectWorkspace(userId, projectId);
  if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const citations = workspace.citations.map((citation) => citation.cslJson as CslJson);
  const body = formatCitationList(citations, format);
  const filename = `${safeFilename(workspace.project.title)}-citations.${CITATION_EXPORT_EXTENSION[format]}`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": CITATION_EXPORT_CONTENT_TYPE[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
