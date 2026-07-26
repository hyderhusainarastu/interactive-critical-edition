/**
 * Hypothesis generation from detected claim conflicts. Ports the
 * [CONFLICT_N] short-label pattern from ScholarLens's
 * `agents/hypothesis_agent.py` `_gather_conflict_context`/`generate`
 * (licensed, MIT + explicit owner permission): the model only ever sees
 * short synthetic labels, never real database ids, so a hallucinated
 * citation can't leak a real-looking-but-wrong id downstream —
 * `validateHypothesisResponse` cross-checks every cited label against
 * `labelToReal` and drops anything that doesn't resolve, exactly like the
 * ported Python's own post-parse validation.
 */

export interface HypothesisConflictInput {
  id: string;
  relationship: string; // "contradiction" | "nuance"
  category: string;
  workATitle: string;
  claimAText: string;
  workBTitle: string;
  claimBText: string;
  explanation: string;
  resolution: string;
}

export interface BuildHypothesisPromptResult {
  prompt: string;
  /** Short label ("CONFLICT_1", ...) → the real conflict id it stands in for.
   *  Passed straight through to `validateHypothesisResponse`. */
  labelToReal: Map<string, string>;
}

export function buildHypothesisPrompt(
  conflicts: HypothesisConflictInput[],
  researchQuestion: string | null,
): BuildHypothesisPromptResult {
  const labelToReal = new Map<string, string>();
  const parts: string[] = [];

  conflicts.forEach((c, idx) => {
    const label = `CONFLICT_${idx + 1}`;
    labelToReal.set(label, c.id);
    parts.push(
      `[${label}]\n` +
        `  Type: ${c.relationship} (${c.category})\n` +
        `  Work A: "${c.workATitle}"\n` +
        `  Claim A: "${c.claimAText}"\n` +
        `  Work B: "${c.workBTitle}"\n` +
        `  Claim B: "${c.claimBText}"\n` +
        `  Explanation: ${c.explanation || "(none)"}\n` +
        `  Resolution path: ${c.resolution || "(none)"}\n`,
    );
  });

  const questionBlock = researchQuestion
    ? `\nThe researcher's specific question: ${researchQuestion}\nFocus hypotheses on this question, grounded in the conflicts above.\n`
    : "\nNo specific question given. Identify the most promising research directions from the conflicts above.\n";

  const prompt =
    "You are a research hypothesis generator.\n\n" +
    "You are given DETECTED CONFLICTS between claims in a research library. " +
    "Each conflict has a short label like [CONFLICT_1], [CONFLICT_2], etc. " +
    "Generate hypotheses that explain, resolve, or exploit these tensions. " +
    "For each hypothesis, include a 'sourceConflictLabels' field listing the " +
    "conflict labels (e.g. ['CONFLICT_1', 'CONFLICT_3']) that the hypothesis " +
    "draws from. Only cite labels that appear in the conflict list — do not " +
    "invent labels. Do NOT reference conflict labels in your rationale prose — " +
    "refer to the works and claims by their actual titles and content instead.\n\n" +
    "DETECTED CONFLICTS:\n\n" +
    parts.join("\n\n") +
    questionBlock +
    "\nGenerate 3-5 hypotheses.\n\n" +
    "Return ONLY valid JSON: a list of objects with these fields:\n" +
    '- "statement": the hypothesis in one clear sentence\n' +
    '- "rationale": 2-3 sentences explaining why this hypothesis is ' +
    "worth testing, referencing specific works or conflicts\n" +
    '- "sourceConflictLabels": list of conflict label strings this hypothesis draws from\n' +
    '- "methodology": 2-3 sentences describing how to test this\n' +
    '- "challenges": list of 2-3 predicted obstacles\n\n' +
    "No preamble, no markdown fences, no text outside the JSON.\n" +
    "Do NOT include novelty or impact fields — those are computed separately, never self-assessed.";

  return { prompt, labelToReal };
}

export interface HypothesisResult {
  statement: string;
  rationale: string;
  sourceConflictIds: string[];
  methodology: string;
  challenges: string[];
}

export interface ParsedHypothesisItem {
  statement?: unknown;
  rationale?: unknown;
  sourceConflictLabels?: unknown;
  methodology?: unknown;
  challenges?: unknown;
  [key: string]: unknown;
}

const FORBIDDEN_SELF_ASSESSMENT_FIELDS = ["novelty", "noveltyScore", "noveltyTier", "impact", "impactScore"];

/**
 * Drops fabricated conflict labels (kept only if they resolve via
 * `labelToReal` to a real, currently-valid conflict id — mirroring the
 * ported Python's own "drop, don't fabricate" behavior) and forbids any
 * self-assessed novelty/impact field. Novelty is always computed separately
 * (`src/novelty.ts`), never asked of the model — a model that includes one
 * anyway despite the prompt's instruction must be caught, not silently
 * accepted, since accepting it would let a self-assessed number quietly
 * substitute for the corpus-relative one this package computes.
 */
export function validateHypothesisResponse(parsed: unknown, labelToReal: Map<string, string>): HypothesisResult[] {
  if (!Array.isArray(parsed)) {
    throw new Error("Hypothesis response must be a JSON array.");
  }
  const validIds = new Set(labelToReal.values());

  return parsed.map((raw, index) => {
    const item = raw as ParsedHypothesisItem;

    for (const forbidden of FORBIDDEN_SELF_ASSESSMENT_FIELDS) {
      if (forbidden in item) {
        throw new Error(
          `Hypothesis ${index} includes forbidden self-assessed field "${forbidden}" — novelty/impact must be computed, never model-asserted.`,
        );
      }
    }
    if (typeof item.statement !== "string" || item.statement.trim().length === 0) {
      throw new Error(`Hypothesis ${index}: missing or empty "statement".`);
    }

    const labels = Array.isArray(item.sourceConflictLabels) ? item.sourceConflictLabels : [];
    const sourceConflictIds: string[] = [];
    for (const ref of labels) {
      if (typeof ref !== "string") continue;
      const label = ref.startsWith("CONFLICT_") ? ref : `CONFLICT_${ref}`;
      const realId = labelToReal.get(label);
      if (realId && validIds.has(realId)) sourceConflictIds.push(realId);
    }

    return {
      statement: item.statement,
      rationale: typeof item.rationale === "string" ? item.rationale : "",
      sourceConflictIds,
      methodology: typeof item.methodology === "string" ? item.methodology : "",
      challenges: Array.isArray(item.challenges)
        ? item.challenges.filter((c): c is string => typeof c === "string")
        : [],
    };
  });
}
