import {
  CLAIM_RELATION_CATEGORIES,
  CLAIM_RELATION_VALENCES,
  STAGE2_MECHANISMS,
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
 * v2 (Phase 25.5b) added three candidate blocks — a decision-tree preamble,
 * boundary-case few-shots, and an anti-catch-all instruction — to address
 * that spike's failure mode (systematic over-prediction of "nuance").
 * `scripts/research/judge-eval-v2.mts` A/B'd three combinations on the TRAIN
 * split (gpt-5.4-nano): decision-tree+anti-catch-all alone (train macroF1
 * 0.569), few-shot+anti-catch-all alone (0.582, WINNER), and all three
 * together (0.540). The train-selected winner (few-shot + anti-catch-all,
 * no decision tree) shipped briefly, but full-42 scoring found it did NOT
 * generalize: claude-haiku-4-5 macroF1 0.694/kappa 0.584/contradictionRecall
 * 0.667 — WORSE than the plain v1 prompt on every axis. See
 * docs/eval/research-claims/spike-25-5b-judge-iteration.md for the full
 * variant table, confusion matrices, and cost tally.
 *
 * v3 (Phase 25.5c) reverts the prompt text to v1's BASELINE — every v2
 * addition OFF — after docs/eval/research-claims/spike-25-5c-output-mode.md
 * found it, not any v2 combination, was the best-performing STRUCTURED
 * (forced tool-use) prompt measured across three spikes. That spike tested
 * the moderator's hypothesis that forced tool-use itself (denying the model
 * pre-answer reasoning) explained the gap to ScholarLens's own reported
 * baseline (macroF1 0.788): a raw-text "Return ONLY valid JSON" call with
 * this BASELINE prompt scored 0.752/0.650/1.000 on claude-haiku-4-5 — the
 * first config in this whole effort to clear all three gates (src/eval/
 * gates.ts) — while the same prompt via structured tool-use with a
 * "reasoning" field FIRST in the schema scored 0.733/0.616/0.778, close
 * but still missing the macroF1 gate by 0.017 (the closest any structured
 * config has come). Per the task's decision rule, raw-text mode is NOT
 * wired into production here (it weakens the retry/validation guarantees
 * `AnthropicStructuredClient`/`OpenAIResponsesClient` both provide); what
 * ships is the best STRUCTURED config — this v1 BASELINE prompt text plus a
 * `reasoning` field prepended to `JUDGE_OUTPUT_SCHEMA` below, which
 * `validateJudgeResponse` deliberately never reads. The moderator owns any
 * future decision on productionizing raw-text mode.
 */
export const JUDGE_PROMPT_VERSION = "judge-v3-baseline-reasoning-schema";

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
 * (unchanged) HARD RULES/JSON-schema text. Defaulting every flag to `true`
 * matches what the harness A/B'd as "variant C" — it is NOT what
 * `buildJudgePrompt` ships. As of Phase 25.5c, `buildJudgePrompt` calls this
 * with every flag explicitly `false` (the BASELINE prompt) — see
 * `JUDGE_PROMPT_VERSION`'s doc comment for why. Nothing in the real
 * pipeline should call `buildJudgePromptVariant` directly with a
 * non-default option; that surface exists for the eval harness only.
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

/** The shipped v3 prompt — the BASELINE ablation (every v2 addition OFF),
 *  restored after the Phase 25.5c spike found it outperforms every v2
 *  combination measured so far as a STRUCTURED (forced tool-use) prompt;
 *  see JUDGE_PROMPT_VERSION's doc comment for the full history and
 *  numbers. Real pipeline code (and every test except the harness's own
 *  variant A/B/C comparison) calls this. Pair with `JUDGE_OUTPUT_SCHEMA`
 *  below, not a schema missing the `reasoning` field, to get the measured
 *  structured-mode numbers. */
export function buildJudgePrompt(input: BuildJudgePromptInput): string {
  return buildJudgePromptVariant(input, { includeDecisionTree: false, includeAntiCatchAll: false, includeFewShot: false });
}

/**
 * Canonical structured-output JSON schema for the judge call — one shape
 * usable both as an Anthropic forced-tool-use `input_schema`
 * (`AnthropicStructuredClient`) and as an OpenAI strict `json_schema`
 * response format (`OpenAIResponsesClient`, which requires every property
 * to appear in `required` — hence `mechanism` is a nullable string rather
 * than an omittable field, exactly as the Phase 25.5/25.5b eval scripts'
 * own local schema constants already did).
 *
 * `reasoning` is deliberately the FIRST property. The Phase 25.5c spike
 * (docs/eval/research-claims/spike-25-5c-output-mode.md) tested the
 * moderator's hypothesis that forced tool-use denies the model pre-answer
 * reasoning, and measured: putting a free-text `reasoning` field ahead of
 * the verdict fields inside the SAME structured tool call moved
 * claude-haiku-4-5 from 0.732/0.614/0.667 (Phase 25.5's baseline, no
 * reasoning field) to 0.733/0.616/0.778 — better on 2 of 3 gates and only
 * 0.017 short of the macroF1 gate, the closest any structured config has
 * come. `validateJudgeResponse` below never reads `reasoning` — its only
 * job is to give the model somewhere to think before the fields that
 * actually get used.
 *
 * Not yet wired into any production job (this task type has no caller
 * yet — see `packages/ai-adapters/src/routing.ts`'s `TASK_ROUTES` comment
 * on `claim_relationship_judgment`); this schema is what a future caller
 * should reach for once one exists.
 */
export const JUDGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description: "2-4 sentences working through the decision guide before deciding.",
    },
    relationship: { type: "string", enum: [...CLAIM_RELATION_VALENCES] },
    category: { type: "string", enum: [...CLAIM_RELATION_CATEGORIES] },
    explanation: { type: "string" },
    strongerEvidence: { type: "string", enum: ["paper_a", "paper_b", "neither"] },
    mechanism: { type: ["string", "null"], enum: [...STAGE2_MECHANISMS, null] },
    resolution: { type: "string" },
  },
  required: ["reasoning", "relationship", "category", "explanation", "strongerEvidence", "mechanism", "resolution"],
  additionalProperties: false,
} as const;

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
