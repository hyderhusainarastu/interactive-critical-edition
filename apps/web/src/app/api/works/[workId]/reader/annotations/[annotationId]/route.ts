import { annotations, db } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";

/**
 * The user correction workflow (plan §12): approve / reject / hide / edit
 * any AI annotation, and the decision persists. Scoped by userId so one
 * user can't touch another's annotations (404, not 403 — same IDOR
 * posture as the rest of the reader API).
 */
const patchSchema = z.object({
  verificationStatus: z
    .enum(["unreviewed", "user_verified", "source_verified", "disputed", "rejected"])
    .optional(),
  hidden: z.boolean().optional(),
  // A user edit to the explanation flips provenance to "user" so the UI
  // stops presenting it as the model's own wording.
  explanation: z.string().min(1).max(2000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ annotationId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { annotationId } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.verificationStatus) update.verificationStatus = parsed.data.verificationStatus;
  if (typeof parsed.data.hidden === "boolean") update.hidden = parsed.data.hidden;
  if (parsed.data.explanation) {
    update.explanation = parsed.data.explanation;
    update.createdBy = "user";
  }

  const updated = await db
    .update(annotations)
    .set(update)
    .where(and(eq(annotations.id, annotationId), eq(annotations.userId, userId)))
    .returning({ id: annotations.id, verificationStatus: annotations.verificationStatus, hidden: annotations.hidden });

  if (updated.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...updated[0] });
}
