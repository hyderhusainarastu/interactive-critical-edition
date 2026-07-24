import { createHash } from "node:crypto";
import type {
  ForeignScript,
  ForeignSpanProvenance,
} from "@ice/ingestion";

export const FOREIGN_TRANSLATION_TASK = "foreign_span_translation";
export const FOREIGN_TRANSLATION_STAGE = "foreign-text";
export const FOREIGN_TRANSLATION_PROMPT_VERSION = "foreign-span-v1";

export interface ForeignSpanForProcessing {
  id: string;
  documentId: string;
  runId: string;
  textBlockId: string;
  originalText: string;
  script: ForeignScript;
  languageHint: string;
  sourceProvenance: ForeignSpanProvenance;
  /**
   * Only text already present in the source or recovered by an explicitly
   * provenance-labelled deterministic seam is eligible. An untranscribable
   * marker is never input to a model as if it were recoverable language.
   */
  transcriptionStatus: "legitimate" | "recovered";
}

export interface ForeignTranslationRequestItem {
  id: string;
  originalText: string;
  script: ForeignScript;
  languageHint: string;
  provenanceLabel: string;
}

export interface ForeignTranslationResponseItem {
  id: string;
  /** Echoed verbatim; validation rejects any model-mutated "original". */
  originalText: string;
  languageCode: string;
  languageLabel: string;
  transliteration: string;
  translation: string;
}

