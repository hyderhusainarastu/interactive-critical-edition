import { NextResponse } from "next/server";
import { getWriterEvidenceView } from "@/lib/research/writerEvidence";
import { isWriterApiError, requireWriterEvidenceApiUser } from "@/lib/writerApi";

/**
 * Phase 28.5: the Evidence panel's read — the linked research project's
 * non-rejected, non-hidden claims (filterable by `workId`/`claimNature`),
 * debate clusters, and chambers. `{ linked: null }` when the writer project
 * has no linked research project yet (the panel's own empty state), never a
 * 404 — a 404 here is reserved for "not the caller's own writer project".
 */
export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterEvidenceApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId } = await params;
  const url = new URL(request.url);
  const workId = url.searchParams.get("workId") ?? undefined;
  const claimNature = url.searchParams.get("claimNature") ?? undefined;
  const view = await getWriterEvidenceView(userId, projectId, { workId, claimNature });
  if (view === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view ?? { linked: null });
}
