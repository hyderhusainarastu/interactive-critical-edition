import { phase12FeatureEnabled } from "@ice/config";
import { db, enqueueGraphExpansion, graphExpansionRequests } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { getGraphExpansionPreview, GRAPH_JOB_HARD_CAP_USD, MANUAL_GRAPH_CANDIDATE_CAP } from "@/lib/graphExpansion";

const requestSchema = z.object({
  workId: z.string().uuid(),
  candidates: z.number().int().min(1).max(MANUAL_GRAPH_CANDIDATE_CAP),
  confirmEstimatedCost: z.boolean().default(false),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export async function POST(request: Request) {
  if (!phase12FeatureEnabled("crossLibraryGraph")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid graph expansion request." }, { status: 400 });
  const preview = await getGraphExpansionPreview(userId, parsed.data.workId, parsed.data.candidates);
  if (!preview) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!preview.hasGroundedClaims || preview.manual.candidateCount === 0) {
    return NextResponse.json({ error: "This work needs grounded v4 claims and another comparable work before it can be expanded." }, { status: 409 });
  }
  if (preview.manual.requiresConfirmation && !parsed.data.confirmEstimatedCost) {
    return NextResponse.json({ error: "Explicit confirmation is required for an estimate above $1.", preview }, { status: 409 });
  }
  const idempotencyKey = parsed.data.idempotencyKey ?? randomUUID();
  const [created] = await db
    .insert(graphExpansionRequests)
    .values({
      userId,
      sourceWorkId: parsed.data.workId,
      mode: "manual",
      requestedCandidates: preview.manual.candidateCount,
      estimatedCostUsd: preview.manual.estimatedCostUsd,
      hardCapUsd: GRAPH_JOB_HARD_CAP_USD,
      confirmedAt: preview.manual.requiresConfirmation ? new Date() : null,
      idempotencyKey,
      status: "queued",
    })
    .onConflictDoNothing({ target: [graphExpansionRequests.userId, graphExpansionRequests.idempotencyKey] })
    .returning({ id: graphExpansionRequests.id, status: graphExpansionRequests.status });
  if (!created) {
    const [existing] = await db
      .select({ id: graphExpansionRequests.id, status: graphExpansionRequests.status })
      .from(graphExpansionRequests)
      .where(and(eq(graphExpansionRequests.userId, userId), eq(graphExpansionRequests.idempotencyKey, idempotencyKey)))
      .limit(1);
    return NextResponse.json({ idempotent: true, request: existing }, { status: 202 });
  }
  await enqueueGraphExpansion(created.id);
  return NextResponse.json({ request: created, preview }, { status: 202 });
}
