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

/**
 * Bumped whenever `buildJudgePrompt`'s actual instruction text changes in a
 * way that could shift model output — a cache/eval-provenance marker, not a
 * behavioral switch. v1 was the near-verbatim ScholarLens port (measured:
 * nano macroF1 0.582/kappa 0.450/contradictionRecall 0.333, mini 0.584/
 * 0.411/0.333, claude-haiku-4-5 0.732/0.614/0.667 — see
 * docs/eval/research-claims/spike-25-5-judge.md).
 *
 * v2 (Phase 25.5b) adds three candidate blocks — a decision-tree preamble,
 * boundary-case few-shots, and an anti-catch-all instruction — to address
 * that spike's failure mode (systematic over-prediction of "nuance").
 * `scripts/research/judge-eval-v2.mts` A/B'd three combinations on the TRAIN
 * split (gpt-5.4-nano): decision-tree+anti-catch-all alone (train macroF1
 * 0.569), few-shot+anti-catch-all alone (0.582, WINNER), and all three
 * together (0.540 — the "kitchen sink" combination actually did *worse*
 * here than few-shot alone). The shipped prompt below is the winning
 * ablation — few-shot examples + the anti-catch-all instruction, WITHOUT
 * the decision-tree preamble — not the union of every new block.
 *
 * Full-42 final scoring of the shipped (winning) prompt: gpt-5.4-nano
 * macroF1 0.563/kappa 0.439/contradictionRecall 1.000; claude-haiku-4-5
 * macroF1 0.694/kappa 0.584/contradictionRecall 0.667 — neither clears the
 * gates (src/eval/gates.ts). Notably, the "kitchen sink" combination that
 * *lost* the train-based selection scored BETTER on the full 42 for haiku
 * (macroF1 0.726/kappa 0.617, missing the macroF1 gate by only 0.024) — a
 * real train→full-scale generalization gap flagged for the moderator, not
 * papered over. See docs/eval/research-claims/spike-25-5b-judge-iteration.md
 * for the full variant table, confusion matrices, and cost tally.
 */
export const JUDGE_PROMPT_VERSION = "judge-v2b-fewshot-anticatchall";

function engagementBlock(engagement?: EngagementContext): string {
  // Only a confirmed direct citation is worth telling the judge about. A
  // "none_detected" block ("No citation link was found — do not assume
  // either author read the other") was measured in the Phase 25.5 spike to
  // NOT be neutral — 2/10 pairs flipped their predicted relationship
  // (toward `unrelated`) purely from that framing text being present vs.
  // omitted (docs/eval/research-claims/spike-25-5-judge.md, "Robustness
  // sub-check"). `engagement.kind === "none_detected"` therefore still
  // exists as a real, distinguishable input (the caller "checked and found
  // nothing", vs. omitting `engagement` entirely meaning "didn't check") for
  // logging/provenance purposes, but it renders no text into the prompt.
  if (!engagement || engagement.kind !== "direct_citation") return "";
  return (
    "Work A explicitly cites Work B" +
    (engagement.excerpt ? ` ("${engagement.excerpt}")` : "") +
    " — treat this as evidence the authors were in direct dialogue, not a coincidental parallel.\n\n"
  );
}

const DECISION_TREE_PREAMBLE =
  "DECISION TREE — walk through these steps in order before choosing a relationship:\n" +
  "Step 1 (construct check): do the two claims measure the SAME construct — the same " +
  "measurement, or a defensible proxy for it — or do they address ORTHOGONAL constructs " +
  "(different phenomena, with no shared measurement and no proxy relationship between them)? " +
  "If orthogonal, the relationship is `unrelated` (no shared construct at all) or, only if a " +
  "genuine indirect connection is worth naming, `nuance` — orthogonal constructs can NEVER be " +
  "`contradiction`, because claims about different things cannot logically conflict.\n" +
  "Step 2 (compatibility check): if the claims DO share a construct, could both be true at once " +
  "given their stated or reasonably inferable conditions (population, scope, method, timeframe, " +
  "or definition)? If yes, the relationship is `nuance` (a named boundary condition explains the " +
  "difference) or `support` (they simply reinforce each other with no material difference).\n" +
  "Step 3 (contradiction): only reach `contradiction` when the claims share the same construct " +
  "AND cannot both be true under any reasonable reading of their stated conditions.\n\n";

