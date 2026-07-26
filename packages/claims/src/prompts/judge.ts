import {
  CLAIM_RELATION_CATEGORIES,
  CLAIM_RELATION_VALENCES,
  validateMechanismForValence,
  validateValence,
  type ClaimRelationCategory,
  type ClaimRelationValence,
  type Stage2Mechanism,
} from "../taxonomy";

export interface JudgeClaimInput {
  text: string;
  workTitle: string;
}

export type EngagementKind = "direct_citation" | "none_detected";

export interface EngagementContext {
  kind: EngagementKind;
  /** The citing excerpt, when kind is "direct_citation". */
  excerpt?: string;
}

export interface BuildJudgePromptInput {
  claimA: JudgeClaimInput;
  claimB: JudgeClaimInput;
  branch: "empirical" | "humanities";
  engagement?: EngagementContext;
}

function engagementBlock(engagement?: EngagementContext): string {
  if (!engagement) return "";
  if (engagement.kind === "direct_citation") {
    return (
      "Work A explicitly cites Work B" +
      (engagement.excerpt ? ` ("${engagement.excerpt}")` : "") +
      " — treat this as evidence the authors were in direct dialogue, not a coincidental parallel.\n\n"
    );
  }
  return "No citation link was found — do not assume either author read the other.\n\n";
}

/**
 * Judge prompt for a single claim pair. The decision guide, HARD RULES, and
 * BAD/GOOD example are ported near-verbatim from ScholarLens's
 * `agents/contradiction_agent.py` `judge_pair` (licensed, MIT + explicit
 * owner permission). The humanities branch adds a pre-classification step
 * and an optional `mechanism` field the empirical branch never asks for —
 * see `../taxonomy.ts`'s stage-2 mechanisms.
 */
export function buildJudgePrompt(input: BuildJudgePromptInput): string {
  const { claimA, claimB, branch, engagement } = input;

  const humanitiesPreclassification =
    branch === "humanities"
      ? "Before deciding, first determine whether the two claims share the same definitions and " +
        "address the same passage or explanatory level. A difference driven purely by definition " +
        "(the authors mean different things by the same term) or by interpretation (both readings " +
        "are defensible responses to the same passage) is `nuance`, not `contradiction` — reserve " +
        "`contradiction` for genuinely incompatible assertions about the same thing.\n\n"
      : "";

  const mechanismField =
    branch === "humanities"
      ? '- "mechanism" (optional): if relationship is "nuance" or "contradiction" and the divergence ' +
        'is one of these specific kinds, name it — "different_definition", "interprets_differently", or ' +
        '"different_scope_conditions"; omit the field entirely otherwise.\n'
      : "";

  return (
    "You are analyzing two claims from different works.\n\n" +
    `Work A: ${claimA.workTitle}\n` +
    `Claim A: ${claimA.text}\n\n` +
    `Work B: ${claimB.workTitle}\n` +
    `Claim B: ${claimB.text}\n\n` +
    engagementBlock(engagement) +
    humanitiesPreclassification +
    "DECISION GUIDE:\n" +
    "- contradiction: the claims make incompatible assertions — if both are true, " +
    "one must be wrong, or they predict opposite outcomes under the same conditions.\n" +
    "- nuance: they partially agree but differ in scope, population, method, or " +
    "conditions. Neither is wrong — the difference reveals a boundary condition.\n" +
    "- support: they make compatible, mutually reinforcing assertions about the same phenomenon.\n" +
    "- unrelated: they address different phenomena and comparison adds no insight.\n\n" +
    "HARD RULES FOR THE EXPLANATION FIELD:\n" +
    "1. Name the specific point of agreement or conflict — not just the topic area.\n" +
    "2. Reference the actual measurements, methods, or conditions from each claim.\n" +
    "3. Do NOT write a general description of what the works are about.\n" +
    "4. Do NOT use 'Claim A' or 'Claim B' labels.\n" +
    `5. Refer to works by their names: ${claimA.workTitle} and ${claimB.workTitle}.\n\n` +
    "BAD explanation (topic description, not analysis):\n" +
    "Both works demonstrate that automated systems can measure negotiation performance.\n\n" +
    "GOOD explanation (names the specific agreement/conflict):\n" +
    `${claimA.workTitle} measures performance via error classification with GPT-4 ` +
    `(>=0.90 accuracy), while ${claimB.workTitle} uses dialogue-annotation metrics ` +
    "that predict actual outcomes. These are different measurement philosophies - " +
    "one defines error categories top-down, the other derives signal bottom-up from behavior - " +
    "making their accuracy figures non-comparable despite both claiming validity.\n\n" +
    "Return ONLY valid JSON with these fields:\n" +
    `- "relationship": ${CLAIM_RELATION_VALENCES.map((v) => `"${v}"`).join(", ")}\n` +
    `- "category": ${CLAIM_RELATION_CATEGORIES.map((c) => `"${c}"`).join(", ")}\n` +
    '- "explanation": 2-3 sentences. Must name the specific point of difference, ' +
    "not just the subject area. Must reference actual details from each claim.\n" +
    '- "strongerEvidence": "paper_a", "paper_b", or "neither"\n' +
    mechanismField +
    '- "resolution": one concrete sentence on what would resolve this\n\n' +
    "No preamble, no markdown fences."
  );
}

export interface JudgeResult {
  relationship: ClaimRelationValence;
  category: ClaimRelationCategory;
  explanation: string;
  strongerEvidence: "paper_a" | "paper_b" | "neither";
  resolution: string;
  mechanism: Stage2Mechanism | null;
}

export interface ParsedJudgeResponse {
  relationship?: unknown;
  category?: unknown;
  explanation?: unknown;
  strongerEvidence?: unknown;
  resolution?: unknown;
  mechanism?: unknown;
}

/**
 * Validates a parsed judge response.
 *
 * `relationship`/`category` are load-bearing for every downstream consumer
 * (clustering, gates, the UI's own labeling) — an invalid value THROWS.
 * `mechanism` is optional metadata: an invalid mechanism-for-valence pairing
 * (or a fabricated mechanism string) is dropped to null via
 * `validateMechanismForValence`, which itself never coerces, rather than
 * throwing — losing the mechanism doesn't invalidate the core verdict.
 */
export function validateJudgeResponse(parsed: unknown): JudgeResult {
  const p = (parsed ?? {}) as ParsedJudgeResponse;

  const relationship = validateValence(p.relationship);
  if (!relationship) {
    throw new Error(`Judge response "relationship" (${String(p.relationship)}) is not a valid valence.`);
  }
  const category = (CLAIM_RELATION_CATEGORIES as readonly string[]).includes(p.category as string)
    ? (p.category as ClaimRelationCategory)
    : null;
  if (!category) {
    throw new Error(`Judge response "category" (${String(p.category)}) is not a valid category.`);
  }
  const strongerEvidence =
    p.strongerEvidence === "paper_a" || p.strongerEvidence === "paper_b" ? p.strongerEvidence : "neither";

  return {
    relationship,
    category,
    explanation: typeof p.explanation === "string" ? p.explanation : "",
    strongerEvidence,
    resolution: typeof p.resolution === "string" ? p.resolution : "",
    mechanism: validateMechanismForValence(p.mechanism, relationship),
  };
}
