import { SUSTAINED_CITATION_THRESHOLD, type ClassificationInput, type ClassificationResult, type RelationshipCategory } from "../types";

/**
 * Deterministic, no-network relationship classifier — the fallback used
 * when neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is configured. This
 * mirrors Phase 1's ConsoleMailProvider pattern: rather than blocking the
 * whole analysis pipeline on API keys the user hasn't provided yet, the
 * pipeline runs end-to-end against this stub, and every annotation it
 * produces is flagged `heuristic: true` all the way to the UI so it is
 * never presented as a real model verdict.
 *
 * It is pattern matching over the triggering passage plus the resolution
 * signal — genuinely useful (a cited, resolved work really is an
 * explicit reference), but deliberately conservative on confidence, and
 * explicitly NOT a substitute for the LLM classification it stands in
 * for. Keeping it deterministic also makes it unit-testable without a
 * network or a key (see classify.test.ts).
 */

const RULES: { category: RelationshipCategory; pattern: RegExp }[] = [
  {
    category: "disagreement_polemical_target",
    // `criticiz\w*`/`criticis\w*` (not a bare `criticiz\b`) so both American
    // ("criticize"/"criticizes"/"criticizing") and British ("criticise"/
    // "criticises"/"criticising") inflected forms match — a bare `criticiz\b`
    // can never match any of them, since `\b` fails at the z→e transition
    // where the next letter continues the word (see the dated eval-floor
    // comment in eval/relationshipCategories.test.ts for how this was found).
    pattern:
      /\b(reject|refute|criticiz\w*|criticis\w*|against|contra\b|error|mistaken|contrary to|takes issue|polemic|opposes?)\b/i,
  },
  {
    category: "conceptual_influence",
    pattern: /\b(influenc|builds? on|indebted|following|draws on|inherits|derives from|inspired by|owes)\b/i,
  },
  {
    category: "prerequisite",
    pattern: /\b(presupposes?|assumes? familiarity|requires? (?:a )?(?:prior|basic) (?:reading|understanding|knowledge)|builds upon the (?:reader'?s )?knowledge)\b/i,
  },
  {
    category: "historical_context",
    pattern: /\b(history of|historical|tradition of|context of|milieu|era|period|antecedent|background)\b/i,
  },
  {
    category: "parallel_comparison",
    pattern: /\b(compare|cf\.|see also|parallel|analogous|similarly|as with|likewise)\b/i,
  },
  {
    // Placed last among the keyword rules deliberately: these are weak,
    // generic words ("optional", "further reading") that would otherwise
    // risk preempting a stronger, more specific signal earlier in this
    // list (e.g. a disagreement or influence cue) if checked first.
    category: "optional_extension",
    pattern: /\b(optional|skippable|non-?essential|nothing essential|not essential|bonus material|further reading|broader treatment|those interested in)\b/i,
  },
];

// Signals in a candidate's own title that it is secondary literature
// about the primary work, not another primary source.
const SECONDARY_TITLE = /\b(introduction|commentary|companion|guide|study of|reading|reader'?s|interpretation|handbook)\b/i;

export function heuristicClassify(input: ClassificationInput): ClassificationResult {
  const text = input.sourceText ?? "";
  let category: RelationshipCategory | null = null;
  let matched = false;
  let frequencyMatched = false;

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      category = rule.category;
      matched = true;
      break;
    }
  }

  if (!category && SECONDARY_TITLE.test(input.candidateTitle)) {
    // A resolved secondary work with no polemical/influence cue reads as
    // a scholarly recommendation; an unresolved one as an interpretive aid.
    category = input.resolved ? "secondary_scholarly_recommendation" : "interpretive_aid";
    matched = true;
  }

  if (!category && (input.citationFrequency?.total ?? 0) >= SUSTAINED_CITATION_THRESHOLD) {
    category = "prerequisite";
    matched = true;
    frequencyMatched = true;
  }

  if (!category) {
    category = input.resolved ? "explicit_reference" : "ai_inferred";
  }

  // Confidence reflects signal strength, deliberately capped below what a
  // real model verdict would carry — this is a stub, and the number says so.
  let confidence: number;
  if (frequencyMatched) confidence = input.resolved ? 0.62 : 0.42;
  else if (input.resolved && matched) confidence = 0.7;
  else if (input.resolved) confidence = 0.6;
  else if (matched) confidence = 0.45;
  else confidence = 0.3;

  const explanation = buildExplanation(category, input);

  return {
    category,
    explanation,
    confidence,
    provider: "heuristic",
    model: "heuristic-fallback",
    promptTokens: 0,
    completionTokens: 0,
    heuristic: true,
    // No deterministic basis to judge level-specificity — always universal.
    readerLevel: null,
  };
}

function buildExplanation(category: RelationshipCategory, input: ClassificationInput): string {
  const resolvedNote = input.resolved
    ? "resolved to a bibliographic record"
    : "not resolved to a bibliographic record (kept as an unverified citation)";
  const readable = category.replace(/_/g, " ");
  return `Heuristic classification: appears to be a ${readable} of "${input.primaryTitle}", ${resolvedNote}. Generated without an AI model (no API key configured) — verify before relying on it.`;
}
