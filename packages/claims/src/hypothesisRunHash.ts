import { createHash } from "node:crypto";

/**
 * `research_hypothesis.run_hash` — this ROW's own content-addressed identity
 * (plan §Schema `research_hypothesis`: "`run_hash` content-addressed
 * idempotency (strictly better than ScholarLens's 5-minute window)"). Ports
 * the `computeRelationshipBasisHash`/`memberHash` idiom — a research object's
 * identity is derived from what actually GROUNDS it, never from the model's
 * own (re-runnable, non-deterministic) wording — to a hypothesis: sha256 of
 * THIS hypothesis's own validated, sorted `sourceConflictIds` + the research
 * question + the prompt version + the novelty embedding model in force.
 *
 * Deliberately row-scoped, not job-scoped: a single `generate_hypotheses`
 * call can validly produce several hypotheses citing different, possibly
 * overlapping subsets of the same conflict pool, and each earns its own
 * hash. Two hypotheses grounded in the exact same conflict set, under the
 * same question/prompt/model, hash identically — `UNIQUE (user_id,
 * run_hash)` (packages/db's `research_hypothesis` table) is what turns that
 * into real deduplication at insert time.
 */
export interface HypothesisRunHashInput {
  /** This hypothesis's OWN validated `sourceConflictIds` — order doesn't
   *  matter, this function sorts before hashing. */
  relationshipIds: string[];
  /** The research question given at dispatch time, or null when none was. */
  question: string | null;
  promptVersion: string;
  /** The embedding model novelty was measured under, or null when novelty
   *  was never attempted (no embedder configured) — folded in so a model
   *  swap always produces a fresh hash rather than silently reusing an
   *  identity computed under a different, no-longer-active model. */
  noveltyModel: string | null;
}

function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}

export function computeHypothesisRunHash(input: HypothesisRunHashInput): string {
  const sortedIds = [...input.relationshipIds].sort();
  const canonical = [sortedIds.join(","), input.question ?? "", input.promptVersion, input.noveltyModel ?? ""]
    .map(lengthPrefixed)
    .join("");
  return createHash("sha256").update(canonical).digest("hex");
}
