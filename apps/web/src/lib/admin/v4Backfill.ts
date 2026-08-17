import { estimateCostUsd } from "@ice/ai-adapters";
import { db, documents } from "@ice/db";
import { and, eq, sql } from "drizzle-orm";

const MAX_CHUNKS_PER_WORK = 8;
const CHARS_PER_ANNOTATION_CHUNK = 12_000;

export interface V4BackfillForecast {
  generatedAt: string;
  eligibleWorks: number;
  estimatedAnnotationChunks: number;
  estimatedIncrementalCostUsd: number;
  estimatedTotalCostUsd: number;
  maxEstimatedPerWorkUsd: number;
  notes: string[];
}

/**
 * A deliberately read-only projection. It does not enqueue work, make a model
 * call, mutate a document, or assume v4 has already been enabled. The existing
 * run cost is included as a conservative baseline; v4's bounded annotation,
 * concept, and embedding calls are added as the incremental estimate.
 */
export async function getV4BackfillForecast(): Promise<V4BackfillForecast> {
  const cheapModel = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const eligible = await db
    .select({
      textChars: sql<number>`coalesce(char_length(${documents.extractedText}), 0)`,
      baselineCost: sql<number>`coalesce((
        select pr.ai_cost_usd
        from processing_run pr
        where pr.document_id = ${documents.id} and pr.is_published
        order by pr.version desc
        limit 1
      ), 0)`,
    })
    .from(documents)
    .where(and(
      eq(documents.processingStatus, "ready"),
      sql`${documents.extractedText} is not null and char_length(${documents.extractedText}) > 0`,
      sql`not exists (
        select 1 from processing_run pr
        where pr.document_id = ${documents.id} and pr.pipeline_version = 'v4' and pr.status = 'complete'
      )`,
    ));

  let estimatedAnnotationChunks = 0;
  let estimatedIncrementalCostUsd = 0;
  let estimatedTotalCostUsd = 0;
  let maxEstimatedPerWorkUsd = 0;
  for (const work of eligible) {
    const chunks = Math.min(MAX_CHUNKS_PER_WORK, Math.max(1, Math.ceil(Number(work.textChars) / CHARS_PER_ANNOTATION_CHUNK)));
    estimatedAnnotationChunks += chunks;
    // 3k input + 1k output per max-size annotation chunk; a 6k/1.2k concept
    // pass; and a compact ~3k-token embedding. This is intentionally rounded
    // up for a dry run, while actual runs remain metered from provider usage.
    const annotationCost = chunks * estimateCostUsd(cheapModel, 3_000, 1_000);
    const conceptCost = estimateCostUsd(cheapModel, 1_500, 1_200);
    const embeddingCost = embeddingModel === "text-embedding-3-small" ? 3_000 * 0.02 / 1_000_000 : 3_000 * 0.13 / 1_000_000;
    const incremental = annotationCost + conceptCost + embeddingCost;
    const total = Number(work.baselineCost) + incremental;
    estimatedIncrementalCostUsd += incremental;
    estimatedTotalCostUsd += total;
    maxEstimatedPerWorkUsd = Math.max(maxEstimatedPerWorkUsd, total);
  }

  return {
    generatedAt: new Date().toISOString(),
    eligibleWorks: eligible.length,
    estimatedAnnotationChunks,
    estimatedIncrementalCostUsd,
    estimatedTotalCostUsd,
    maxEstimatedPerWorkUsd,
    notes: [
      "Dry run only: no jobs are queued and no paid provider calls are made.",
      "Estimate includes the last published run's recorded cost plus capped v4 annotation, concept, and embedding work.",
      "A separately approved execution is required before any existing work is reprocessed.",
    ],
  };
}
