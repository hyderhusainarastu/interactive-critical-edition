import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { getPublishedEdition } from "@/lib/reader/edition";
import { getOwnedDocument } from "@/lib/library/works";
import { notFound } from "@/lib/api/apiResponse";

/** The edition API intentionally reads only the published v2 run. Callers can
 * fall back to legacy reader endpoints when this returns `edition: null`. */
export async function GET(_request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { workId } = await params;
  const document = await getOwnedDocument(workId, userId);
  if (!document) return notFound();
  const edition = await getPublishedEdition(document.documentId);
  return NextResponse.json({ edition });
}
