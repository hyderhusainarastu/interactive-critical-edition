import { phase22CompetencyEnabled } from "@ice/config";
import { competencySignals, conceptMastery, db, understandingRatings } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isRagApiError, requireRagApiUser } from "@/lib/ragApi";

/**
 * Sub-phase 22.9b (plan §3.4): undo one applied competency signal.
 * Transactionally restores `previous_score`/`previous_source` (or deletes
 * the row entirely if none existed before), then marks the ledger row
 * `undone`. Owner-scoped by construction — the lookup below is WHERE
 * userId = caller, so a foreign signal id 404s exactly like an
 * IDOR-guarded delete elsewhere in this app, never a 403 that would
 * confirm the id exists.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ signalId: string }> }) {
  const userId = await requireRagApiUser("rag-competency-undo");
  if (isRagApiError(userId)) return userId;
  if (!phase22CompetencyEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { signalId } = await params;
  const [signal] = await db
    .select()
    .from(competencySignals)
    .where(and(eq(competencySignals.id, signalId), eq(competencySignals.userId, userId)))
    .limit(1);
  if (!signal) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Idempotent (§3.4): repeating undo on an already-undone signal is a
  // no-op success, not an error — the reader may click it twice, or a
  // retried request may arrive after the first one already succeeded.
  if (signal.status === "undone") return NextResponse.json({ ok: true, status: "undone" });

  // A `superseded` row means a LATER write (another chat signal, or an
  // explicit Library/roadmap edit) already overtook this target — undoing
  // it now would silently clobber that newer value. A `skipped_precedence`
  // row never wrote anything in the first place. Both fail closed with a
  // clear recovery path rather than guessing which value to restore.
  if (signal.status !== "applied") {
    return NextResponse.json({ error: "This update has since been superseded — adjust the rating directly instead." }, { status: 409 });
  }

  await db.transaction(async (tx) => {
    if (signal.conceptId) {
      if (signal.previousScore === null || signal.previousSource === null) {
        await tx.delete(conceptMastery).where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, signal.conceptId)));
      } else {
        await tx
          .update(conceptMastery)
          .set({ score: signal.previousScore, source: signal.previousSource, updatedAt: new Date() })
          .where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.conceptId, signal.conceptId)));
      }
    } else if (signal.workId) {
      if (signal.previousScore === null || signal.previousSource === null) {
        await tx.delete(understandingRatings).where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.workId, signal.workId)));
      } else {
        await tx
          .update(understandingRatings)
          .set({ score: signal.previousScore, source: signal.previousSource, updatedAt: new Date() })
          .where(and(eq(understandingRatings.userId, userId), eq(understandingRatings.workId, signal.workId)));
      }
    }
    await tx.update(competencySignals).set({ status: "undone" }).where(eq(competencySignals.id, signal.id));
  });

  return NextResponse.json({ ok: true, status: "undone" });
}
