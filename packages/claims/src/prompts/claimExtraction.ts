import { CLAIM_NATURES, isClaimNature, type ClaimNature } from "../taxonomy";

export type ClaimConfidence = "high" | "medium" | "low";

export interface ExtractedClaim {
  text: string;
  nature: ClaimNature;
  section: string;
  confidence: ClaimConfidence;
  /** A LITERAL substring of one of the supplied block texts — verified by
   *  `validateClaimExtraction`, never trusted on the model's say-so. */
  supportingExcerpt: string;
}

export interface BuildClaimExtractionPromptInput {
  workTitle: string;
  documentText: string;
}

/**
 * Claim-extraction prompt. The HARD RULES and empirical BAD/GOOD examples
 * are ported near-verbatim from ScholarLens's `agents/contradiction_agent.py`
 * `extract_claims` (licensed, MIT + explicit owner permission — see
 * docs/PROJECT-LOG.md's Design Decisions row on the reference project). Two
 * humanities BAD/GOOD pairs and the `nature` field/enum are new additions
 * for Palimnote's textual-scholarship domain, which ScholarLens's
 * empirical-paper corpus never had to handle. `supportingExcerpt` is also
 * new: ScholarLens's own extraction has no grounding-verification field —
 * this package adds one because `validateClaimExtraction` below refuses to
 * accept an extracted claim it can't verify against the source text.
 */
export function buildClaimExtractionPrompt(input: BuildClaimExtractionPromptInput): string {
  return (
    "Extract specific, falsifiable claims from the full text of this work. " +
    "Each claim must come directly from what the text asserts — not from inference or summary — " +
    "and must be narrow enough that another work could plausibly disagree with it.\n\n" +
    "HARD RULES — violating any of these makes a claim useless:\n" +
    "1. Name the exact system/method/text/author (never 'it', 'the approach', 'the author')\n" +
    "2. Name the exact outcome variable, metric, or interpretive claim being made\n" +
    "3. Include numbers where they exist (accuracy, effect size, p-value, sample size, " +
    "percentage change). If no numbers, state the direction and magnitude qualitatively.\n" +
    "4. State the population, task, passage, or conditions the result/reading holds under\n" +
    "5. Claims must be about SPECIFIC findings or positions, not general capabilities. " +
    "'System X can do Y' is too broad. " +
    "'System X achieved Z% accuracy on task T in condition C' is correct.\n\n" +
    "CLAIM TYPES TO PRIORITIZE (roughly in order):\n" +
    "- Measurement claims: what metric was used and what it found\n" +
    "- Causal claims: what intervention produced what effect and under what conditions\n" +
    "- Comparative claims: how this approach or reading differs from a baseline or prior work in measurable terms\n" +
    "- Scope/boundary claims: where the method or interpretation works and where it breaks down\n\n" +
    "REJECT these as too vague to be useful:\n" +
    "- 'Text X demonstrates that Y matters' (topic description, not a claim)\n" +
    "- 'The results show the approach is effective' (no specifics)\n" +
    "- 'This work contributes to the field of Z' (meta-statement)\n\n" +
    "BAD: 'ACE improves negotiation outcomes.'\n" +
    "GOOD: 'ACE feedback produced significantly greater deal prices than human or no feedback " +
    "(F(2,371)=10.79, p<0.001) in a 374-participant two-used-car negotiation task.'\n\n" +
    "BAD: 'The system uses automated metrics to evaluate negotiation.'\n" +
    "GOOD: 'Dialogue-annotation-based metrics predicted actual negotiation outcomes with r=0.67 " +
    "in the Johnson et al. dataset, outperforming human rater agreement on the same task.'\n\n" +
    "BAD (interpretive claim with no named position or locus): " +
    "'Aristotle thinks akrasia is complicated.'\n" +
    "GOOD (names the interpreter's exact position AND the locus): " +
    "'Irwin reads Aristotle's account of akrasia at NE 7.3.1147a24-b19 as holding that the " +
    "akratic agent's practical syllogism is incomplete at the moment of action, not merely " +
    "that appetite overrides a fully-formed judgment.'\n\n" +
    "BAD (no named interpreter, no locus): " +
    "'Some scholars disagree about what Plato means by the divided line.'\n" +
    "GOOD (names the interpreter's exact position AND the locus): " +
    "'Cross and Woozley (Republic 509d-511e) argue the four segments of the divided line map onto " +
    "four distinct cognitive states rather than two, against readings that collapse pistis and eikasia.'\n\n" +
    "Return ONLY valid JSON: a list of objects with fields:\n" +
    '"text" (the self-contained claim — must satisfy all 5 rules above),\n' +
    `"nature" (one of: ${CLAIM_NATURES.join(", ")}),\n` +
    '"section" (the section this claim comes from),\n' +
    '"confidence" ("high"=quantitative evidence or a precisely-named position+locus, ' +
    '"medium"=qualitative with clear direction, "low"=speculative or indirect),\n' +
    '"supportingExcerpt" (a LITERAL, VERBATIM substring copied from the supplied text — ' +
    "not a paraphrase — that supports this claim; used to verify the claim is grounded, not invented).\n\n" +
    "Return 6-10 claims (never fewer than 1, never more than 12). " +
    "Fewer high-quality claims beat many vague ones. " +
    "No preamble, no markdown fences.\n\n" +
    `Work: ${input.workTitle}\n\n<document>\n${input.documentText}\n</document>`
  );
}

