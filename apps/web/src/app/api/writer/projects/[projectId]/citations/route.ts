import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBibtex, parseRis } from "@/lib/writer";
import { resolveCitation } from "@/lib/citationResolver";
import { addWriterCitation, getOwnedLibraryCitation, getOwnedWriterProject, getWriterProjectWorkspace } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";
import { reportWebError } from "@/lib/telemetry";

const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("library"), resourceId: z.string().uuid() }),
  z.object({ kind: z.literal("identifier"), identifierType: z.enum(["doi", "isbn", "title"]), value: z.string().trim().min(2).max(2_000) }),
  z.object({ kind: z.literal("bibtex"), value: z.string().min(10).max(200_000) }),
  z.object({ kind: z.literal("ris"), value: z.string().min(10).max(200_000) }),
]);

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId } = await params;
  const workspace = await getWriterProjectWorkspace(userId, projectId);
  return workspace ? NextResponse.json({ citations: workspace.citations }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid citation input." }, { status: 400 });
  const { projectId } = await params;
  if (!await getOwnedWriterProject(userId, projectId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const citations = parsed.data.kind === "library"
      ? (await getOwnedLibraryCitation(userId, parsed.data.resourceId) ?? null)
      : parsed.data.kind === "bibtex"
        ? parseBibtex(parsed.data.value)
        : parsed.data.kind === "ris"
          ? parseRis(parsed.data.value)
          : await resolveCitation(parsed.data.value, parsed.data.identifierType);
    const list = Array.isArray(citations) ? citations : citations ? [citations] : [];
    if (!list.length) return NextResponse.json({ error: "No usable citation metadata found." }, { status: 422 });
    const saved = await Promise.all(list.map((citation) => addWriterCitation(projectId, citation, parsed.data.kind)));
    return NextResponse.json({ citations: saved.filter(Boolean), candidates: list.length }, { status: 201 });
  } catch (error) {
    reportWebError(error, { scope: "api.writer.citation_lookup", userId, projectId, kind: parsed.data.kind });
    return NextResponse.json({ error: "Citation lookup is temporarily unavailable." }, { status: 502 });
  }
}
