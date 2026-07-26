import {
  CLAIM_RELATION_CATEGORIES,
  CLAIM_RELATION_VALENCES,
  isClaimNature,
  type ClaimNature,
  type ClaimRelationCategory,
  type ClaimRelationValence,
} from "../taxonomy";

/**
 * One hand-labeled gold example for the judge eval: a claim pair plus the
 * human-verified valence/category (and, for the humanities branch, the
 * domain and optionally a stage-2 mechanism). Files under `src/eval/gold/`
 * are expected to be a JSON array of these — added by a later lane/session
 * once real gold data exists; this module and its schema exist now so that
 * lane's files have somewhere defined to conform to.
 */
export interface GoldJudgeExample {
  id: string;
  domain: "empirical" | "humanities";
  claimAText: string;
  claimAWorkTitle: string;
  claimBText: string;
  claimBWorkTitle: string;
  goldRelationship: ClaimRelationValence;
  goldCategory: ClaimRelationCategory;
  /** Present only for humanities-domain examples that also carry a
   *  hand-labeled mechanism; absent/null otherwise. Not validated against
   *  `STAGE2_MECHANISMS` here on purpose — a gold file predating a taxonomy
   *  version bump should still parse, just report a lower mechanism-accuracy
   *  number when scored, not fail to load. */
  goldMechanism?: string | null;
  claimANature?: ClaimNature;
  claimBNature?: ClaimNature;
}

export function isGoldJudgeExample(value: unknown): value is GoldJudgeExample {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (v.domain !== "empirical" && v.domain !== "humanities") return false;
  if (typeof v.claimAText !== "string" || typeof v.claimAWorkTitle !== "string") return false;
  if (typeof v.claimBText !== "string" || typeof v.claimBWorkTitle !== "string") return false;
  if (!(CLAIM_RELATION_VALENCES as readonly string[]).includes(v.goldRelationship as string)) return false;
  if (!(CLAIM_RELATION_CATEGORIES as readonly string[]).includes(v.goldCategory as string)) return false;
  if (v.claimANature !== undefined && !isClaimNature(v.claimANature)) return false;
  if (v.claimBNature !== undefined && !isClaimNature(v.claimBNature)) return false;
  return true;
}

/** Parses a gold file's raw JSON text and validates every entry. Throws
 *  (rather than silently dropping a malformed row) — a gold file that
 *  partially fails to conform is a data-quality bug worth surfacing loudly,
 *  since a silently-dropped gold row would quietly shrink the eval sample. */
export function parseGoldJudgeFile(raw: string): GoldJudgeExample[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Gold file must be a JSON array of GoldJudgeExample objects.");
  }
  parsed.forEach((item, i) => {
    if (!isGoldJudgeExample(item)) {
      throw new Error(`Gold example at index ${i} does not conform to GoldJudgeExample.`);
    }
  });
  return parsed as GoldJudgeExample[];
}
