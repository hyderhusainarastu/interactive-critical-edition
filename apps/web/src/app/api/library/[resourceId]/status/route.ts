import { db, learningResources, readingRecords, understandingRatings } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";

/**
 * Upserts the caller's reading-state for one Library item (plan §34.4 9.5):
 * an understanding rating and/or a reading status, scoped by
 * learningResourceId — the third polymorphic target migration 0018 added
 * alongside the existing bibId path (`/api/works/[workId]/roadmap/item`,
 * which this mirrors). A `learning_resource` is a shared, global catalog
 * entry (not user-owned, same as `bibliographic_record`), so the only
 * ownership check here is that the caller is authenticated; existence of
 * the resource itself is checked explicitly (404) rather than surfacing a
 * raw FK-violation 500. Never sets workId/bibId alongside
 * learningResourceId, keeping the new DB CHECK constraint honest from the
 * app side too.
 */
const schema = z.object({
  understandingScore: z.number().int().min(0).max(100).nullable().optional(),
  readingStatus: z.enum(["planned", "reading", "completed", "abandoned"]).nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resourceId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { resourceId } = await params;
  const [resource] = await db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.id, resourceId)).limit(1);
  if (!resource) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const b = parsed.data;

  // --- understanding rating ---
  if (b.understandingScore !== undefined) {
    if (b.understandingScore === null) {
      await db
        .delete(understandingRatings)
        .where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.learningResourceId, resourceId)));
    } else {
      const [existing] = await db
        .select({ id: understandingRatings.id })
        .from(understandingRatings)
        .where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.learningResourceId, resourceId)))
        .limit(1);
      if (existing) {
        // Sub-phase 22.9b (plan §3.2): explicit every time, not relying on
        // the column default — this is a real user action overwriting
        // whatever was there before (including a chat-inferred value), so
        // the precedence chain must see a genuine 'explicit' source, not an
        // accident of the DEFAULT clause.
        await db
          .update(understandingRatings)
          .set({ score: b.understandingScore, source: "explicit", updatedAt: new Date() })
          .where(eq(understandingRatings.id, existing.id));
      } else {
        await db.insert(understandingRatings).values({ userId, learningResourceId: resourceId, score: b.understandingScore, source: "explicit" });
      }
    }
  }

  // --- reading status ---
  if (b.readingStatus !== undefined) {
    if (b.readingStatus === null) {
      await db
        .delete(readingRecords)
        .where(and(eq(readingRecords.userId, userId), eq(readingRecords.learningResourceId, resourceId)));
    } else {
      const [existing] = await db
        .select({ id: readingRecords.id })
        .from(readingRecords)
        .where(and(eq(readingRecords.userId, userId), eq(readingRecords.learningResourceId, resourceId)))
        .limit(1);
      const finishedAt = b.readingStatus === "completed" ? new Date() : null;
      if (existing) {
        await db
          .update(readingRecords)
          .set({ status: b.readingStatus, finishedAt, updatedAt: new Date() })
          .where(eq(readingRecords.id, existing.id));
      } else {
        await db.insert(readingRecords).values({ userId, learningResourceId: resourceId, status: b.readingStatus, finishedAt });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
