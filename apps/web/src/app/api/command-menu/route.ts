import { db, works } from "@ice/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";

/** A small, owned-only search index for the global command palette. */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await db
    .select({ id: works.id, title: works.title, authorName: works.authorName })
    .from(works)
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(desc(works.updatedAt))
    .limit(50);

  return NextResponse.json({ works: items });
}
