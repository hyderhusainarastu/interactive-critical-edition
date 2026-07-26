export interface RetrievalSource {
  channel: string;
  score: number;
}

/** A single (unordered) pair produced by one retrieval channel — the common
 *  shape `locus.ts`'s `LocusPair`, a dense-pass `CosinePair`, and a BM25
 *  `Bm25Match` pair are all normalized into before unioning. */
export interface ChannelPair {
  loId: string;
  hiId: string;
  channel: string;
  score: number;
}

export interface CandidatePair {
  loId: string;
  hiId: string;
  /** Every channel that independently found this pair, with that channel's
   *  own score — nothing is discarded when multiple channels agree. */
  retrievalSources: RetrievalSource[];
  /** The max score across all contributing channels. Display/ranking only —
   *  never used for dedup, so no channel's provenance is ever lost because
   *  another channel scored the same pair higher. */
  bestScore: number;
}

/**
 * Union candidate pairs across retrieval channels (dense / bm25 / locus /
 * locus_section / …), deduping by (loId, hiId) with ids ordered
 * lexicographically so a pair found by multiple channels merges into one
 * candidate instead of being counted once per channel.
 */
export function unionCandidates(...channels: ChannelPair[][]): CandidatePair[] {
  const merged = new Map<string, CandidatePair>();

  for (const pairs of channels) {
    for (const p of pairs) {
      const [loId, hiId] = [p.loId, p.hiId].sort();
      const key = `${loId} ${hiId}`;
      const existing = merged.get(key);
      if (existing) {
        existing.retrievalSources.push({ channel: p.channel, score: p.score });
        existing.bestScore = Math.max(existing.bestScore, p.score);
      } else {
        merged.set(key, {
          loId,
          hiId,
          retrievalSources: [{ channel: p.channel, score: p.score }],
          bestScore: p.score,
        });
      }
    }
  }

  return [...merged.values()];
}
