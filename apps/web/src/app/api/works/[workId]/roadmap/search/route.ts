import { bibliographicRecords, db } from "@ice/db";
import { asc, ilike } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/**
 * Searches the shared bibliographic catalog so a reader can pull a
 * reference into this work's roadmap that the automatic traversal didn't
 * reach (plan §22.5 "manual add", D-22-3). `bibliographic_record` is an
 * append-only shared catalog with no owner column (see
 * docs/PROJECT-LOG.md's Design Decisions — the same table Phase 4's
 * citation resolution already writes to for every user), so this searches
 * across the whole catalog rather than scoping to the caller; the route
 * still requires auth and requires the caller to own `workId` (404
 * otherwise), so it isn't reachable by an anonymous or unrelated caller.
 * Results carry only public catalog metadata (title/authors/year) — never
 * anything user-specific.
 */
export async function GET(request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const results = await db
    .select({
      id: bibliographicRecords.id,
      title: bibliographicRecords.title,
      authors: bibliographicRecords.authors,
      year: bibliographicRecords.year,
    })
    .from(bibliographicRecords)
    .where(ilike(bibliographicRecords.title, `%${q}%`))
    .orderBy(asc(bibliographicRecords.title))
    .limit(20);

  return NextResponse.json({ results });
}
