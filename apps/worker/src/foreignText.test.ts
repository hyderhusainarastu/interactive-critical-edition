import { describe, expect, it, vi } from "vitest";
import {
  foreignTranslationCacheKey,
  processForeignText,
  validateForeignTranslationResponse,
  type ForeignSpanForProcessing,
  type ForeignTranslationAdapter,
  type ForeignTranslationRepository,
  type ForeignTranslationRequestItem,
} from "./foreignText";

const greekSpan: ForeignSpanForProcessing = {
  id: "span-1",
  documentId: "document-1",
  runId: "run-1",
  textBlockId: "block-1",
  originalText: "ἀρετή",
  script: "greek",
  languageHint: "el",
  sourceProvenance: { kind: "source_text", label: "extracted source text", confidence: 1 },
  transcriptionStatus: "legitimate",
};

function repository(
  pending: ForeignSpanForProcessing[],
  cached: Awaited<ReturnType<ForeignTranslationRepository["getCached"]>> = null,
) {
  return {
    findPending: vi.fn(async () => pending),
    getCached: vi.fn(async () => cached),
    saveResolved: vi.fn(async () => undefined),
    markDeferred: vi.fn(async () => undefined),
    logUsage: vi.fn(async () => undefined),
  } satisfies ForeignTranslationRepository;
}

function adapter(items = [{
  id: "span-1",
  originalText: "ἀρετή",
  languageCode: "el",
  languageLabel: "Greek",
  transliteration: "aretē",
  translation: "virtue",
}]): ForeignTranslationAdapter {
  return {
    available: true,
    model: "cheap-fixture",
    estimateMaximumCostUsd: () => 0.01,
    translateBatch: vi.fn(async () => ({
      items,
      provider: "fixture",
      model: "cheap-fixture",
      promptTokens: 20,
      completionTokens: 10,
      estimatedCostUsd: 0.002,
    })),
  };
}

function echoingAdapter(): ForeignTranslationAdapter {
  return {
    available: true,
    model: "cheap-fixture",
    estimateMaximumCostUsd: () => 0.01,
    translateBatch: vi.fn(async (items: readonly ForeignTranslationRequestItem[]) => ({
      items: items.map((item) => ({
        id: item.id,
        originalText: item.originalText,
        languageCode: item.languageHint === "el" ? "el" : "und",
        languageLabel: item.languageHint === "el" ? "Greek" : "Undetermined",
        transliteration: `transliterated ${item.id}`,
        translation: `translated ${item.id}`,
      })),
      provider: "fixture",
      model: "cheap-fixture",
      promptTokens: items.length * 20,
      completionTokens: items.length * 10,
      estimatedCostUsd: items.length * 0.002,
    })),
  };
}

