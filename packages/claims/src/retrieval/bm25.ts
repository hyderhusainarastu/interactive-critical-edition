/**
 * Self-contained BM25Okapi retrieval — the keyword-based second pass of
 * ScholarLens's hybrid dense+BM25 claim retrieval (`find_claim_pairs`).
 * ScholarLens's own `utils/bm25_index.py` wraps the `rank_bm25` PyPI
 * package; this reimplements that package's exact ranking formula (k1=1.5,
 * b=0.75, and the same negative-IDF epsilon clamp `rank_bm25.BM25Okapi`
 * uses) directly, so this package pulls in zero runtime dependencies rather
 * than depending on a Python-only library.
 */

const K1 = 1.5;
const B = 0.75;
const EPSILON = 0.25;

/**
 * Lowercase + split on non-alphanumeric. No stemming, no stopwords: method
 * names, dataset names, and classical loci ("1151a20", "GPT-4") must survive
 * tokenization intact — stemming/stopword removal would blur exactly the
 * rare, high-signal terms BM25 is meant to catch (ported rationale from
 * `bm25_index.py`'s own tokenizer docstring).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export interface Bm25Match {
  docIndex: number;
  score: number; // normalized to [0,1] against the max score in this result set
}

export class Bm25Index {
  private readonly texts: string[];
  private readonly docFreqs: Map<string, number>[];
  private readonly docLen: number[];
  private readonly avgDocLen: number;
  private readonly idf = new Map<string, number>();
  private readonly corpusSize: number;

  constructor(texts: string[]) {
    this.texts = texts;
    this.corpusSize = texts.length;
    const tokenizedDocs = texts.map(tokenize);

    this.docFreqs = tokenizedDocs.map((tokens) => {
      const freqs = new Map<string, number>();
      for (const tok of tokens) freqs.set(tok, (freqs.get(tok) ?? 0) + 1);
      return freqs;
    });
    this.docLen = tokenizedDocs.map((tokens) => tokens.length);
    this.avgDocLen = this.docLen.reduce((s, n) => s + n, 0) / (this.corpusSize || 1);

    // Document frequency per term, then IDF — ported exactly from
    // rank_bm25.BM25Okapi._calc_idf, including its negative-IDF handling: a
    // term appearing in more than half the corpus gets a negative raw IDF,
    // which is clamped to `epsilon * averageIdf` rather than left negative
    // (a negative IDF would make a common-term match actively LOWER a
    // document's score, which is the wrong direction).
    const docCount = new Map<string, number>();
    for (const freqs of this.docFreqs) {
      for (const word of freqs.keys()) docCount.set(word, (docCount.get(word) ?? 0) + 1);
    }
    let idfSum = 0;
    const negative: string[] = [];
    for (const [word, freq] of docCount) {
      const idf = Math.log(this.corpusSize - freq + 0.5) - Math.log(freq + 0.5);
      this.idf.set(word, idf);
      idfSum += idf;
      if (idf < 0) negative.push(word);
    }
    const averageIdf = idfSum / (this.idf.size || 1);
    const eps = EPSILON * averageIdf;
    for (const word of negative) this.idf.set(word, eps);
  }

  private rawScores(query: string): number[] {
    const tokens = tokenize(query);
    const scores = new Array(this.corpusSize).fill(0);
    for (const q of tokens) {
      const idf = this.idf.get(q);
      // Deliberately `=== undefined`, not a falsy check: a real, legitimate
      // IDF of exactly 0 (a term present in exactly half a small corpus)
      // must still be distinguished from "this term never appeared in the
      // corpus at all" — both currently contribute 0 to the score either
      // way, but a falsy check would also skip a future non-zero-but-falsy
      // edge case incorrectly.
      if (idf === undefined) continue;
      for (let d = 0; d < this.corpusSize; d++) {
        const freq = this.docFreqs[d].get(q) ?? 0;
        if (freq === 0) continue;
        const denom = freq + K1 * (1 - B + (B * this.docLen[d]) / (this.avgDocLen || 1));
        scores[d] += idf * ((freq * (K1 + 1)) / denom);
      }
    }
    return scores;
  }

  /**
   * Top-n matches, scores normalized to [0,1] against the max score in this
   * result set — so they're comparable to the dense-pass cosine similarity
   * elsewhere in this package. Empty when the index has fewer than 2
   * documents or the query shares no tokens with the corpus (ported
   * behavior from `bm25_index.py`'s `query`).
   */
  query(text: string, n = 10): Bm25Match[] {
    if (this.corpusSize < 2) return [];
    const raw = this.rawScores(text);
    const max = Math.max(...raw);
    if (max <= 0) return [];
    return raw
      .map((score, docIndex) => ({ docIndex, score: score / max }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  get size(): number {
    return this.corpusSize;
  }
}

/** Convenience one-shot: build an index over `docs` and query it once. */
export function rank(docs: string[], query: string, k = 10): Bm25Match[] {
  return new Bm25Index(docs).query(query, k);
}
