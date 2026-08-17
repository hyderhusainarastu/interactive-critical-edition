/**
 * Deterministic first-pass retrieval for Phase 12.5. This deliberately makes
 * no relationship claim: BM25 and embeddings only choose which *new* pairs
 * deserve a source-grounded judgement. The caller preserves both scores and
 * the actual claim anchors as evidence for the later reviewable judgement.
 */
export interface WorkSignalForRetrieval {
  workId: string;
  text: string;
}

export interface Bm25Candidate {
  targetWorkId: string;
  score: number;
  sharedTerms: string[];
}

const STOP_WORDS = new Set([
  "about", "after", "also", "among", "and", "are", "been", "being", "but", "by", "can", "does", "for", "from", "have", "into", "its", "more", "not", "our", "that", "the", "their", "there", "these", "this", "those", "through", "under", "was", "were", "what", "when", "which", "with", "would", "your",
]);

export function retrievalTokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/** A small, dependency-free BM25 scorer suitable for an owned library. */
export function bm25Shortlist(
  source: WorkSignalForRetrieval,
  corpus: readonly WorkSignalForRetrieval[],
  maxCandidates = 20,
): Bm25Candidate[] {
  const sourceTerms = retrievalTokens(source.text);
  if (!sourceTerms.length || maxCandidates <= 0) return [];
  const docs = corpus.filter((work) => work.workId !== source.workId);
  if (!docs.length) return [];

  const tokenized = docs.map((work) => ({ workId: work.workId, terms: retrievalTokens(work.text) }));
  const averageLength = tokenized.reduce((sum, document) => sum + document.terms.length, 0) / tokenized.length || 1;
  const uniqueSourceTerms = [...new Set(sourceTerms)];
  const docFrequency = new Map<string, number>();
  for (const term of uniqueSourceTerms) {
    docFrequency.set(term, tokenized.filter((document) => document.terms.includes(term)).length);
  }

  return tokenized
    .map((document) => {
      const counts = new Map<string, number>();
      for (const term of document.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
      const sharedTerms = uniqueSourceTerms.filter((term) => counts.has(term));
      const score = sharedTerms.reduce((total, term) => {
        const tf = counts.get(term) ?? 0;
        const df = docFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (tokenized.length - df + 0.5) / (df + 0.5));
        const k1 = 1.2;
        const b = 0.75;
        const denominator = tf + k1 * (1 - b + b * (document.terms.length / averageLength));
        return total + idf * ((tf * (k1 + 1)) / denominator);
      }, 0);
      return { targetWorkId: document.workId, score, sharedTerms };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.targetWorkId.localeCompare(right.targetWorkId))
    .slice(0, Math.min(100, maxCandidates));
}

/**
 * Merge lexical and vector candidates without allowing either retrieval path
 * to multiply the automatic-upload limit. Scores remain named rather than
 * pretended to be commensurable.
 */
export function mergeCandidateIds(
  bm25: readonly Bm25Candidate[],
  embedding: readonly { targetWorkId: string; score: number }[],
  maxCandidates = 20,
): string[] {
  const ordered = new Map<string, number>();
  for (const candidate of bm25) ordered.set(candidate.targetWorkId, candidate.score);
  for (const candidate of embedding) ordered.set(candidate.targetWorkId, Math.max(ordered.get(candidate.targetWorkId) ?? 0, candidate.score));
  return [...ordered.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.min(100, maxCandidates))
    .map(([workId]) => workId);
}
