import { db, works } from "@ice/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";

/** A small, owned-only search index for the global command palette. */
export async function GET() {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;

  const items = await db
    .select({ id: works.id, title: works.title, authorName: works.authorName })
    .from(works)
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(desc(works.updatedAt))
    .limit(50);

  return NextResponse.json({ works: items });
}