const NUANCE_ANTI_CATCH_ALL =
  "`nuance` is not a default for \"related but I'm not sure how\" — it requires identifying the " +
  "SPECIFIC boundary condition (scope, population, method, or definition) that lets both claims " +
  "be true. If you cannot name that specific condition, the pair is not `nuance` — it is " +
  "`contradiction` (same construct, genuinely incompatible), `support` (same construct, no " +
  "material difference), or `unrelated` (different constructs).\n\n";

// Few-shot boundary cases, deliberately authored from domains that do NOT
// appear in this package's gold sets (sleep research, econometrics,
// materials science) so tuning against them can never contaminate the eval
// (docs/eval/research-claims/spike-25-5-judge.md's gold data is negotiation-
// coaching/information-retrieval/LLM-reasoning/ancient-philosophy only).
// Targets exactly the boundary the Phase 25.5 spike found hardest: the
// nuance/contradiction line (examples 1-3) and the nuance/support line
// (examples 4-5), plus one orthogonal/unrelated case reinforcing Step 1.
const FEW_SHOT_EXAMPLES =
  "FEW-SHOT EXAMPLES (boundary cases from other domains — study the reasoning, not the topics; " +
  "the actual pair you are judging is unrelated to any of these):\n\n" +
  "1. Claim A: \"In a randomized trial of shift workers, blue-light-filtering glasses worn in the " +
  "two hours before bed increased total sleep time by 27 minutes relative to placebo lenses " +
  "(p=0.01).\" Claim B: \"Evening blue-light exposure does not meaningfully change sleep-onset " +
  "latency in a population of retirees with fixed early bedtimes.\" → `nuance` (different " +
  "populations — shift workers with variable schedules vs. retirees with already-fixed early " +
  "bedtimes — and different outcome measures — total sleep time vs. onset latency — name the " +
  "boundary condition; this is not a real disagreement).\n\n" +
  "2. Claim A: \"Minimum-wage increases in urban counties with tight labor markets produced no " +
  "detectable employment loss over a 24-month window.\" Claim B: \"Minimum-wage increases in " +
  "rural counties with slack labor markets reduced teen employment by 4.6% within 12 months.\" → " +
  "`nuance` (different labor-market conditions — tight urban vs. slack rural — and a narrower " +
  "demographic slice — teens specifically vs. all workers — are the named boundary condition).\n\n" +
  "3. Claim A: \"Among healthy adults on a fixed 8-hour sleep-opportunity protocol, a single night " +
  "of total sleep deprivation impaired next-day working-memory accuracy by 18%.\" Claim B: " +
  "\"Among healthy adults on the same fixed 8-hour sleep-opportunity protocol, a single night of " +
  "total sleep deprivation produced no measurable change in next-day working-memory accuracy.\" " +
  "→ `contradiction` (same population, same protocol, same outcome measure, same timeframe — no " +
  "boundary condition can be named that lets both be true, so the effect either exists or it " +
  "does not).\n\n" +
  "4. Claim A: \"Firms that adopted the new e-invoicing mandate saw a 3% average reduction in " +
  "accounts-receivable days within the first fiscal year.\" Claim B: \"The e-invoicing mandate's " +
  "benefit was concentrated in large firms, which saw a 9% reduction in accounts-receivable days, " +
  "while small firms saw no significant change.\" → `nuance` (claim B decomposes claim A's average " +
  "by firm size and finds no effect for one subgroup — a named scope refinement, not simple " +
  "reinforcement, since the two figures are compatible only once that boundary is drawn).\n\n" +
  "5. Claim A: \"A cohort study of night-shift nurses found that a consistent wind-down routine " +
  "before daytime sleep was associated with a 22% lower rate of self-reported insomnia symptoms.\" " +
  "Claim B: \"An independent survey of night-shift factory workers found that those who followed a " +
  "structured pre-sleep wind-down routine reported significantly fewer insomnia symptoms than " +
  "those who did not.\" → `support` (two independent samples — nurses vs. factory workers — " +
  "converge on the same relationship with no material scope/method difference that would qualify " +
  "it; mutually reinforcing, not merely parallel).\n\n" +
  "6. Claim A: \"Adding 2% graphene oxide to the epoxy matrix increased fracture toughness by 35% " +
  "without a measurable change in glass transition temperature.\" Claim B: \"Night-shift nurses " +
  "who used a consistent wind-down routine reported fewer insomnia symptoms than those who did " +
  "not.\" → `unrelated` (orthogonal constructs — composite-material fracture mechanics vs. human " +
  "sleep behavior — share no measurement, population, or claim; per Step 1, orthogonal constructs " +
  "are never `contradiction` even though both claims are empirical).\n\n";

