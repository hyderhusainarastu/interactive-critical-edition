/**
 * "Evidence chamber": a structured, neutral comparison of the positions
 * inside a claim cluster. New prompt, no ScholarLens analogue — ScholarLens's
 * `judge_pair` picks a `stronger_evidence` side per PAIR; this instead asks
 * for a neutral structured comparison across a whole CLUSTER of related
 * claims, and is deliberately built to never let the model declare a
 * winner. That's the project's anti-hallucination posture (plan §11/§12
 * R1): a claim-comparison feature must never present a contested scholarly
 * question as settled — evidence-strength/textual-support scoring
 * (`src/scoring/`) is computed separately and deterministically, and is
 * never something this prompt asks the model to reproduce or rule on.
 */

export interface EvidenceChamberClaimInput {
  text: string;
  workTitle: string;
}

export interface EvidenceChamberInput {
  clusterName: string;
  claims: EvidenceChamberClaimInput[];
}

export interface EvidenceChamberPosition {
  label: string;
  summary: string;
  method: string;
  scope: string;
  stanceConfidence: "high" | "medium" | "low";
}

export interface EvidenceChamberResult {
  question: string;
  sharedGround: string;
  pointOfDivergence: string;
  possibleReconciliation: string;
  unresolvedQuestion: string;
  missingEvidence: string;
  nextAction: string;
  positions: EvidenceChamberPosition[];
}

export function buildEvidenceChamberPrompt(input: EvidenceChamberInput): string {
  const formatted = input.claims.map((c, i) => `[Position ${i + 1}] ${c.workTitle}: ${c.text}`).join("\n");
  return (
    `The following claims, from a cluster named "${input.clusterName}", relate to a shared question.\n\n` +
    `${formatted}\n\n` +
    "Produce a NEUTRAL, structured comparison. Do not declare a winner, rank the positions by " +
    "correctness, or say which is stronger overall — evidence-strength scoring is computed " +
    "separately and deterministically; your job here is to lay out the positions clearly, not judge them.\n\n" +
    "Return ONLY valid JSON with these fields:\n" +
    '- "question": the shared question these positions respond to\n' +
    '- "sharedGround": what all positions actually agree on\n' +
    '- "pointOfDivergence": the specific place the positions diverge\n' +
    '- "possibleReconciliation": one plausible way the positions could both be right (or state if none exists)\n' +
    '- "unresolvedQuestion": what remains genuinely open\n' +
    '- "missingEvidence": what evidence, if it existed, would settle this\n' +
    '- "nextAction": one concrete next step a reader could take\n' +
    '- "positions": a list of {"label": short name for this position (e.g. the author/work), ' +
    '"summary": the position in one sentence, "method": how this position was reached ' +
    "(textual/empirical/etc.), \"scope\": what this position claims to cover, " +
    '"stanceConfidence": "high"/"medium"/"low" — how confidently the SOURCE TEXT itself states ' +
    "this position (never your own confidence in who is right)}\n\n" +
    "Do NOT include any field named or resembling 'winner', 'verdict', 'stronger', 'prevail', or 'rank' — " +
    "this output is a map of the disagreement, not a ruling on it.\n\n" +
    "No preamble, no markdown fences."
  );
}

const FORBIDDEN_KEY_PATTERN = /winner|verdict|stronger|prevail|rank/i;

function assertNoForbiddenKeys(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenKeys(item, `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new Error(`Evidence chamber response contains a forbidden ranking-like key "${key}" at ${path}.${key}.`);
    }
    assertNoForbiddenKeys((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

/**
 * Recursively rejects any output containing a key that looks like a
 * ranking/verdict — even nested inside `positions` or any other structure —
 * since a single missed field would silently reintroduce the "the model
 * picked a winner" failure mode this prompt exists to prevent. Throws
 * rather than stripping the offending key, so a violation is always visible
 * rather than silently sanitized away.
 */
export function validateEvidenceChamberResponse(parsed: unknown): EvidenceChamberResult {
  assertNoForbiddenKeys(parsed, "$");

  const p = (parsed ?? {}) as Record<string, unknown>;

  const requiredStrings = [
    "question",
    "sharedGround",
    "pointOfDivergence",
    "possibleReconciliation",
    "unresolvedQuestion",
    "missingEvidence",
    "nextAction",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof p[key] !== "string") {
      throw new Error(`Evidence chamber response missing/invalid string field "${key}".`);
    }
  }

  if (!Array.isArray(p.positions)) {
    throw new Error('Evidence chamber response "positions" must be an array.');
  }
  const positions: EvidenceChamberPosition[] = p.positions.map((raw, index) => {
    const pos = raw as Record<string, unknown>;
    for (const key of ["label", "summary", "method", "scope"] as const) {
      if (typeof pos[key] !== "string") {
        throw new Error(`Evidence chamber position ${index}: missing/invalid string field "${key}".`);
      }
    }
    const stanceConfidence = pos.stanceConfidence;
    if (stanceConfidence !== "high" && stanceConfidence !== "medium" && stanceConfidence !== "low") {
      throw new Error(`Evidence chamber position ${index}: "stanceConfidence" must be high/medium/low.`);
    }
    return {
      label: pos.label as string,
      summary: pos.summary as string,
      method: pos.method as string,
      scope: pos.scope as string,
      stanceConfidence,
    };
  });

  return {
    question: p.question as string,
    sharedGround: p.sharedGround as string,
    pointOfDivergence: p.pointOfDivergence as string,
    possibleReconciliation: p.possibleReconciliation as string,
    unresolvedQuestion: p.unresolvedQuestion as string,
    missingEvidence: p.missingEvidence as string,
    nextAction: p.nextAction as string,
    positions,
  };
}
