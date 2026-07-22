import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getLibrary } from "@/lib/library";

/**
 * Server-authoritative Library search (plan §20.1). The Library page's
 * debounced search input calls this route rather than filtering an
 * already-downloaded item list in the browser, so a search never requires
 * shipping the reader's whole Library to the client first. Reuses the
 * same owner-scoped `getLibrary()` loader the initial page render uses, so
 * results can never include another user's items (`getLibrary` scopes
 * every query to the caller's own `works`/`work_identity` rows).
 *
 * Only `items` changes with a search term — `works` (the Focus dropdown)
 * intentionally always lists every owned upload, search or not, so the
 * active uploaded-work anchor is never hidden by an unrelated query.
 */
export async function GET(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") ?? undefined;

  const library = await getLibrary(userId, { search });
  return NextResponse.json({ items: library.items });
}