export interface ParsedClaimExtractionItem {
  text?: unknown;
  nature?: unknown;
  section?: unknown;
  confidence?: unknown;
  supportingExcerpt?: unknown;
}

/**
 * Validates a parsed claim-extraction response against the block texts it
 * was extracted from. Throws (never silently drops or coerces a field) on
 * any violation — a fabricated excerpt, an out-of-enum nature, or a claim
 * count outside [1,12] means the WHOLE extraction is untrustworthy, not
 * that one item should be quietly skipped while the rest are kept.
 */
export function validateClaimExtraction(parsed: unknown, blockTexts: string[]): ExtractedClaim[] {
  if (!Array.isArray(parsed)) {
    throw new Error("Claim extraction response must be a JSON array.");
  }
  if (parsed.length < 1 || parsed.length > 12) {
    throw new Error(`Claim extraction returned ${parsed.length} claims; must be between 1 and 12.`);
  }

  return parsed.map((raw, index) => {
    const item = raw as ParsedClaimExtractionItem;

    if (typeof item.text !== "string" || item.text.trim().length === 0) {
      throw new Error(`Claim ${index}: missing or empty "text".`);
    }
    if (!isClaimNature(item.nature)) {
      throw new Error(`Claim ${index}: "nature" (${String(item.nature)}) is not one of ${CLAIM_NATURES.join(", ")}.`);
    }
    if (typeof item.section !== "string" || item.section.trim().length === 0) {
      throw new Error(`Claim ${index}: missing or empty "section".`);
    }
    const confidence = item.confidence;
    if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
      throw new Error(`Claim ${index}: "confidence" (${String(confidence)}) must be high/medium/low.`);
    }
    if (typeof item.supportingExcerpt !== "string" || item.supportingExcerpt.trim().length === 0) {
      throw new Error(`Claim ${index}: missing or empty "supportingExcerpt".`);
    }
    const grounded = blockTexts.some((block) => block.includes(item.supportingExcerpt as string));
    if (!grounded) {
      throw new Error(
        `Claim ${index}: "supportingExcerpt" is not a literal substring of any supplied block — likely fabricated.`,
      );
    }

    return {
      text: item.text,
      nature: item.nature,
      section: item.section,
      confidence,
      supportingExcerpt: item.supportingExcerpt,
    };
  });
}