describe("foreign translation worker seam", () => {
  it("uses a provenance-sensitive deterministic cache key", () => {
    expect(foreignTranslationCacheKey(greekSpan)).toHaveLength(64);
    expect(foreignTranslationCacheKey({
      ...greekSpan,
      sourceProvenance: { kind: "pdf_glyph_recovery", label: "PDF glyph mapping recovery", confidence: 0.85 },
      transcriptionStatus: "recovered",
    })).not.toBe(foreignTranslationCacheKey(greekSpan));
  });

  it("rejects a response that mutates the original or omits requested rows", () => {
    expect(validateForeignTranslationResponse([{
      id: "span-1",
      originalText: "ἀρετή",
      script: "greek",
      languageHint: "el",
      provenanceLabel: "extracted source text",
    }], [{
      id: "span-1",
      originalText: "αρετη",
      languageCode: "el",
      languageLabel: "Greek",
      transliteration: "arete",
      translation: "virtue",
    }])).toBeNull();
  });

  it("logs cost before saving validated machine translations", async () => {
    const repo = repository([greekSpan]);
    const model = adapter();
    const summary = await processForeignText(repo, model, {
      maxSpans: 20,
      batchSize: 8,
      hardCapUsd: 0.05,
      currentCostUsd: 0,
    });
    expect(summary).toMatchObject({ translated: 1, modelCalls: 1, costUsd: 0.002 });
    expect(repo.logUsage).toHaveBeenCalledWith(expect.objectContaining({
      task: "foreign_span_translation",
      stage: "foreign-text",
      estimatedCostUsd: 0.002,
    }));
    expect(repo.saveResolved).toHaveBeenCalledWith(expect.objectContaining({
      translationProvenance: "machine_translation",
    }));
    expect(repo.logUsage.mock.invocationCallOrder[0]).toBeLessThan(repo.saveResolved.mock.invocationCallOrder[0]!);
  });

  it("does not call a model when the projected batch crosses the hard cap", async () => {
    const repo = repository([greekSpan]);
    const model = adapter();
    await processForeignText(repo, model, {
      maxSpans: 20,
      batchSize: 8,
      hardCapUsd: 0.005,
      currentCostUsd: 0,
    });
    expect(model.translateBatch).not.toHaveBeenCalled();
    expect(repo.markDeferred).toHaveBeenCalledWith("span-1", "budget_exhausted");
    expect(repo.logUsage).not.toHaveBeenCalled();
  });

  it("cost-logs invalid model output but never caches it", async () => {
    const repo = repository([greekSpan]);
    await processForeignText(repo, adapter([]), {
      maxSpans: 20,
      batchSize: 8,
      hardCapUsd: 0.05,
      currentCostUsd: 0,
    });
    expect(repo.logUsage).toHaveBeenCalledTimes(1);
    expect(repo.saveResolved).not.toHaveBeenCalled();
    expect(repo.markDeferred).toHaveBeenCalledWith("span-1", "invalid_model_response");
  });

  it("uses cache without any model call or new usage row", async () => {
    const repo = repository([greekSpan], {
      languageCode: "el",
      languageLabel: "Greek",
      transliteration: "aretē",
      translation: "virtue",
      provider: "fixture",
      model: "cheap-fixture",
      promptVersion: "foreign-span-v1",
    });
    const model = adapter();
    const summary = await processForeignText(repo, model, {
      maxSpans: 20,
      batchSize: 8,
      hardCapUsd: 0.05,
      currentCostUsd: 0,
    });
    expect(summary.cached).toBe(1);
    expect(model.translateBatch).not.toHaveBeenCalled();
    expect(repo.logUsage).not.toHaveBeenCalled();
  });

  it("makes one homogeneous call per document, never a cross-document batch", async () => {
    const spans = [
      greekSpan,
      { ...greekSpan, id: "span-2", textBlockId: "block-2", originalText: "λόγος" },
      { ...greekSpan, id: "span-3", documentId: "document-2", runId: "run-2", textBlockId: "block-3", originalText: "ψυχή" },
    ];
    const repo = repository(spans);
    const model = echoingAdapter();

    const summary = await processForeignText(repo, model, {
      maxSpans: 20,
      batchSize: 8,
      hardCapUsd: 0.05,
      currentCostUsd: 0,
    });

    expect(summary).toMatchObject({ translated: 3, deferred: 0, modelCalls: 2 });
    const calls = vi.mocked(model.translateBatch).mock.calls
      .map(([items]) => items.map((item) => item.id));
    expect(calls).toEqual([["span-1", "span-2"], ["span-3"]]);
  });

  it("defers per-document overflow instead of making a second call", async () => {
    const spans = [
      greekSpan,
      { ...greekSpan, id: "span-2", textBlockId: "block-2", originalText: "λόγος" },
      { ...greekSpan, id: "span-3", textBlockId: "block-3", originalText: "ψυχή" },
    ];
    const repo = repository(spans);
    const model = echoingAdapter();

    const summary = await processForeignText(repo, model, {
      maxSpans: 20,
      batchSize: 2,
      hardCapUsd: 0.05,
      currentCostUsd: 0,
    });

    expect(summary).toMatchObject({ translated: 2, deferred: 1, modelCalls: 1 });
    expect(vi.mocked(model.translateBatch).mock.calls[0]?.[0].map((item) => item.id))
      .toEqual(["span-1", "span-2"]);
    expect(repo.markDeferred).toHaveBeenCalledWith("span-3", "batch_limit");
  });
});
