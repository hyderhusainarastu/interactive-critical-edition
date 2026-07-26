import { NextResponse } from "next/server";
import { aiUsageLogs, claimScores, db, researchClaims } from "@ice/db";
import { phase25FeatureEnabled } from "@ice/config";
import { and, eq, inArray } from "drizzle-orm";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/**
 * Lists a work's active, non-hidden `research_claim` rows plus their
 * `claim_score` children (Phase 28.3, plan §"Web surfaces (reader)") —
 * powers the reader's Claims tab and in-text claim markers. Owner-scoped via
 * `getOwnedDocument` (IDOR-safe: 404, not 403, for a work the caller doesn't
 * own — the established convention every other reader route follows), and
 * flag-gated 404 when `readerClaimLayer` is off (the `requireRagApiUser`
 * precedent for a Phase 25 surface).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  if (!phase25FeatureEnabled("readerClaimLayer")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(researchClaims)
    .where(and(eq(researchClaims.workId, workId), eq(researchClaims.userId, userId), eq(researchClaims.status, "active"), eq(researchClaims.hidden, false)));

  if (rows.length === 0) return NextResponse.json({ claims: [] });

  const claimIds = rows.map((row) => row.id);
  const scoreRows = await db.select().from(claimScores).where(inArray(claimScores.claimId, claimIds));
  const scoresByClaimId = new Map<string, typeof scoreRows>();
  for (const score of scoreRows) {
    const list = scoresByClaimId.get(score.claimId) ?? [];
    list.push(score);
    scoresByClaimId.set(score.claimId, list);
  }

  // Provenance's "model" fact (Phase 28.3): research_claim carries no
  // model_used column of its own (unlike the legacy annotation table) — the
  // honest source is whichever ai_usage_log row this claim's extraction run
  // actually wrote. Batched per distinct run, latest row per run wins; a
  // claim whose run/usage rows no longer exist honestly reports null rather
  // than a fabricated model name.
  const runIds = [...new Set(rows.map((row) => row.processingRunId).filter((id): id is string => id !== null))];
  const modelByRunId = new Map<string, { model: string; createdAt: Date }>();
  if (runIds.length > 0) {
    const usageRows = await db
      .select({ runId: aiUsageLogs.runId, model: aiUsageLogs.model, createdAt: aiUsageLogs.createdAt })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.task, "claim_extraction"), inArray(aiUsageLogs.runId, runIds)));
    for (const usage of usageRows) {
      if (!usage.runId) continue;
      const existing = modelByRunId.get(usage.runId);
      if (!existing || usage.createdAt > existing.createdAt) {
        modelByRunId.set(usage.runId, { model: usage.model, createdAt: usage.createdAt });
      }
    }
  }

  return NextResponse.json({
    claims: rows.map((row) => ({
      id: row.id,
      claimText: row.claimText,
      claimNature: row.claimNature,
      confidence: row.confidence,
      section: row.section,
      sourceScope: row.sourceScope,
      supportingExcerpt: row.supportingExcerpt,
      textBlockId: row.textBlockId,
      quote: row.quote,
      prefix: row.prefix,
      suffix: row.suffix,
      anchorState: row.anchorState,
      verificationStatus: row.verificationStatus,
      promptVersion: row.promptVersion,
      model: row.processingRunId ? (modelByRunId.get(row.processingRunId)?.model ?? null) : null,
      scores: (scoresByClaimId.get(row.id) ?? []).map((score) => ({
        dimension: score.dimension,
        score: score.score,
        label: score.label,
        tier: score.tier,
        signals: score.signals,
      })),
    })),
  });
}