/**
 * Toggles for the v2 additions, exposed only so the Phase 25.5b prompt-
 * iteration harness (`scripts/research/judge-eval-v2.mts`) can A/B the three
 * new blocks against the TRAIN split without duplicating the surrounding
 * (unchanged) HARD RULES/JSON-schema text. `buildJudgePrompt` below is the
 * one shipped call shape — it always runs with every flag on (the v2
 * prompt); nothing in the real pipeline should call `buildJudgePromptVariant`
 * with a non-default option.
 */
export interface JudgePromptVariantOptions {
  /** Default true. */
  includeDecisionTree?: boolean;
  /** Default true. */
  includeAntiCatchAll?: boolean;
  /** Default true. */
  includeFewShot?: boolean;
}

/**
 * Judge prompt for a single claim pair. The decision guide, HARD RULES, and
 * BAD/GOOD example are ported near-verbatim from ScholarLens's
 * `agents/contradiction_agent.py` `judge_pair` (licensed, MIT + explicit
 * owner permission) — that ported text is v1's entire prompt and is left
 * unchanged here. v2 (Phase 25.5b) adds the decision-tree preamble,
 * boundary-case few-shots, and an explicit anti-catch-all instruction above,
 * targeting the systematic nuance-over-prediction failure mode the Phase
 * 25.5 spike measured (docs/eval/research-claims/spike-25-5-judge.md). The
 * humanities branch adds a pre-classification step and an optional
 * `mechanism` field the empirical branch never asks for — see
 * `../taxonomy.ts`'s stage-2 mechanisms.
 */
export function buildJudgePromptVariant(
  input: BuildJudgePromptInput,
  options: JudgePromptVariantOptions = {},
): string {
  const { includeDecisionTree = true, includeAntiCatchAll = true, includeFewShot = true } = options;
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
    (includeDecisionTree ? DECISION_TREE_PREAMBLE : "") +
    "DECISION GUIDE:\n" +
    "- contradiction: the claims make incompatible assertions — if both are true, " +
    "one must be wrong, or they predict opposite outcomes under the same conditions.\n" +
    "- nuance: they partially agree but differ in scope, population, method, or " +
    "conditions. Neither is wrong — the difference reveals a boundary condition.\n" +
    "- support: they make compatible, mutually reinforcing assertions about the same phenomenon.\n" +
    "- unrelated: they address different phenomena and comparison adds no insight.\n\n" +
    (includeAntiCatchAll ? NUANCE_ANTI_CATCH_ALL : "") +
    (includeFewShot ? FEW_SHOT_EXAMPLES : "") +
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

/** The shipped v2 prompt — the winning ablation from the Phase 25.5b
 *  variant selection (few-shot examples + anti-catch-all instruction,
 *  decision-tree preamble OFF; see JUDGE_PROMPT_VERSION's doc comment).
 *  Real pipeline code (and every test except the harness's own variant
 *  A/B/C comparison) calls this. */
export function buildJudgePrompt(input: BuildJudgePromptInput): string {
  return buildJudgePromptVariant(input, { includeDecisionTree: false, includeAntiCatchAll: true, includeFewShot: true });
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
