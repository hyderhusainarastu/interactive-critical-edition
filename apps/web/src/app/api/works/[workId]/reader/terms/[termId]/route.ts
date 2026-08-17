import { phase12FeatureEnabled } from "@ice/config";
import { db, termVariants } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { getOwnedDocument } from "@/lib/library/works";
import { notFound } from "@/lib/api/apiResponse";

const schema = z.object({ action: z.literal("approve") });

/** Suggested pairs are intentionally inert until this explicit user action. */
export async function PATCH(request: Request, { params }: { params: Promise<{ workId: string; termId: string }> }) {
  if (!phase12FeatureEnabled("interactiveReader")) return notFound();
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { workId, termId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const document = await getOwnedDocument(workId, userId);
  if (!document) return notFound();
  const [updated] = await db
    .update(termVariants)
    .set({ verificationStatus: "verified", approvedBy: userId, approvedAt: new Date() })
    .where(and(eq(termVariants.id, termId), eq(termVariants.documentId, document.documentId)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Term pair not found" }, { status: 404 });
  return NextResponse.json(updated);
}
