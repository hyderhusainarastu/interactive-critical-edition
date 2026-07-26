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

// ── Real transcribed/drafted gold-file shapes ───────────────────────────
//
// `GoldJudgeExample` above was this package's own first guess at a gold-row
// shape, written before any real gold data existed. The gold data actually
// transcribed from ScholarLens (Phase 25 Lane L2) and drafted for the
// humanities domain (Lane L5) instead mirrors ScholarLens's own
// `gold_claims.json` record shape directly — nested `claim_a`/`claim_b`
// objects, a `label`/`category` pair, and domain-specific extras (`domains`,
// `provisional`, `rationale`, `split`, `mechanismDraft`). Reshaping the
// transcribed/drafted JSON to fit the guessed shape would have broken the
// byte-for-byte provenance those lanes were asked to preserve, so the
// schema is widened here to describe what the real files actually contain
// instead. `category` is deliberately validated only as a non-empty string,
// not against `CLAIM_RELATION_CATEGORIES` — the humanities gold set uses its
// own locally-invented vocabulary (interpretive/historical/definitional/
// textual) that doesn't fit ScholarLens's empirical categories, a known,
// flagged divergence pending owner sign-off (see `gold/RATIFICATION.md`).

interface GoldClaimSide {
  text: string;
  paper_title: string;
  section?: string;
  confidence?: string;
}

function isGoldClaimSide(value: unknown): value is GoldClaimSide {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.text === "string" && typeof v.paper_title === "string";
}

/** One transcribed/drafted claim-relationship gold row (ScholarLens
 *  `gold_claims.json` shape): `relationshipPairs.*.json` and
 *  `retrievalNegatives.json` under `src/eval/gold/`. `domain` is optional —
 *  the byte-for-byte-transcribed `relationshipPairs.empirical.json` (Lane
 *  L2, straight from ScholarLens's own `gold_claims.json`, which has no such
 *  field) omits it entirely, while the drafted humanities/cross-domain files
 *  (Lane L5) added one; both are legitimate. */
export interface GoldRelationshipPair {
  id: string;
  domain?: string;
  domains?: string[];
  claim_a: GoldClaimSide;
  claim_b: GoldClaimSide;
  label: ClaimRelationValence;
  category: string;
  notes?: string;
  rationale?: string;
  provisional?: boolean;
  split?: string;
  mechanismDraft?: string | null;
}

export function isGoldRelationshipPair(value: unknown): value is GoldRelationshipPair {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (v.domain !== undefined && typeof v.domain !== "string") return false;
  if (!isGoldClaimSide(v.claim_a) || !isGoldClaimSide(v.claim_b)) return false;
  if (!(CLAIM_RELATION_VALENCES as readonly string[]).includes(v.label as string)) return false;
  if (typeof v.category !== "string" || v.category.length === 0) return false;
  return true;
}

export function parseGoldRelationshipPairsFile(raw: string): GoldRelationshipPair[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Gold relationship-pairs file must be a JSON array.");
  }
  parsed.forEach((item, i) => {
    if (!isGoldRelationshipPair(item)) {
      throw new Error(`Gold relationship pair at index ${i} does not conform to GoldRelationshipPair.`);
    }
  });
  return parsed as GoldRelationshipPair[];
}

/** One retrieval-relevance query gold row (`searchQueries.json`): a query
 *  plus graded-relevance candidate passages. */
export interface GoldSearchQuery {
  id: string;
  query: string;
  passages: Array<{ relevance: number; text: string }>;
}

export function isGoldSearchQuery(value: unknown): value is GoldSearchQuery {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.query !== "string") return false;
  if (!Array.isArray(v.passages)) return false;
  return v.passages.every(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as Record<string, unknown>).relevance === "number" &&
      typeof (p as Record<string, unknown>).text === "string",
  );
}

export function parseGoldSearchQueriesFile(raw: string): GoldSearchQuery[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Gold search-queries file must be a JSON array.");
  }
  parsed.forEach((item, i) => {
    if (!isGoldSearchQuery(item)) {
      throw new Error(`Gold search query at index ${i} does not conform to GoldSearchQuery.`);
    }
  });
  return parsed as GoldSearchQuery[];
}

/** One single-claim nature-labeling gold row (`claimNature.json`). */
export interface GoldClaimNatureExample {
  id: string;
  text: string;
  nature: ClaimNature;
  source: string;
  provisional?: boolean;
  rationale?: string;
}

export function isGoldClaimNatureExample(value: unknown): value is GoldClaimNatureExample {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.text !== "string" || typeof v.source !== "string") return false;
  return isClaimNature(v.nature);
}

export function parseGoldClaimNatureFile(raw: string): GoldClaimNatureExample[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Gold claim-nature file must be a JSON array.");
  }
  parsed.forEach((item, i) => {
    if (!isGoldClaimNatureExample(item)) {
      throw new Error(`Gold claim-nature example at index ${i} does not conform to GoldClaimNatureExample.`);
    }
  });
  return parsed as GoldClaimNatureExample[];
}
