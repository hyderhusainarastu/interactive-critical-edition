import { db, passageAnnotations, processingRuns } from "@ice/db";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/**
 * Reader correction workflow for PASSAGE annotations (the default kind under
 * the v2+ edition pipeline) — at parity with the legacy `annotation` PATCH
 * route: verify / dispute / reject, hide / unhide, and edit the explanation.
 *
 * Passage annotations have no `userId` of their own (they belong to a
 * processing run, one per document). Ownership is therefore resolved through
 * the run → document → work → user chain: `getOwnedDocument()` already scopes
 * to the caller, and the update is additionally constrained to runs of that
 * document. A row the caller doesn't own returns 404 (not 403) — the same
 * IDOR posture as the rest of the reader API.
 */
const patchSchema = z.object({
  verificationStatus: z
    .enum(["unreviewed", "user_verified", "source_verified", "disputed", "rejected"])
    .optional(),
  hidden: z.boolean().optional(),
  // A reader edit to the explanation flips provenance to "user" so the UI
  // stops presenting it as machine-derived wording.
  explanation: z.string().min(1).max(2000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workId: string; annotationId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId, annotationId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  const runsForDoc = db
    .select({ id: processingRuns.id })
    .from(processingRuns)
    .where(eq(processingRuns.documentId, doc.documentId));

  const updated = await db
    .update(passageAnnotations)
    .set(update)
    .where(and(eq(passageAnnotations.id, annotationId), inArray(passageAnnotations.runId, runsForDoc)))
    .returning({
      id: passageAnnotations.id,
      verificationStatus: passageAnnotations.verificationStatus,
      hidden: passageAnnotations.hidden,
      explanation: passageAnnotations.explanation,
      createdBy: passageAnnotations.createdBy,
    });

  if (updated.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...updated[0] });
}
