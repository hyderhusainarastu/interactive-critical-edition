import { and, asc, eq, sql } from "drizzle-orm";
import { aiUsageLogs, db, foreignSpans, processingRuns } from "@ice/db";
import type {
  CachedForeignTranslation,
  ForeignSpanForProcessing,
  ForeignTranslationRepository,
} from "./foreignText";

/**
 * Drizzle-backed `ForeignTranslationRepository` (migration 0036). Scoped to
 * one run/document at construction time — `findPending` only ever returns
 * spans this extraction job itself just inserted, which is what keeps
 * `processForeignText`'s "at most one model call per document per pass" and
 * `currentCostUsd: run.aiCostUsd` budget check meaningful; `getCached`
 * deliberately stays UNSCOPED (cross-run reuse, same content pays once).
 */
export function createForeignSpanRepository(scope: { runId: string; documentId: string }): ForeignTranslationRepository {
  return {
    async findPending(limit) {
      if (limit <= 0) return [];
      const rows = await db
        .select()
        .from(foreignSpans)
        .where(and(eq(foreignSpans.runId, scope.runId), eq(foreignSpans.status, "pending")))
        .orderBy(asc(foreignSpans.textBlockId), asc(foreignSpans.startOffset))
        .limit(limit);
      return rows.map(toProcessing);
    },

    async getCached(cacheKey) {
      const [row] = await db
        .select()
        .from(foreignSpans)
        .where(and(eq(foreignSpans.cacheKey, cacheKey), eq(foreignSpans.status, "resolved")))
        .limit(1);
      return row ? toCached(row) : null;
    },

    async saveResolved({ span, cacheKey, result, translationProvenance }) {
      await db
        .update(foreignSpans)
        .set({
          status: "resolved",
          deferredReason: null,
          cacheKey,
          languageCode: result.languageCode,
          languageLabel: result.languageLabel,
          transliteration: result.transliteration,
          translation: result.translation,
          translationProvenance,
          provider: result.provider,
          model: result.model,
          promptVersion: result.promptVersion,
          updatedAt: new Date(),
        })
        .where(eq(foreignSpans.id, span.id));
    },

    async markDeferred(spanId, reason) {
      await db
        .update(foreignSpans)
        .set({ status: "deferred", deferredReason: reason, updatedAt: new Date() })
        .where(eq(foreignSpans.id, spanId));
    },

    async logUsage(input) {
      await db.insert(aiUsageLogs).values({
        documentId: input.documentId,
        runId: input.runId,
        task: input.task,
        stage: input.stage,
        provider: input.provider,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        estimatedCostUsd: input.estimatedCostUsd,
      });
      // Mirrors the Phase-18 embedding block's `ai_usage_log` write, plus the
      // running-total increment that block does not do — Workstream D's
      // handoff explicitly asks for `processing_run.ai_cost_usd` to reflect
      // this spend too, so the reader/admin cost surfaces stay accurate.
      await db
        .update(processingRuns)
        .set({ aiCostUsd: sql`${processingRuns.aiCostUsd} + ${input.estimatedCostUsd}`, updatedAt: new Date() })
        .where(eq(processingRuns.id, input.runId));
    },
  };
}

function toProcessing(row: typeof foreignSpans.$inferSelect): ForeignSpanForProcessing {
  return {
    id: row.id,
    documentId: row.documentId,
    runId: row.runId,
    textBlockId: row.textBlockId,
    originalText: row.originalText,
    script: row.script,
    languageHint: row.languageHint,
    sourceProvenance: {
      kind: row.sourceProvenanceKind,
      label: row.sourceProvenanceLabel,
      confidence: row.sourceConfidence,
    },
    transcriptionStatus: row.transcriptionStatus,
  };
}

function toCached(row: typeof foreignSpans.$inferSelect): CachedForeignTranslation | null {
  if (!row.languageCode || !row.languageLabel || !row.transliteration || !row.translation || !row.provider || !row.model || !row.promptVersion) {
    return null;
  }
  return {
    languageCode: row.languageCode,
    languageLabel: row.languageLabel,
    transliteration: row.transliteration,
    translation: row.translation,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
  };
}
