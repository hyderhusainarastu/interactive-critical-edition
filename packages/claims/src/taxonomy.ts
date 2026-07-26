/**
 * Shared claim/relationship taxonomy for Palimnote's claim-comparison
 * pipeline (Phase 25, "ScholarLens integration foundations"). Pure
 * constants and validators — no I/O, no model calls.
 */

// ── Claim nature ──────────────────────────────────────────────────

/**
 * What KIND of assertion a claim is. ScholarLens's own claim taxonomy has
 * no equivalent — it only ever extracted claims from empirical papers, so
 * every claim was implicitly "empirical". Palimnote's corpus includes
 * philosophy/textual-scholarship works where most claims are interpretive,
 * historical, or conceptual, so this axis exists to keep those honestly
 * distinguished rather than forced into an empirical-shaped bucket.
 */
export const CLAIM_NATURES = [
  "empirical",
  "textual",
  "interpretive",
  "historical",
  "conceptual",
  "normative",
  "definitional",
  "methodological",
] as const;
export type ClaimNature = (typeof CLAIM_NATURES)[number];

export function isClaimNature(value: unknown): value is ClaimNature {
  return typeof value === "string" && (CLAIM_NATURES as readonly string[]).includes(value);
}

// ── Relation valence ──────────────────────────────────────────────

/**
 * FROZEN — do not add, remove, or rename a value here. This is the
 * eval-certified axis: ScholarLens measured judge accuracy (macro-F1 0.788,
 * Cohen's kappa 0.683 on Sonnet-class Claude — see src/eval/gates.ts) against
 * exactly these four values, and every downstream gate, gold-label file, and
 * clustering rule (src/clustering.ts excludes "unrelated" by name) is written
 * against this exact set. If the valence axis itself ever needs to change,
 * that is a new taxonomy version (bump TAXONOMY_VERSION_RELATIONSHIPS below),
 * not an in-place edit of this array.
 */
export const CLAIM_RELATION_VALENCES = ["contradiction", "support", "nuance", "unrelated"] as const;
export type ClaimRelationValence = (typeof CLAIM_RELATION_VALENCES)[number];

export function validateValence(value: unknown): ClaimRelationValence | null {
  return typeof value === "string" && (CLAIM_RELATION_VALENCES as readonly string[]).includes(value)
    ? (value as ClaimRelationValence)
    : null;
}

// ── Relation category ─────────────────────────────────────────────

export const CLAIM_RELATION_CATEGORIES = ["methodological", "findings", "theoretical", "scope"] as const;
export type ClaimRelationCategory = (typeof CLAIM_RELATION_CATEGORIES)[number];

export function validateRelationCategory(value: unknown): ClaimRelationCategory | null {
  return typeof value === "string" && (CLAIM_RELATION_CATEGORIES as readonly string[]).includes(value)
    ? (value as ClaimRelationCategory)
    : null;
}

// ── Relation mechanism ────────────────────────────────────────────

/**
 * Stage 1: a single, honest placeholder. No stage of this pipeline yet
 * infers *why* two claims relate the way they do beyond the valence itself
 * — "unspecified" says that plainly rather than defaulting silently to a
 * guessed mechanism.
 */
export const CLAIM_RELATION_MECHANISMS = ["unspecified"] as const;
export type ClaimRelationMechanism = (typeof CLAIM_RELATION_MECHANISMS)[number];

/**
 * Stage 2 (humanities gate): finer-grained mechanisms for *why* two
 * interpretive/textual claims diverge. Exported now so the prompt/schema
 * layer (src/prompts/judge.ts) can reference these values ahead of time,
 * but deliberately NOT folded into CLAIM_RELATION_MECHANISMS above until the
 * humanities-branch eval gate (HUMANITIES_BRANCH_DELTA_MIN, src/eval/gates.ts)
 * actually passes — an unvalidated mechanism must never be presented as an
 * active taxonomy value.
 */
export const STAGE2_MECHANISMS = [
  "different_definition",
  "interprets_differently",
  "different_scope_conditions",
] as const;
export type Stage2Mechanism = (typeof STAGE2_MECHANISMS)[number];

/**
 * Which valences each stage-2 mechanism can legally explain. All three
 * stage-2 mechanisms describe a difference of interpretive framing between
 * two claims, never a straightforward agreement or a total absence of
 * relation — so each one only ever pairs with `nuance` or `contradiction`.
 */
export const MECHANISM_VALENCE: Record<Stage2Mechanism, ClaimRelationValence[]> = {
  different_definition: ["nuance", "contradiction"],
  interprets_differently: ["nuance", "contradiction"],
  different_scope_conditions: ["nuance", "contradiction"],
};

/**
 * Never coerces to a fallback. A mechanism that doesn't fit the given
 * valence is dropped (returns null) so the caller records "no mechanism"
 * rather than a fabricated mechanism-valence pairing that never happened.
 */
export function validateMechanismForValence(
  mechanism: unknown,
  valence: ClaimRelationValence,
): Stage2Mechanism | null {
  if (typeof mechanism !== "string") return null;
  if (!(STAGE2_MECHANISMS as readonly string[]).includes(mechanism)) return null;
  const allowed = MECHANISM_VALENCE[mechanism as Stage2Mechanism];
  return allowed.includes(valence) ? (mechanism as Stage2Mechanism) : null;
}

// ── Versioning ─────────────────────────────────────────────────────

/**
 * Bump whenever CLAIM_NATURES changes shape (add/remove/rename a value).
 * Consumed by src/jobs/planResearchJob.ts so a taxonomy change always
 * produces a fresh idempotency key rather than silently reusing output
 * computed under an old definition.
 */
export const TAXONOMY_VERSION_CLAIMS = "c1";

/** Bump whenever CLAIM_RELATION_VALENCES/CATEGORIES/MECHANISMS changes shape. */
export const TAXONOMY_VERSION_RELATIONSHIPS = "r1";
