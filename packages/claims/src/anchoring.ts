/**
 * Pure quote-anchor relocation — the same {quote, prefix, suffix}
 * text-fingerprint idiom `highlight`/`passage_annotation`/`research_claim`
 * all use (plan §25 risk R3: "position anchoring by stable offsets/
 * text-fingerprint, not raw pixel/page coordinates").
 *
 * MOVED HERE (Phase 26.1) from
 * `apps/web/src/app/(app)/works/[workId]/reader/highlightDom.ts`'s
 * `findQuoteOffset`, which was DOM-only (walked a live `HTMLElement`'s text
 * nodes to build `fullText` before calling this). The matching algorithm
 * itself never touched the DOM — it is a pure function of three strings —
 * so it belongs in a dependency-free package both the reader (relocating a
 * highlight/annotation across a re-render) and the worker's claim-rebind
 * step (relocating a `research_claim`'s anchor across a reprocess) can share
 * as the single source of truth, rather than staying a web-only helper the
 * worker would otherwise have had to re-implement.
 *
 * Semantics are UNCHANGED from the original: exact `prefix+quote+suffix`
 * match first; if that fails, fall back to every raw occurrence of `quote`
 * alone, scored by how much of `prefix`/`suffix` actually surrounds each
 * occurrence, picking the highest-scoring one (ties keep the first/earliest
 * occurrence, matching the original's `score > bestScore` strict
 * comparison). Returns the quote's start offset within `fullText`, or null
 * when the quote cannot be found at all.
 */
export function findQuoteOffset(
  fullText: string,
  quote: string,
  prefix: string,
  suffix: string,
): number | null {
  const combined = prefix + quote + suffix;
  const exact = fullText.indexOf(combined);
  if (exact !== -1) return exact + prefix.length;

  const occurrences: number[] = [];
  let from = 0;
  for (;;) {
    const found = fullText.indexOf(quote, from);
    if (found === -1) break;
    occurrences.push(found);
    from = found + 1;
  }
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) return occurrences[0];

  let best = occurrences[0];
  let bestScore = -1;
  for (const occ of occurrences) {
    const before = fullText.slice(Math.max(0, occ - prefix.length), occ);
    const after = fullText.slice(occ + quote.length, occ + quote.length + suffix.length);
    const score = (before === prefix ? 1 : 0) + (after === suffix ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = occ;
    }
  }
  return best;
}

export type ClaimAnchorState = "anchored" | "rebound" | "unanchored";

export interface ClaimAnchorInput {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface ClaimRebindTarget {
  blockId: string;
  text: string;
}

export type ClaimRebindResult =
  | { state: "rebound"; blockId: string; offset: number }
  | { state: "unanchored" };

/**
 * Re-locates ONE claim's anchor across a set of candidate text blocks (a
 * republished run's `text_block` rows) — the free, deterministic rebind step
 * `apps/worker/src/research/extractClaims.ts`'s `rebindClaimsForWork` runs
 * per claim after a reprocess (plan §Pipeline "Reprocess supersession").
 * Tries every candidate block with `findQuoteOffset`; exactly one block
 * producing a match is a `rebound` result (a genuine relocation), while zero
 * matches OR matches in more than one block are both honestly
 * `unanchored` — never a guess between two plausible blocks, and never a
 * silent pick of "whichever block matched first".
 */
export function rebindClaimAnchor(
  anchor: ClaimAnchorInput,
  candidates: readonly ClaimRebindTarget[],
): ClaimRebindResult {
  const matches: { blockId: string; offset: number }[] = [];
  for (const candidate of candidates) {
    const offset = findQuoteOffset(candidate.text, anchor.quote, anchor.prefix, anchor.suffix);
    if (offset !== null) matches.push({ blockId: candidate.blockId, offset });
  }
  if (matches.length !== 1) return { state: "unanchored" };
  return { state: "rebound", blockId: matches[0].blockId, offset: matches[0].offset };
}
