/**
 * The original, deterministic lexical-only retrieval scorer — moved
 * verbatim out of `index.ts` (Phase 29.3) so `hybridRetrieval.ts` can import
 * `rankLexically` as the flag-off/no-provider fallback without creating a
 * circular module dependency between the two files. Behavior is byte-for-
 * byte unchanged (including the `limit` parameter — previously defaulted to
 * `RAG_RETRIEVAL_LIMIT`, now required, since every real call site already
 * passed an explicit limit and the default would have re-introduced the
 * same `index.ts` <-> `lexicalRetrieval.ts` import cycle this move exists to
 * avoid); `index.ts` re-exports everything here so no existing import site
 * (`from "@ice/rag"` or `from "./index"`) needs to change.
 */

function words(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{1,}/gu) ?? [])]
    .filter((word) => !new Set(["about", "after", "also", "and", "are", "can", "does", "for", "from", "how", "into", "not", "of", "the", "this", "that", "their", "then", "they", "what", "when", "where", "which", "with", "would", "your"]).has(word));
}

/** Deterministic retrieval baseline. A query needs real lexical evidence; a
 * zero-score row is never smuggled into a response simply to make an answer. */
export function lexicalScore(query: string, content: string): number {
  const queryWords = words(query);
  if (!queryWords.length) return 0;
  const haystack = content.toLowerCase();
  let score = 0;
  for (const word of queryWords) {
    const occurrences = haystack.split(word).length - 1;
    score += Math.min(3, occurrences);
  }
  const phrase = query.trim().toLowerCase();
  if (phrase.length > 8 && haystack.includes(phrase)) score += 4;
  return score / Math.sqrt(Math.max(1, content.length / 240));
}

export function rankLexically<T extends { content: string }>(query: string, rows: readonly T[], limit: number): T[] {
  return rows
    .map((row, index) => ({ row, index, score: lexicalScore(query, row.content) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((result) => result.row);
}
