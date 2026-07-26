/**
 * Phase 25.5 Spike A — embedding calibration for Stage-1 dense retrieval.
 *
 * Ports the honesty guards and sweep methodology of
 * /Users/hyderhusainarastu/Project/scholarlens_src/eval/stage1_separation.py
 * to TypeScript, over Palimnote's own ported/drafted gold sets
 * (packages/claims/src/eval/gold/), using the real `embedMany` batching
 * seam from packages/ai-adapters instead of local sentence-transformers.
 *
 * WHAT THIS MEASURES: whether cosine similarity between two claim-pair
 * embeddings separates "should surface to the judge" (contradiction /
 * support / nuance) from "should be rejected before the judge ever sees it"
 * (unrelated), for text-embedding-3-small vs text-embedding-3-large. It does
 * NOT measure judge quality (see judge-eval.mjs / Spike B for that).
 *
 * Run: npx tsx scripts/research/stage1-separation.mts
 * Cost: ~$0.001-0.01 (small text batch, input-only embedding pricing).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorkerEnv } from "./env.mjs";
import { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd } from "../../packages/ai-adapters/src/embeddings";
import { cosineSimilarity } from "../../packages/claims/src/retrieval/cosine";
import { parseGoldRelationshipPairsFile, type GoldRelationshipPair } from "../../packages/claims/src/eval/goldSchema";

loadWorkerEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLD_DIR = join(__dirname, "../../packages/claims/src/eval/gold");
const OUT_DIR = join(__dirname, "../../docs/eval/research-claims");

const EMBEDDING_MODELS = ["text-embedding-3-small", "text-embedding-3-large"] as const;
type EmbeddingModelId = (typeof EMBEDDING_MODELS)[number];

// Task-specified sweep, deliberately different from the ScholarLens Python
// script's [0.5, 0.6, 0.7, 0.75, 0.8] sweep — cosine similarities between two
// SHORT single-sentence claims (rather than whole-paragraph embeddings) sit
// in a lower absolute range, so the sweep is shifted down accordingly.
const THRESHOLDS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

// Honesty-guard operationalization (ported from the Python script's
// `gap < 0.05` and `r_max >= s_min` checks; "heavy" overlap is this script's
// own explicit definition, stated here so it's auditable rather than a
// silent magic number): overlap counts as "heavy" once more than 30% of
// should-reject pairs score at or above the weakest should-surface pair —
// a small handful of overlapping pairs is expected noise, a third of the
// reject class leaking through means the embedding genuinely cannot
// separate the two classes on this gold set.
const WEAK_SEPARATION_GAP = 0.05;
const HEAVY_OVERLAP_FRACTION = 0.3;

const SHOULD_SURFACE = new Set(["contradiction", "support", "nuance"]);

interface LoadedPair extends GoldRelationshipPair {
  sourceFile: "empirical" | "humanities" | "negatives";
  resolvedDomain: string;
  isProvisional: boolean;
}

function loadGold(filename: string, sourceFile: LoadedPair["sourceFile"]): LoadedPair[] {
  const raw = readFileSync(join(GOLD_DIR, filename), "utf8");
  const items = parseGoldRelationshipPairsFile(raw);
  return items.map((item) => ({
    ...item,
    sourceFile,
    resolvedDomain: item.domain ?? (sourceFile === "empirical" ? "empirical" : sourceFile),
    isProvisional: item.provisional === true,
  }));
}

function mean(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

interface SimRow {
  id: string;
  domain: string;
  sourceFile: LoadedPair["sourceFile"];
  provisional: boolean;
  label: string;
  klass: "should-surface" | "should-reject";
  similarity: number;
}

interface HonestyGuardResult {
  gap: number;
  nSurface: number;
  nReject: number;
  overlapCount: number;
  overlapFraction: number;
  weakSeparation: boolean;
  heavyOverlap: boolean;
  refuseThreshold: boolean;
}

function honestyGuard(rows: SimRow[]): HonestyGuardResult | null {
  const surface = rows.filter((r) => r.klass === "should-surface").map((r) => r.similarity);
  const reject = rows.filter((r) => r.klass === "should-reject").map((r) => r.similarity);
  if (surface.length === 0 || reject.length === 0) return null;
  const sMin = Math.min(...surface);
  const gap = mean(surface) - mean(reject);
  const overlapCount = reject.filter((s) => s >= sMin).length;
  const overlapFraction = overlapCount / reject.length;
  const weakSeparation = gap < WEAK_SEPARATION_GAP;
  const heavyOverlap = overlapFraction > HEAVY_OVERLAP_FRACTION;
  return {
    gap,
    nSurface: surface.length,
    nReject: reject.length,
    overlapCount,
    overlapFraction,
    weakSeparation,
    heavyOverlap,
    refuseThreshold: weakSeparation || heavyOverlap,
  };
}

interface ThresholdRow {
  threshold: number;
  surfaced: number;
  recall: number;
  rejectedCount: number;
  rejectionRate: number;
  f1: number;
}

function sweep(rows: SimRow[]): ThresholdRow[] {
  const surface = rows.filter((r) => r.klass === "should-surface").map((r) => r.similarity);
  const reject = rows.filter((r) => r.klass === "should-reject").map((r) => r.similarity);
  const nS = surface.length;
  const nR = reject.length;
  return THRESHOLDS.map((t) => {
    const tp = surface.filter((s) => s >= t).length;
    const fp = reject.filter((s) => s >= t).length;
    const tn = nR - fp;
    const recall = nS ? tp / nS : 0;
    const rejectionRate = nR ? tn / nR : 0;
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const f1 = prec + recall ? (2 * prec * recall) / (prec + recall) : 0;
    return { threshold: t, surfaced: tp, recall, rejectedCount: tn, rejectionRate, f1 };
  });
}

function domainBreakdown(rows: SimRow[]): Record<string, { n: number; nSurface: number; nReject: number; meanSurface: number; meanReject: number; provisional: boolean }> {
  const domains = [...new Set(rows.map((r) => r.domain))].sort();
  const out: Record<string, { n: number; nSurface: number; nReject: number; meanSurface: number; meanReject: number; provisional: boolean }> = {};
  for (const domain of domains) {
    const domainRows = rows.filter((r) => r.domain === domain);
    const surface = domainRows.filter((r) => r.klass === "should-surface").map((r) => r.similarity);
    const reject = domainRows.filter((r) => r.klass === "should-reject").map((r) => r.similarity);
    out[domain] = {
      n: domainRows.length,
      nSurface: surface.length,
      nReject: reject.length,
      meanSurface: mean(surface),
      meanReject: mean(reject),
      provisional: domainRows.some((r) => r.provisional),
    };
  }
  return out;
}

async function main() {
  const client = new OpenAIEmbeddingsClient();
  if (!client.available) throw new Error("OPENAI_API_KEY not configured — cannot run Spike A");

  const empirical = loadGold("relationshipPairs.empirical.json", "empirical");
  const humanities = loadGold("relationshipPairs.humanities.json", "humanities");
  const negatives = loadGold("retrievalNegatives.json", "negatives");
  const allPairs: LoadedPair[] = [...empirical, ...humanities, ...negatives];

  console.log(`Loaded ${empirical.length} empirical + ${humanities.length} humanities + ${negatives.length} negatives = ${allPairs.length} pooled pairs.`);

  // Every distinct claim text across all three files, embedded once per model.
  const distinctTexts = [...new Set(allPairs.flatMap((p) => [p.claim_a.text, p.claim_b.text]))];
  console.log(`${distinctTexts.length} distinct claim texts to embed per model.`);

  let totalCostUsd = 0;
  const costByStage: { stage: string; model: string; inputTokens: number; costUsd: number }[] = [];

  const vectorMapByModel: Record<EmbeddingModelId, Map<string, number[]>> = {
    "text-embedding-3-small": new Map(),
    "text-embedding-3-large": new Map(),
  };

  for (const model of EMBEDDING_MODELS) {
    const { vectors, inputTokens } = await client.embedMany(distinctTexts, model);
    const costUsd = estimateEmbeddingCostUsd(model, inputTokens);
    totalCostUsd += costUsd;
    costByStage.push({ stage: "stage1-separation-embed", model, inputTokens, costUsd });
    const map = vectorMapByModel[model];
    distinctTexts.forEach((text, i) => map.set(text, vectors[i]));
    console.log(`  ${model}: ${inputTokens} input tokens, $${costUsd.toFixed(6)}`);
  }

  // Per-model, per-pair cosine similarity rows.
  const rowsByModel: Record<EmbeddingModelId, SimRow[]> = { "text-embedding-3-small": [], "text-embedding-3-large": [] };
  for (const model of EMBEDDING_MODELS) {
    const map = vectorMapByModel[model];
    for (const pair of allPairs) {
      const vecA = map.get(pair.claim_a.text);
      const vecB = map.get(pair.claim_b.text);
      if (!vecA || !vecB) throw new Error(`Missing embedding for pair ${pair.id}`);
      const similarity = cosineSimilarity(vecA, vecB);
      rowsByModel[model].push({
        id: pair.id,
        domain: pair.resolvedDomain,
        sourceFile: pair.sourceFile,
        provisional: pair.isProvisional,
        label: pair.label,
        klass: SHOULD_SURFACE.has(pair.label) ? "should-surface" : "should-reject",
        similarity,
      });
    }
  }

  // ── Pooled / empirical-only / humanities-only analyses per model ──────
  const analysis: Record<
    EmbeddingModelId,
    {
      pooled: { guard: HonestyGuardResult | null; sweep: ThresholdRow[] };
      empiricalOnly: { guard: HonestyGuardResult | null; sweep: ThresholdRow[] };
      humanitiesOnly: { guard: HonestyGuardResult | null; sweep: ThresholdRow[] };
      domainBreakdown: ReturnType<typeof domainBreakdown>;
    }
  > = {} as never;

  for (const model of EMBEDDING_MODELS) {
    const rows = rowsByModel[model];
    const empiricalRows = rows.filter((r) => r.sourceFile === "empirical");
    const humanitiesRows = rows.filter((r) => r.sourceFile === "humanities");
    analysis[model] = {
      pooled: { guard: honestyGuard(rows), sweep: sweep(rows) },
      empiricalOnly: { guard: honestyGuard(empiricalRows), sweep: sweep(empiricalRows) },
      humanitiesOnly: { guard: honestyGuard(humanitiesRows), sweep: sweep(humanitiesRows) },
      domainBreakdown: domainBreakdown(rows),
    };
  }

  // ── Decision criteria (mechanical, pre-written — applied here, not chosen) ──
  function candidateThresholds(model: EmbeddingModelId): ThresholdRow[] {
    return analysis[model].pooled.sweep.filter((t) => t.recall >= 0.9 && t.rejectionRate >= 0.6);
  }

  function humanitiesRecallAt(model: EmbeddingModelId, threshold: number): number {
    const row = analysis[model].humanitiesOnly.sweep.find((t) => t.threshold === threshold);
    return row ? row.recall : NaN;
  }

  const smallGuard = analysis["text-embedding-3-small"].pooled.guard;
  const largeGuard = analysis["text-embedding-3-large"].pooled.guard;
  const smallCandidates = candidateThresholds("text-embedding-3-small");

  let recommendation: "ship-3-small" | "promote-3-large" | "bm25-locus-only" = "bm25-locus-only";
  let refused = false;
  let operatingThreshold: number | null = null;
  const decisionNotes: string[] = [];

  if (smallGuard === null) {
    decisionNotes.push("Pooled set had no should-surface or should-reject rows for 3-small — cannot decide.");
    refused = true;
  } else if (smallGuard.refuseThreshold) {
    decisionNotes.push(
      `HONESTY GUARD TRIPPED for text-embedding-3-small on the pooled set: gap=${smallGuard.gap.toFixed(3)} ` +
        `(weak=${smallGuard.weakSeparation}), overlap=${smallGuard.overlapCount}/${smallGuard.nReject} ` +
        `(${(smallGuard.overlapFraction * 100).toFixed(1)}%, heavy=${smallGuard.heavyOverlap}). ` +
        "REFUSING to recommend a threshold from this data.",
    );
    refused = true;
  } else {
    const shipEligible =
      smallGuard.gap >= 0.05 &&
      smallCandidates.length > 0 &&
      smallCandidates.some((t) => Math.abs(humanitiesRecallAt("text-embedding-3-small", t.threshold) - t.recall) <= 0.1);

    if (shipEligible) {
      // Pick the candidate threshold with the best F1 as the operating point.
      const best = [...smallCandidates].sort((a, b) => b.f1 - a.f1)[0];
      operatingThreshold = best.threshold;
      recommendation = "ship-3-small";
      decisionNotes.push(
        `3-small passes: gap=${smallGuard.gap.toFixed(3)} >= 0.05; operating threshold ${best.threshold} gives ` +
          `recall=${best.recall.toFixed(3)}, rejection=${best.rejectionRate.toFixed(3)}, F1=${best.f1.toFixed(3)}; ` +
          `humanities recall at that threshold = ${humanitiesRecallAt("text-embedding-3-small", best.threshold).toFixed(3)}.`,
      );

      // Evaluate whether 3-large should be promoted instead.
      if (largeGuard && !largeGuard.refuseThreshold) {
        const largeAtSameThreshold = analysis["text-embedding-3-large"].pooled.sweep.find((t) => t.threshold === best.threshold);
        const smallF1AtOperating = best.f1;
        const largeF1AtOperating = largeAtSameThreshold?.f1 ?? NaN;
        const gapDelta = largeGuard.gap - smallGuard.gap;
        const f1Delta = largeF1AtOperating - smallF1AtOperating;
        decisionNotes.push(
          `3-large comparison at same operating threshold ${best.threshold}: gapDelta=${gapDelta.toFixed(3)} ` +
            `(need >=0.02), F1delta=${f1Delta.toFixed(3)} (need >=0.03).`,
        );
        if (gapDelta >= 0.02 && f1Delta >= 0.03) {
          recommendation = "promote-3-large";
          decisionNotes.push("3-large clears the promotion bar — recommend 3-large over 3-small.");
        } else {
          decisionNotes.push("3-large does not clear the promotion bar — 3-small remains the ship recommendation.");
        }
      }
    } else {
      decisionNotes.push(
        `3-small does not meet the ship bar (gap>=0.05 AND some threshold with recall>=0.90 & rejection>=0.60 AND ` +
          `humanities recall within 0.10 of pooled). gap=${smallGuard.gap.toFixed(3)}, ` +
          `qualifying thresholds=${smallCandidates.map((t) => t.threshold).join(",") || "none"}.`,
      );
      recommendation = "bm25-locus-only";
    }
  }

  if (refused) {
    recommendation = "bm25-locus-only";
    decisionNotes.push("Falling back to BM25+locus-only (no dense threshold) because the honesty guard refused a recommendation.");
  }

  // ── Novelty recalibration ──────────────────────────────────────────
  // "the chosen model" = whichever model this spike recommends shipping (or,
  // if the recommendation is BM25+locus-only with no dense model at all,
  // text-embedding-3-small as the safe default for this diagnostic-only
  // measurement — flagged explicitly below).
  const chosenModel: EmbeddingModelId = recommendation === "promote-3-large" ? "text-embedding-3-large" : "text-embedding-3-small";
  const noveltyModelIsFallback = recommendation === "bm25-locus-only";

  // Pseudo-corpus: one claim text per empirical pair (claim_a of each of the
  // 42 empirical.json rows), reusing already-computed embeddings from the
  // pass above — no extra embedding cost for the corpus side.
  const corpusTexts = empirical.map((p) => p.claim_a.text);
  const corpusVectors = corpusTexts.map((t) => {
    const v = vectorMapByModel[chosenModel].get(t);
    if (!v) throw new Error(`Missing corpus embedding for "${t}"`);
    return v;
  });

  // 10 near-duplicate paraphrases of corpus claims (same underlying assertion,
  // different wording) + 10 genuinely novel statements on topics the corpus
  // never touches (negotiation-coaching/IR/LLM-reasoning are the corpus's
  // domains; these are deliberately from unrelated fields).
  const nearDuplicates: { text: string; sourceId: string }[] = [
    { sourceId: "eval_001", text: "ACE's structured, turn-by-turn feedback led to a statistically meaningful gain in negotiation outcomes between trials, whereas GPT-4's zero-shot feedback did not move the needle." },
    { sourceId: "eval_003", text: "Rehearsal's simulated-conflict rehearsal cut competitive tactics by roughly two-thirds and about doubled cooperative moves in a genuine, unassisted follow-up conflict." },
    { sourceId: "eval_005", text: "The negotiation transcripts came from 50 business-school students role-playing used-car deals, converted to text via Whisper with human corrections." },
    { sourceId: "eval_008", text: "Opening with a high first offer correlates positively with how much a negotiator ultimately earns (r=0.47, p<0.001)." },
    { sourceId: "eval_011", text: "Trucey's theory-grounded AI coach cut negotiation fear more than either generic AI or a printed handbook did." },
    { sourceId: "ir_001", text: "Layering BM25 on top of a dense retriever pushed Recall@100 up from 0.71 to 0.88 relative to using the dense retriever alone." },
    { sourceId: "ir_003", text: "Reranking the top 100 candidates with a cross-encoder markedly boosted Precision@10 over the first-stage retriever's own ranking." },
    { sourceId: "llm_001", text: "Chain-of-thought prompting gave a substantial accuracy lift on multi-step arithmetic and symbolic-reasoning problems." },
    { sourceId: "llm_004", text: "Sampling several reasoning chains and taking the majority vote raised benchmark accuracy compared to plain greedy decoding." },
    { sourceId: "llm_005", text: "Grounding answers in retrieved passages cut down on factual hallucination for knowledge-heavy queries." },
  ];

  const genuinelyNovel: { text: string; topic: string }[] = [
    { topic: "marine biology", text: "Deep-sea hydrothermal vent communities sustain primary production through chemosynthesis rather than photosynthesis, decoupling their food webs from sunlight entirely." },
    { topic: "urban planning", text: "Converting one-way downtown streets to two-way traffic reduced average vehicle speeds and measurably increased ground-floor retail foot traffic in the studied city center." },
    { topic: "materials science", text: "Introducing a small fraction of graphene oxide into a cement matrix increased its compressive strength while reducing the material's overall carbon footprint per unit strength." },
    { topic: "epidemiology", text: "Household crowding was a stronger predictor of tuberculosis transmission risk than individual nutritional status in the surveyed informal settlements." },
    { topic: "avian ecology", text: "Migratory songbirds that departed their breeding grounds earlier in years with warmer springs arrived at wintering sites with measurably better body condition." },
    { topic: "monetary economics", text: "Central bank forward guidance moved long-term bond yields more effectively when paired with a numerical inflation target than when issued as qualitative language alone." },
    { topic: "soil science", text: "No-till farming practices increased topsoil organic carbon content over a decade relative to conventional tillage on comparable plots." },
    { topic: "linguistics", text: "Bilingual children acquiring two typologically distant languages showed no measurable delay in reaching early grammatical milestones compared to monolingual peers." },
    { topic: "astrophysics", text: "Fast radio bursts originating from magnetars in dense circumstellar environments showed systematically higher dispersion measures than those from more isolated sources." },
    { topic: "occupational health", text: "Standing-desk adoption in open-plan offices was associated with reduced self-reported lower-back discomfort but no measurable change in self-reported productivity." },
  ];

  const syntheticStatements = [
    ...nearDuplicates.map((d) => ({ ...d, kind: "near_duplicate" as const })),
    ...genuinelyNovel.map((d) => ({ ...d, kind: "genuinely_novel" as const, sourceId: null })),
  ];

  const { vectors: syntheticVectors, inputTokens: syntheticTokens } = await client.embedMany(
    syntheticStatements.map((s) => s.text),
    chosenModel,
  );
  const syntheticCostUsd = estimateEmbeddingCostUsd(chosenModel, syntheticTokens);
  totalCostUsd += syntheticCostUsd;
  costByStage.push({ stage: "novelty-recalibration-embed", model: chosenModel, inputTokens: syntheticTokens, costUsd: syntheticCostUsd });

  const noveltyRows = syntheticStatements.map((s, i) => {
    const vec = syntheticVectors[i];
    let minDistance = Infinity;
    for (const corpusVec of corpusVectors) {
      const distance = 1 - cosineSimilarity(vec, corpusVec);
      if (distance < minDistance) minDistance = distance;
    }
    return { ...s, distance: Math.round(minDistance * 10000) / 10000 };
  });

  const allDistances = noveltyRows.map((r) => r.distance).sort((a, b) => a - b);
  const nearDupDistances = noveltyRows.filter((r) => r.kind === "near_duplicate").map((r) => r.distance);
  const novelDistances = noveltyRows.filter((r) => r.kind === "genuinely_novel").map((r) => r.distance);

  const noveltyPercentiles = {
    p33: percentile(allDistances, 0.33),
    p67: percentile(allDistances, 0.67),
    min: Math.min(...allDistances),
    max: Math.max(...allDistances),
    mean: mean(allDistances),
    nearDuplicateMean: mean(nearDupDistances),
    genuinelyNovelMean: mean(novelDistances),
  };

  console.log(`Total cost: $${totalCostUsd.toFixed(6)}`);

  // ── Write raw JSON + markdown report ──────────────────────────────
  const rawOut = {
    generatedAt: new Date().toISOString(),
    counts: { empirical: empirical.length, humanities: humanities.length, negatives: negatives.length, pooled: allPairs.length, distinctTexts: distinctTexts.length },
    analysis,
    decision: { recommendation, refused, operatingThreshold, decisionNotes, chosenModelForNovelty: chosenModel, noveltyModelIsFallback },
    novelty: { corpusSize: corpusTexts.length, rows: noveltyRows, percentiles: noveltyPercentiles },
    cost: { totalCostUsd, byStage: costByStage },
  };
  writeFileSync(join(OUT_DIR, "spike-25-5-calibration.raw.json"), JSON.stringify(rawOut, null, 2));

  console.log("\n=== DECISION ===");
  for (const note of decisionNotes) console.log("- " + note);
  console.log(`Recommendation: ${recommendation}`);

  return rawOut;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
