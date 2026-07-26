/**
 * Cosine-similarity helpers for claim-embedding retrieval — the dense pass
 * of the hybrid dense+BM25 retrieval ScholarLens's `find_claim_pairs` uses
 * (see `bm25.ts` for the other half).
 *
 * Vectors arrive as plain `number[]` from an embedding API; the math itself
 * runs over `Float32Array` (the same numeric precision the reference
 * ScholarLens implementation's `numpy.float32` matrix uses), which is both
 * faster than plain arrays and avoids accumulating float64 rounding
 * differences the ported thresholds weren't calibrated against.
 */

/**
 * L2-normalize a single vector. Guards the zero-vector case the same way
 * the ported numpy implementation does (`np.where(norms == 0, 1e-9, norms)`)
 * rather than dividing by zero.
 */
export function l2Normalize(vector: readonly number[]): Float32Array {
  const out = Float32Array.from(vector);
  let sumSquares = 0;
  for (const v of out) sumSquares += v * v;
  const norm = Math.sqrt(sumSquares) || 1e-9;
  for (let i = 0; i < out.length; i++) out[i] = out[i] / norm;
  return out;
}

export function l2NormalizeMatrix(vectors: readonly (readonly number[])[]): Float32Array[] {
  return vectors.map((v) => l2Normalize(v));
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Cosine similarity between two (not-necessarily-normalized) vectors. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  return dot(l2Normalize(a), l2Normalize(b));
}

export interface CosinePair {
  i: number;
  j: number;
  similarity: number;
}

/**
 * Every (i<j) pair whose cosine similarity is >= threshold, over a matrix of
 * embedding vectors — the pairwise equivalent of the ported reference's
 * `sim_matrix = emb_matrix @ emb_matrix.T` upper triangle, computed directly
 * here since this package has no numpy-equivalent dependency (and no runtime
 * deps at all, per the package's own constraint).
 */
export function pairwiseCosineUpperTriangular(
  vectors: readonly (readonly number[])[],
  threshold: number,
): CosinePair[] {
  const normalized = l2NormalizeMatrix(vectors);
  const pairs: CosinePair[] = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const similarity = dot(normalized[i], normalized[j]);
      if (similarity >= threshold) pairs.push({ i, j, similarity });
    }
  }
  return pairs;
}
