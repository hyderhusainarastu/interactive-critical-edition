import { describe, expect, it } from "vitest";
import { cosineSimilarity, l2Normalize, pairwiseCosineUpperTriangular } from "./cosine";

describe("l2Normalize", () => {
  it("produces a unit-length vector", () => {
    const normalized = l2Normalize([3, 4]);
    const norm = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
    expect(norm).toBeCloseTo(1, 5);
    expect(normalized[0]).toBeCloseTo(0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
  });

  it("does not divide by zero on the zero vector", () => {
    expect(() => l2Normalize([0, 0, 0])).not.toThrow();
    const normalized = l2Normalize([0, 0, 0]);
    expect(Array.from(normalized).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical direction vectors regardless of magnitude", () => {
    expect(cosineSimilarity([1, 0], [5, 0])).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it("matches a hand-computed value for a non-trivial pair", () => {
    // a=[1,2,3], b=[4,5,6]: dot=32, |a|=sqrt(14), |b|=sqrt(77)
    // cos = 32 / (sqrt(14)*sqrt(77)) = 32/sqrt(1078) ≈ 0.9746318
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(32 / Math.sqrt(1078), 6);
  });
});

describe("pairwiseCosineUpperTriangular", () => {
  it("returns only i<j pairs at or above the threshold", () => {
    const vectors = [
      [1, 0], // 0
      [1, 0], // 1 — identical to 0, sim 1.0
      [0, 1], // 2 — orthogonal to 0/1, sim 0.0
    ];
    const pairs = pairwiseCosineUpperTriangular(vectors, 0.5);
    expect(pairs).toEqual([{ i: 0, j: 1, similarity: expect.closeTo(1, 6) }]);
  });

  it("never returns a pair with i>=j (upper triangular only)", () => {
    const vectors = [
      [1, 0],
      [1, 0],
      [1, 0],
    ];
    const pairs = pairwiseCosineUpperTriangular(vectors, 0.9);
    for (const p of pairs) expect(p.i).toBeLessThan(p.j);
    expect(pairs).toHaveLength(3); // (0,1) (0,2) (1,2)
  });

  it("returns an empty array when nothing meets the threshold", () => {
    const vectors = [
      [1, 0],
      [0, 1],
    ];
    expect(pairwiseCosineUpperTriangular(vectors, 0.99)).toEqual([]);
  });

  it("returns an empty array for fewer than 2 vectors", () => {
    expect(pairwiseCosineUpperTriangular([], 0.5)).toEqual([]);
    expect(pairwiseCosineUpperTriangular([[1, 2, 3]], 0.5)).toEqual([]);
  });
});
