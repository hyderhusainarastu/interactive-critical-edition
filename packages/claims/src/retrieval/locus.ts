import { RETRIEVAL_THRESHOLDS } from "../thresholds";

/**
 * A claim's classical-citation anchor, if it has one. `locusKey` is the
 * exact citation (e.g. a normalized "1151a20"); `sectionKey` is the broader
 * containing unit (e.g. "NE-book-7") a claim can be tagged with even when
 * its own exact locus differs from another claim's.
 */
export interface ClaimLocus {
  claimId: string;
  workId: string;
  locusKey?: string | null;
  sectionKey?: string | null;
}

export interface LocusPair {
  loId: string;
  hiId: string;
  score: number;
  channel: "locus" | "locus_section";
}

function crossWorkPairsByKey(
  claims: ClaimLocus[],
  keyOf: (c: ClaimLocus) => string | null | undefined,
  score: number,
  channel: LocusPair["channel"],
): LocusPair[] {
  const groups = new Map<string, ClaimLocus[]>();
  for (const c of claims) {
    const key = keyOf(c);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const pairs: LocusPair[] = [];
  const seen = new Set<string>();
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].workId === group[j].workId) continue; // cross-work only
        const [loId, hiId] = [group[i].claimId, group[j].claimId].sort();
        const pairKey = `${loId} ${hiId}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        pairs.push({ loId, hiId, score, channel });
      }
    }
  }
  return pairs;
}

/**
 * Exact-locus match: two claims anchored to the identical citation key
 * (e.g. the same Bekker/Stephanus line) in different works — the strongest
 * possible cross-work retrieval signal, so it scores at the retrieval
 * ceiling (`RETRIEVAL_THRESHOLDS.locusScore`).
 */
export function locusPairs(claims: ClaimLocus[]): LocusPair[] {
  return crossWorkPairsByKey(claims, (c) => c.locusKey, RETRIEVAL_THRESHOLDS.locusScore, "locus");
}

/**
 * Section-level match: same containing section (e.g. same book/chapter) but
 * not necessarily the identical locus — weaker evidence than an exact
 * match, but still real evidence two claims discuss the same passage-scale
 * unit (`RETRIEVAL_THRESHOLDS.locusSectionScore`).
 */
export function sectionPairs(claims: ClaimLocus[]): LocusPair[] {
  return crossWorkPairsByKey(claims, (c) => c.sectionKey, RETRIEVAL_THRESHOLDS.locusSectionScore, "locus_section");
}
