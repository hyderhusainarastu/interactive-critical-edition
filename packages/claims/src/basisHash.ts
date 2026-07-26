import { createHash } from "node:crypto";

/**
 * `claim_relationship.basis_hash` — the re-judge/idempotency key for one
 * judged pair (plan §Schema `claim_relationship`: "`basis_hash` covering
 * both claims' text/excerpts/prompt version/judge branch/engagement — this
 * table's re-judgment key... a re-judgment under an UNCHANGED world reuses
 * the key and inserts nothing new, while any real input change (an edited
 * claim, a reclassified engagement, a prompt-version bump) legitimately
 * re-judges and re-pays"). The `work_relationship_judgment.basisHash`
 * precedent, extended to a claim pair.
 */
export interface RelationshipBasisInput {
  loText: string;
  loExcerpt: string;
  hiText: string;
  hiExcerpt: string;
  promptVersion: string;
  /** Mirrors the DB `claim_judge_branch` enum exactly (`empirical` | `humanities`) —
   *  not imported from `./prompts/judge.ts`'s `BuildJudgePromptInput` to keep this
   *  module dependency-free within the package (`taxonomy.ts`/`judge.ts` are
   *  siblings, not a shared base this file needs to import from). */
  branch: "empirical" | "humanities";
  /** The candidate's own `claim_pair_candidate.engagement` value (any of the
   *  four `claim_engagement` values, not just the narrower two-value shape
   *  `@ice/claims`'s judge prompt input distinguishes) — a citation-graph
   *  reclassification (e.g. `none_detected` -> `direct_citation` once a
   *  citation resolves) must produce a new basis hash even when neither
   *  claim's own text changed. */
  engagement: string;
}

/** Each field is length-prefixed before joining, so a value ending in the
 *  separator can never be mistaken for two shorter fields (or vice versa) —
 *  claim text/excerpts are arbitrary user/model-sourced strings, so a plain
 *  fixed delimiter join is not a safe assumption here. */
function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}

export function computeRelationshipBasisHash(input: RelationshipBasisInput): string {
  const canonical = [
    input.loText,
    input.loExcerpt,
    input.hiText,
    input.hiExcerpt,
    input.promptVersion,
    input.branch,
    input.engagement,
  ]
    .map(lengthPrefixed)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}