export interface ForeignTranslationModelResult {
  items: ForeignTranslationResponseItem[];
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

export interface ForeignTranslationAdapter {
  readonly available: boolean;
  readonly model: string;
  estimateMaximumCostUsd(items: readonly ForeignTranslationRequestItem[]): number;
  translateBatch(
    items: readonly ForeignTranslationRequestItem[],
    options: { promptVersion: typeof FOREIGN_TRANSLATION_PROMPT_VERSION },
  ): Promise<ForeignTranslationModelResult>;
}

export interface CachedForeignTranslation {
  languageCode: string;
  languageLabel: string;
  transliteration: string;
  translation: string;
  provider: string;
  model: string;
  promptVersion: string;
}

export interface ForeignTranslationRepository {
  findPending(limit: number): Promise<ForeignSpanForProcessing[]>;
  getCached(cacheKey: string): Promise<CachedForeignTranslation | null>;
  saveResolved(input: {
    span: ForeignSpanForProcessing;
    cacheKey: string;
    result: CachedForeignTranslation;
    translationProvenance: "machine_translation";
  }): Promise<void>;
  markDeferred(spanId: string, reason: "provider_unavailable" | "budget_exhausted" | "invalid_model_response"): Promise<void>;
  logUsage(input: {
    documentId: string;
    runId: string;
    task: typeof FOREIGN_TRANSLATION_TASK;
    stage: typeof FOREIGN_TRANSLATION_STAGE;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
  }): Promise<void>;
}

export interface ProcessForeignTextOptions {
  maxSpans: number;
  batchSize: number;
  hardCapUsd: number;
  currentCostUsd: number;
}

export interface ProcessForeignTextSummary {
  pending: number;
  cached: number;
  translated: number;
  deferred: number;
  modelCalls: number;
  costUsd: number;
}

const LANGUAGE_CODE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function foreignTranslationCacheKey(span: ForeignSpanForProcessing): string {
  return createHash("sha256")
    .update([
      FOREIGN_TRANSLATION_PROMPT_VERSION,
      span.originalText.normalize("NFC"),
      span.script,
      span.languageHint,
      span.sourceProvenance.kind,
    ].join("\u0000"))
    .digest("hex");
}

export function buildForeignTranslationRequest(
  spans: readonly ForeignSpanForProcessing[],
): ForeignTranslationRequestItem[] {
  return spans.map((span) => ({
    id: span.id,
    originalText: span.originalText,
    script: span.script,
    languageHint: span.languageHint,
    provenanceLabel: span.sourceProvenance.label,
  }));
}

export function validateForeignTranslationResponse(
  request: readonly ForeignTranslationRequestItem[],
  response: readonly ForeignTranslationResponseItem[],
): Map<string, ForeignTranslationResponseItem> | null {
  if (request.length === 0 || response.length !== request.length) return null;
  const requested = new Map(request.map((item) => [item.id, item]));
  const validated = new Map<string, ForeignTranslationResponseItem>();
  for (const item of response) {
    const source = requested.get(item.id);
    if (
      !source
      || validated.has(item.id)
      || item.originalText !== source.originalText
      || !LANGUAGE_CODE.test(item.languageCode)
      || !item.languageLabel.trim()
      || !item.transliteration.trim()
      || !item.translation.trim()
    ) {
      return null;
    }
    validated.set(item.id, {
      ...item,
      languageCode: item.languageCode.trim(),
      languageLabel: item.languageLabel.trim(),
      transliteration: item.transliteration.trim(),
      translation: item.translation.trim(),
    });
  }
  return validated;
}

/**
 * Bounded worker core for foreign-span translation/transliteration.
 *
 * It is intentionally repository- and provider-injected until migration 0036
 * supplies `foreign_span`. That leaves main deployable today while making the
 * eventual H wiring mechanical. Every completed model call is cost-logged
 * before validation or cache writes; invalid output can never become reader
 * content, but its real spend remains visible.
 */
export async function processForeignText(
  repository: ForeignTranslationRepository,
  adapter: ForeignTranslationAdapter,
  options: ProcessForeignTextOptions,
): Promise<ProcessForeignTextSummary> {
  const maxSpans = Math.max(0, Math.floor(options.maxSpans));
  const batchSize = Math.max(1, Math.floor(options.batchSize));
  const pending = (await repository.findPending(maxSpans))
    .filter((span) => (
      (span.transcriptionStatus === "legitimate" || span.transcriptionStatus === "recovered")
      && span.originalText.trim().length > 0
    ));
  const summary: ProcessForeignTextSummary = {
    pending: pending.length,
    cached: 0,
    translated: 0,
    deferred: 0,
    modelCalls: 0,
    costUsd: 0,
  };
  const uncached: ForeignSpanForProcessing[] = [];

  for (const span of pending) {
    const cacheKey = foreignTranslationCacheKey(span);
    const cached = await repository.getCached(cacheKey);
    if (!cached) {
      uncached.push(span);
      continue;
    }
    await repository.saveResolved({
      span,
      cacheKey,
      result: cached,
      translationProvenance: "machine_translation",
    });
    summary.cached += 1;
  }

  if (!adapter.available) {
    for (const span of uncached) await repository.markDeferred(span.id, "provider_unavailable");
    summary.deferred += uncached.length;
    return summary;
  }

  let spent = Math.max(0, options.currentCostUsd);
  for (let offset = 0; offset < uncached.length; offset += batchSize) {
    const batch = uncached.slice(offset, offset + batchSize);
    const request = buildForeignTranslationRequest(batch);
    const projected = Math.max(0, adapter.estimateMaximumCostUsd(request));
    if (spent + projected > options.hardCapUsd) {
      for (const span of batch) await repository.markDeferred(span.id, "budget_exhausted");
      summary.deferred += batch.length;
      continue;
    }

    const result = await adapter.translateBatch(request, {
      promptVersion: FOREIGN_TRANSLATION_PROMPT_VERSION,
    });
    summary.modelCalls += 1;
    summary.costUsd += result.estimatedCostUsd;
    spent += result.estimatedCostUsd;

    // One batch can contain multiple documents/runs after H's repository
    // wiring. Split the single call's usage proportionally by character count
    // so ai_usage_log remains owner/document addressable without duplicating
    // the call's cost.
    const totalChars = Math.max(1, batch.reduce((sum, span) => sum + span.originalText.length, 0));
    let loggedCost = 0;
    let loggedPromptTokens = 0;
    let loggedCompletionTokens = 0;
    for (const [index, span] of batch.entries()) {
      const isLast = index === batch.length - 1;
      const share = isLast
        ? result.estimatedCostUsd - loggedCost
        : result.estimatedCostUsd * (span.originalText.length / totalChars);
      const promptTokenShare = isLast
        ? result.promptTokens - loggedPromptTokens
        : Math.floor(result.promptTokens * (span.originalText.length / totalChars));
      const completionTokenShare = isLast
        ? result.completionTokens - loggedCompletionTokens
        : Math.floor(result.completionTokens * (span.originalText.length / totalChars));
      loggedCost += share;
      loggedPromptTokens += promptTokenShare;
      loggedCompletionTokens += completionTokenShare;
      await repository.logUsage({
        documentId: span.documentId,
        runId: span.runId,
        task: FOREIGN_TRANSLATION_TASK,
        stage: FOREIGN_TRANSLATION_STAGE,
        provider: result.provider,
        model: result.model,
        promptTokens: promptTokenShare,
        completionTokens: completionTokenShare,
        estimatedCostUsd: share,
      });
    }

    const validated = validateForeignTranslationResponse(request, result.items);
    if (!validated) {
      for (const span of batch) await repository.markDeferred(span.id, "invalid_model_response");
      summary.deferred += batch.length;
      continue;
    }

    for (const span of batch) {
      const item = validated.get(span.id)!;
      await repository.saveResolved({
        span,
        cacheKey: foreignTranslationCacheKey(span),
        result: {
          languageCode: item.languageCode,
          languageLabel: item.languageLabel,
          transliteration: item.transliteration,
          translation: item.translation,
          provider: result.provider,
          model: result.model,
          promptVersion: FOREIGN_TRANSLATION_PROMPT_VERSION,
        },
        translationProvenance: "machine_translation",
      });
      summary.translated += 1;
    }
  }
  return summary;
}
