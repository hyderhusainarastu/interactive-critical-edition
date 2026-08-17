import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getPublishedEdition } from "@/lib/reader/edition";
import { getOwnedDocument } from "@/lib/library/works";

/** The edition API intentionally reads only the published v2 run. Callers can
 * fall back to legacy reader endpoints when this returns `edition: null`. */
export async function GET(_request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workId } = await params;
  const document = await getOwnedDocument(workId, userId);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const edition = await getPublishedEdition(document.documentId);
  return NextResponse.json({ edition });
}
