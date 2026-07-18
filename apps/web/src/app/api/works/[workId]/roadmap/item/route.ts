import { db, readingRecords, roadmapOverrides, understandingRatings } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/**
 * Upserts the user's roadmap-item state (plan §13 step 7): an
 * understanding rating (drives the personalization pass), a reading
 * status, and/or a manual override (hide / pin tier / pin position). All
 * three are optional — send whichever the UI changed. Scoped by userId,
 * and the override is scoped to the owned root work (404 otherwise).
 * There are no DB unique constraints on these natural keys, so upserts are
 * done at the app level (find-then-update-or-insert).
 */
const schema = z.object({
  bibId: z.string().uuid(),
  understandingScore: z.number().int().min(0).max(100).nullable().optional(),
  readingStatus: z.enum(["planned", "reading", "completed", "abandoned"]).nullable().optional(),
  hidden: z.boolean().optional(),
  manualTier: z
    .enum([
      "essential",
      "high",
      "strongly_recommended",
      "contextual",
      "interpretive_aid",
      "comparative",
      "optional",
    ])
    .nullable()
    .optional(),
  manualPosition: z.number().int().min(1).nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const b = parsed.data;

  // --- understanding rating ---
  if (b.understandingScore !== undefined) {
    if (b.understandingScore === null) {
      await db
        .delete(understandingRatings)
        .where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.bibId, b.bibId)));
    } else {
      const [existing] = await db
        .select({ id: understandingRatings.id })
        .from(understandingRatings)
        .where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.bibId, b.bibId)))
        .limit(1);
      if (existing) {
        await db
          .update(understandingRatings)
          .set({ score: b.understandingScore, updatedAt: new Date() })
          .where(eq(understandingRatings.id, existing.id));
      } else {
        await db.insert(understandingRatings).values({ userId, bibId: b.bibId, score: b.understandingScore });
      }
    }
  }

  // --- reading status ---
  if (b.readingStatus !== undefined) {
    if (b.readingStatus === null) {
      await db
        .delete(readingRecords)
        .where(and(eq(readingRecords.userId, userId), eq(readingRecords.bibId, b.bibId)));
    } else {
      const [existing] = await db
        .select({ id: readingRecords.id })
        .from(readingRecords)
        .where(and(eq(readingRecords.userId, userId), eq(readingRecords.bibId, b.bibId)))
        .limit(1);
      const finishedAt = b.readingStatus === "completed" ? new Date() : null;
      if (existing) {
        await db
          .update(readingRecords)
          .set({ status: b.readingStatus, finishedAt, updatedAt: new Date() })
          .where(eq(readingRecords.id, existing.id));
      } else {
        await db.insert(readingRecords).values({ userId, bibId: b.bibId, status: b.readingStatus, finishedAt });
      }
    }
  }

  // --- manual override (hide / tier / position) ---
  if (b.hidden !== undefined || b.manualTier !== undefined || b.manualPosition !== undefined) {
    const [existing] = await db
      .select()
      .from(roadmapOverrides)
      .where(
        and(
          eq(roadmapOverrides.userId, userId),
          eq(roadmapOverrides.rootWorkId, workId),
          eq(roadmapOverrides.bibId, b.bibId),
        ),
      )
      .limit(1);

    const patch = {
      ...(b.hidden !== undefined ? { hidden: b.hidden } : {}),
      ...(b.manualTier !== undefined ? { manualTier: b.manualTier } : {}),
      ...(b.manualPosition !== undefined ? { manualPosition: b.manualPosition } : {}),
      updatedAt: new Date(),
    };

    if (existing) {
      await db.update(roadmapOverrides).set(patch).where(eq(roadmapOverrides.id, existing.id));
      // Clean up a fully-neutral override row so it doesn't linger.
      const [after] = await db
        .select()
        .from(roadmapOverrides)
        .where(eq(roadmapOverrides.id, existing.id))
        .limit(1);
      if (after && !after.hidden && after.manualTier === null && after.manualPosition === null && !after.addedManually) {
        await db.delete(roadmapOverrides).where(eq(roadmapOverrides.id, existing.id));
      }
    } else {
      await db.insert(roadmapOverrides).values({
        userId,
        rootWorkId: workId,
        bibId: b.bibId,
        hidden: b.hidden ?? false,
        manualTier: b.manualTier ?? null,
        manualPosition: b.manualPosition ?? null,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
