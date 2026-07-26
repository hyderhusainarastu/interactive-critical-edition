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
  id: string;
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
  /** Resolved via the prompt's own `labelToClaimId` map (the CONFLICT_N/
   *  `labelToReal` pattern from `hypothesis.ts`'s `buildHypothesisPrompt`/
   *  `validateHypothesisResponse`) — never a title-matching guess. Fabricated
   *  labels (ones that don't resolve) are dropped by `validateEvidenceChamberResponse`
   *  before this array is built; see that function's doc comment. */
  claimIds: string[];
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

export interface BuildEvidenceChamberPromptResult {
  prompt: string;
  /** Short label ("CLAIM_1", ...) → the real claim id it stands in for.
   *  Passed straight through to `validateEvidenceChamberResponse`, exactly
   *  like `buildHypothesisPrompt`'s `labelToReal`. */
  labelToClaimId: Map<string, string>;
}

/**
 * Presents each cluster claim to the model as a short synthetic label
 * (`CLAIM_1`, `CLAIM_2`, ...) rather than asking it to name a position after
 * a work title — the same label-then-validate contract `hypothesis.ts`'s
 * `buildHypothesisPrompt` uses for `[CONFLICT_N]`. A position's `label` is
 * free descriptive prose (a real chamber synthesis often produces something
 * like "Corrupt Rational Endorsement", not a work title — see this file's
 * own git history for the canary that found title-matching an unworkable
 * contract), so grounding a position's claims can never rely on parsing
 * that label; it relies on the model separately citing the `claimLabels` it
 * used, which `validateEvidenceChamberResponse` resolves through the map
 * returned here.
 */
export function buildEvidenceChamberPrompt(input: EvidenceChamberInput): BuildEvidenceChamberPromptResult {
  const claims = input.claims.slice(0, EVIDENCE_CHAMBER_MAX_CLAIMS);
  const labelToClaimId = new Map<string, string>();
  const formatted = claims
    .map((c, i) => {
      const label = `CLAIM_${i + 1}`;
      labelToClaimId.set(label, c.id);
      return `[${label}] ${c.workTitle}: ${c.text}`;
    })
    .join("\n");
  const prompt =
    `The following claims, from a cluster named "${input.clusterName}", relate to a shared question. ` +
    `Each claim has a short label like [CLAIM_1], [CLAIM_2], etc.\n\n` +
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
    '- "positions": a list of {"label": short descriptive name for this position (an interpretive ' +
    'stance, not necessarily a work title — e.g. "Corrupt Rational Endorsement"), ' +
    '"summary": the position in one sentence, "method": how this position was reached ' +
    "(textual/empirical/etc.), \"scope\": what this position claims to cover, " +
    '"stanceConfidence": "high"/"medium"/"low" — how confidently the SOURCE TEXT itself states ' +
    "this position (never your own confidence in who is right), " +
    '"claimLabels": a list of 2 or more claim labels (e.g. ["CLAIM_1", "CLAIM_3"]) from above that ' +
    "support this position — only cite labels that appear above; never invent one}\n\n" +
    "Do NOT include any field named or resembling 'winner', 'verdict', 'stronger', 'prevail', or 'rank' — " +
    "this output is a map of the disagreement, not a ruling on it.\n\n" +
    "No preamble, no markdown fences.";
  return { prompt, labelToClaimId };
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

/** The minimum number of positions a response must retain, after dropping
 *  fabricated labels and zero-claim positions, to be accepted at all — a
 *  chamber comparing a single surviving position isn't a comparison, so a
 *  response that degenerates to fewer than this is treated exactly like a
 *  validation failure (the caller retries, then skips this cluster), never
 *  persisted half-formed. */
export const EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS = 2;

/**
 * Recursively rejects any output containing a key that looks like a
 * ranking/verdict — even nested inside `positions` or any other structure —
 * since a single missed field would silently reintroduce the "the model
 * picked a winner" failure mode this prompt exists to prevent. Throws
 * rather than stripping the offending key, so a violation is always visible
 * rather than silently sanitized away.
 *
 * `labelToClaimId` is `buildEvidenceChamberPrompt`'s own returned map — the
 * `validateHypothesisResponse(parsed, labelToReal)` precedent
 * (`hypothesis.ts`). Grounding a position is now a resolve-and-drop step,
 * not a title-matching guess (see `EvidenceChamberPosition.claimIds`'s doc
 * comment for why the earlier `matchChamberPositionClaims` title-matching
 * contract was replaced): every label in a position's `claimLabels` that
 * doesn't resolve through the map is a fabrication and is dropped (counted,
 * never thrown for on its own); a position left with zero resolved claims
 * after that drop is itself dropped entirely — an ungrounded position is
 * worse than no position. Only once every position has been resolved or
 * dropped does this check whether at least `EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS`
 * survived; if not, the WHOLE response is rejected (thrown), which is what
 * drives the caller's retry-then-skip behavior — this function never
 * returns a chamber with fewer than 2 positions.
 */
export function validateEvidenceChamberResponse(parsed: unknown, labelToClaimId: Map<string, string> = new Map()): EvidenceChamberResult {
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

  let droppedFabricatedLabels = 0;
  let droppedUngroundedPositions = 0;
  const positions: EvidenceChamberPosition[] = [];

  p.positions.forEach((raw, index) => {
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
    if (!Array.isArray(pos.claimLabels)) {
      throw new Error(`Evidence chamber position ${index}: "claimLabels" must be an array.`);
    }

    const claimIds: string[] = [];
    const seen = new Set<string>();
    for (const rawLabel of pos.claimLabels) {
      if (typeof rawLabel !== "string") {
        droppedFabricatedLabels += 1;
        continue;
      }
      const claimId = labelToClaimId.get(rawLabel);
      if (!claimId) {
        droppedFabricatedLabels += 1;
        continue;
      }
      if (seen.has(claimId)) continue; // same claim cited twice under different/same labels — not a fabrication, just a dedup
      seen.add(claimId);
      claimIds.push(claimId);
    }

    if (claimIds.length === 0) {
      droppedUngroundedPositions += 1;
      return; // drop the whole position — never persist an ungrounded one
    }

    positions.push({
      label: pos.label as string,
      summary: pos.summary as string,
      method: pos.method as string,
      scope: pos.scope as string,
      stanceConfidence,
      claimIds,
    });
  });

  if (positions.length < EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS) {
    throw new Error(
      `Evidence chamber response has only ${positions.length} valid position(s) after dropping ${droppedUngroundedPositions} ungrounded ` +
        `position(s) and ${droppedFabricatedLabels} fabricated claim label(s) — needs at least ${EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS} to be a comparison at all.`,
    );
  }

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
          claimLabels: { type: "array", items: { type: "string" } },
        },
        required: ["label", "summary", "method", "scope", "stanceConfidence", "claimLabels"],
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

// `matchChamberPositionClaims`/`ChamberSourceClaim` (title-matching a
// position's `label` back to a claim's `workTitle`) were removed here —
// a real canary found the model's position labels are often granular
// interpretive-stance phrases ("Corrupt Rational Endorsement") that share
// no words with either work's title, so title-matching silently failed on
// real output. Grounding is now the `claimLabels`/`labelToClaimId`
// resolve-and-drop step inside `validateEvidenceChamberResponse` above —
// see `EvidenceChamberPosition.claimIds`'s doc comment.
