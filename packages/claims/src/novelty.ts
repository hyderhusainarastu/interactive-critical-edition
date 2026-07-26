import { cosineSimilarity } from "./retrieval/cosine";
import { assertThresholdsCalibratedFor, assertThresholdsSet, type NoveltyThresholds } from "./thresholds";

export type NoveltyTier = "high" | "medium" | "low" | "unknown";

export interface NoveltyResult {
  distance: number;
  tier: NoveltyTier;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Corpus-relative novelty: cosine DISTANCE (1 - similarity) from `vector` to
 * its single nearest neighbour in `corpusVectors`. Ports ScholarLens's
 * `_score_novelty` — which replaced an earlier LLM self-assessment of
 * novelty (no ground truth to check it against) with this computed,
 * corpus-relative number: "how different is this from anything already in
 * the library?", never the model's own opinion of its own idea.
 *
 * An empty corpus (nothing to compare against yet) honestly returns
 * `"unknown"`, not a guessed tier — this is checked BEFORE the threshold
 * calibration gate below runs any comparison, matching the ported Python's
 * own early-return.
 */
export function noveltyFor(
  vector: number[],
  corpusVectors: number[][],
  thresholds: NoveltyThresholds,
  embeddingModel: string,
): NoveltyResult {
  assertThresholdsCalibratedFor(embeddingModel, thresholds);
  if (corpusVectors.length === 0) return { distance: 0, tier: "unknown" };

  assertThresholdsSet(thresholds);
  let minDistance = Infinity;
  for (const other of corpusVectors) {
    const distance = 1 - cosineSimilarity(vector, other);
    if (distance < minDistance) minDistance = distance;
  }

  const distance = round4(minDistance);
  let tier: NoveltyTier;
  if (distance > thresholds.high) tier = "high";
  else if (distance < thresholds.low) tier = "low";
  else tier = "medium";
  return { distance, tier };
}
