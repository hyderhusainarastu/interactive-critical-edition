import { RELATIONSHIP_CATEGORIES, type CitationFrequencySignal, type RelationshipCategory } from "../types";

/**
 * Gold-set schema for the retrofit eval harness that measures the
 * EXISTING 10-category relationship classifier (`classifyRelationship`
 * in `../index.ts`, its deterministic `heuristicClassify` fallback in
 * `../providers/heuristic.ts`). This is the same eval discipline
 * `@ice/claims/src/eval` established for the new claims judge — versioned
 * gold JSON, a validating parser that throws loudly on a malformed row
 * rather than silently dropping it, and a deterministic SHA-256 train/test
 * split (`@ice/claims`'s `assignSplit`) — retrofitted onto Phase 7's older,
 * looser `eval.test.ts` harness (kept as-is; this is additive, not a
 * replacement).
 *
 * Field names deliberately mirror `ClassificationInput` (`../types.ts`)
 * exactly, so a gold row can be spread straight into `heuristicClassify()`
 * (or, in the optional paid mode, `classifyWithProvider()`) with no
 * reshaping step to get subtly out of sync with the real input shape.
 */

export interface GoldRelationshipCategoryExample {
  id: string;
  /** The human-verified correct label — the eval target. */
  category: RelationshipCategory;
  primaryTitle: string;
  primaryAuthor: string | null;
  /** The candidate reference's own title — the "target label" a reader
   *  would see for this candidate (matches the DB's `annotation.target_label`
   *  naming for the same concept). */
  candidateTitle: string;
  candidateAuthor: string | null;
  /** The verbatim triggering passage. */
  sourceText: string;
  resolved: boolean;
  citationFrequency?: CitationFrequencySignal;
  /** True when this row was authored for this gold set rather than lifted
   *  from an existing fixture/test — never presented as a real citation
   *  either way; this flag exists purely for provenance auditing. */
  synthetic: boolean;
  /** Where this example came from: an existing test file path, or
   *  "synthetic" for an authored-for-this-gold-set row. */
  source: string;
}

const VALID_CATEGORIES = new Set<string>(RELATIONSHIP_CATEGORIES);

function isCitationFrequencySignal(value: unknown): value is CitationFrequencySignal {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.documentMentions === "number" &&
    typeof v.citationMentions === "number" &&
    typeof v.total === "number" &&
    Array.isArray(v.matchedTerms) &&
    v.matchedTerms.every((t) => typeof t === "string")
  );
}

export function isGoldRelationshipCategoryExample(value: unknown): value is GoldRelationshipCategoryExample {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.category !== "string" || !VALID_CATEGORIES.has(v.category)) return false;
  if (typeof v.primaryTitle !== "string") return false;
  if (v.primaryAuthor !== null && typeof v.primaryAuthor !== "string") return false;
  if (typeof v.candidateTitle !== "string") return false;
  if (v.candidateAuthor !== null && typeof v.candidateAuthor !== "string") return false;
  if (typeof v.sourceText !== "string" || v.sourceText.length === 0) return false;
  if (typeof v.resolved !== "boolean") return false;
  if (v.citationFrequency !== undefined && !isCitationFrequencySignal(v.citationFrequency)) return false;
  if (typeof v.synthetic !== "boolean") return false;
  if (typeof v.source !== "string" || v.source.length === 0) return false;
  return true;
}

/** Parses a gold file's raw JSON text and validates every entry, throwing
 *  (not silently dropping) on the first malformed row — same discipline as
 *  `@ice/claims`'s `parseGoldJudgeFile`: a partially-invalid gold file is a
 *  data-quality bug worth surfacing loudly, since a silently-dropped row
 *  would quietly shrink the eval sample without anyone noticing. */
export function parseGoldRelationshipCategoryFile(raw: string): GoldRelationshipCategoryExample[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Gold relationship-category file must be a JSON array.");
  }
  parsed.forEach((item, i) => {
    if (!isGoldRelationshipCategoryExample(item)) {
      throw new Error(`Gold relationship-category example at index ${i} does not conform to GoldRelationshipCategoryExample.`);
    }
  });
  return parsed as GoldRelationshipCategoryExample[];
}
