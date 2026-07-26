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

/** Bumped whenever the prompt text or output schema below changes — stored
 *  on every `evidence_chamber` row as provenance (the
 *  `CLUSTER_NAMING_PROMPT_VERSION`/`JUDGE_PROMPT_VERSION` precedent). Unlike
 *  `debate_cluster`'s naming provenance, this is NEVER null: a chamber has
 *  no deterministic fallback path (see `evidence_chamber`'s schema doc
 *  comment), so a row only ever exists with a real prompt version attached. */
export const EVIDENCE_CHAMBER_PROMPT_VERSION = "evidence-chamber-v1";

export interface EvidenceChamberClaimInput {
  text: string;
  workTitle: string;
}

export interface EvidenceChamberInput {
  clusterName: string;
  claims: EvidenceChamberClaimInput[];
}

/**
 * Hard cap on how many claims are shown to the chamber-synthesis prompt —
 * the `buildClusterNamingPrompt` "sampled to the first 6 claims" precedent
 * (`prompts/clusterNaming.ts`), applied here with a larger budget since the
 * chamber prompt directly quotes and asks about EVERY shown claim (not a
 * throwaway naming sample). A `debate_cluster`'s membership has no upper
 * bound of its own (`cluster_debates` groups by connected component, which
 * can grow arbitrarily as more relationships get judged) — without this cap,
 * a large cluster's synthesis call risks a truncated/invalid JSON response
 * on every attempt (the expected OUTPUT size scales with the INPUT claim
 * count: seven prose fields plus roughly one position per distinct
 * interpretive stance), which is exactly the failure mode measured live in
 * the Phase 27.1 canary before this cap and the worker's
 * `CHAMBER_MAX_OUTPUT_TOKENS` increase were both added.
 */
export const EVIDENCE_CHAMBER_MAX_CLAIMS = 10;

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
  const claims = input.claims.slice(0, EVIDENCE_CHAMBER_MAX_CLAIMS);
  const formatted = claims.map((c, i) => `[Position ${i + 1}] ${c.workTitle}: ${c.text}`).join("\n");
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

/**
 * Structured-output JSON schema for the chamber-synthesis call — OpenAI
 * strict `json_schema` mode (`OpenAIResponsesClient`), the "structured,
 * cheap" rung `evidence_chamber_synthesis` routes to by default
 * (`@ice/ai-adapters`'s `routing.ts`). Mirrors `CLUSTER_NAMING_OUTPUT_SCHEMA`'s
 * conventions exactly: every property listed in `required` (OpenAI's strict
 * mode demands this even though none of these fields are actually
 * optional), `additionalProperties: false` at both the object and the
 * nested `positions` item level so a stray winner-ish key can never even
 * reach `validateEvidenceChamberResponse` — the schema itself is the FIRST
 * of this feature's three no-winner enforcement layers, the validator's
 * `assertNoForbiddenKeys` the second, and the structural unit test
 * (`evidenceChamberContract.test.ts`) the third.
 */
export const EVIDENCE_CHAMBER_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    sharedGround: { type: "string" },
    pointOfDivergence: { type: "string" },
    possibleReconciliation: { type: "string" },
    unresolvedQuestion: { type: "string" },
    missingEvidence: { type: "string" },
    nextAction: { type: "string" },
    positions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          summary: { type: "string" },
          method: { type: "string" },
          scope: { type: "string" },
          stanceConfidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["label", "summary", "method", "scope", "stanceConfidence"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "question",
    "sharedGround",
    "pointOfDivergence",
    "possibleReconciliation",
    "unresolvedQuestion",
    "missingEvidence",
    "nextAction",
    "positions",
  ],
  additionalProperties: false,
} as const;

/** One cluster claim, as `matchChamberPositionClaims` needs to see it — kept
 *  minimal (not the full `research_claim` row) so this stays a pure,
 *  DB-independent function. */
export interface ChamberSourceClaim {
  claimId: string;
  workTitle: string;
}

/** Lowercase, trim, and collapse to alphanumerics+spaces — the
 *  `titleKey`/`normalizeTitle` precedent (`packages/research/src/normalize.ts`,
 *  `apps/worker/src/research/citationEngagement.ts`), reimplemented locally
 *  since this package has zero workspace dependencies. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "");
}

function wordsOf(value: string): Set<string> {
  return new Set(normalizeForMatch(value).split(/\s+/).filter(Boolean));
}

/**
 * Maps each returned position to the claim id(s) that most plausibly
 * support it (plan §Build "positions derived from the cluster's
 * contradiction/nuance structure"). The chamber prompt's own JSON schema
 * (shipped in 25.3, deliberately unchanged here — see this file's own
 * `EVIDENCE_CHAMBER_OUTPUT_SCHEMA` doc comment) asks the model only for a
 * `label`/`summary`/`method`/`scope`/`stanceConfidence` per position, never
 * a claim id — so this is a SEPARATE, deterministic, non-LLM matching step,
 * exploiting the prompt's own instruction that a position's `label` is
 * "short name for this position (e.g. the author/work)":
 *
 *  1. Exact match: `label` normalizes identically to a claim's `workTitle`.
 *  2. Substring match: one normalizes as a substring of the other.
 *  3. Best word-overlap: the claim(s) whose `workTitle` shares the most
 *     whole words with `label`, when that overlap is non-zero.
 *
 * Returns `null` when ANY position matches ZERO claims by every rule above
 * — the caller (`synthesizeChamber.ts`) must treat that exactly like a
 * validation failure (retry, then skip this cluster this run) rather than
 * persisting an ungrounded position; guessing an unrelated claim would
 * misattribute evidence, which is worse than not synthesizing at all (the
 * project's anti-hallucination posture, plan §11/§12 R1, applied to this
 * matching step specifically). The returned arrays are index-aligned with
 * `positions`.
 */
export function matchChamberPositionClaims(
  positions: Pick<EvidenceChamberPosition, "label">[],
  claims: ChamberSourceClaim[],
): string[][] | null {
  const result: string[][] = [];
  for (const position of positions) {
    const label = normalizeForMatch(position.label);
    if (!label) return null;

    const exact = claims.filter((c) => normalizeForMatch(c.workTitle) === label);
    if (exact.length > 0) {
      result.push(exact.map((c) => c.claimId));
      continue;
    }

    const substring = claims.filter((c) => {
      const title = normalizeForMatch(c.workTitle);
      return title.length > 0 && (title.includes(label) || label.includes(title));
    });
    if (substring.length > 0) {
      result.push(substring.map((c) => c.claimId));
      continue;
    }

    const labelWords = wordsOf(position.label);
    let bestScore = 0;
    let bestClaims: string[] = [];
    for (const claim of claims) {
      const overlap = [...labelWords].filter((w) => wordsOf(claim.workTitle).has(w)).length;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestClaims = [claim.claimId];
      } else if (overlap > 0 && overlap === bestScore) {
        bestClaims.push(claim.claimId);
      }
    }
    if (bestScore > 0) {
      result.push(bestClaims);
      continue;
    }

    return null;
  }
  return result;
}
