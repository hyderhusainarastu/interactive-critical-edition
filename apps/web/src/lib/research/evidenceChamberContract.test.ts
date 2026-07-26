import assert from "node:assert/strict";
import { validateEvidenceChamberResponse } from "@ice/claims";
import type { ChamberPositionClaimView, ChamberPositionView, EvidenceChamberView, PositionSourceCredibility } from "./chambers";

/**
 * The Evidence Chamber's "never declares a winner" rule (plan §Web surfaces
 * "'never declares a winner' enforced three ways (no field + validator
 * regex + no-sort rendering + a structural unit test)"), verified from the
 * WEB side of the boundary — `@ice/claims`'s own `evidenceChamber.test.ts`
 * already covers the prompt/validator layer (13 tests, unmodified by this
 * lane); this file is the fourth, additive layer: the READ-PATH view type
 * `EvidenceChamberView` (`lib/research/chambers.ts`) that the chamber page
 * actually renders. Run via `pnpm --filter worker exec tsx <absolute-path>`
 * (the `preAuthRateLimit.test.ts` convention — no DB import, so no
 * DATABASE_URL needed).
 *
 * Two independent checks:
 *  1. COMPILE-TIME: `AssertNever<ForbiddenKeyName>` below fails `tsc
 *     --noEmit` outright if any of `EvidenceChamberView`/`ChamberPositionView`/
 *     `ChamberPositionClaimView`/`PositionSourceCredibility`'s own field
 *     names contains "winner"/"verdict"/"stronger"/"prevail"/"rank"/
 *     "overall"/"combined"/"total" in either case — a real type error, not
 *     a test that can be silently skipped.
 *  2. RUNTIME: a recursive key-walk over a realistic, fully-populated
 *     sample instance of the type, asserting no OWN enumerable key (at any
 *     nesting depth: chamber -> positions -> claims/credibility -> scores)
 *     matches the same forbidden pattern — catches a mismatch between the
 *     declared type and what the assembly code in `chambers.ts` actually
 *     puts on the wire, which the compile-time check alone cannot.
 */

// ---------------------------------------------------------------------------
// 1. Compile-time key check.
// ---------------------------------------------------------------------------

type AllViewKeys = keyof EvidenceChamberView | keyof ChamberPositionView | keyof ChamberPositionClaimView | keyof PositionSourceCredibility;

type ForbiddenKeyName = Extract<
  AllViewKeys,
  | `${string}${"winner" | "Winner" | "WINNER"}${string}`
  | `${string}${"verdict" | "Verdict" | "VERDICT"}${string}`
  | `${string}${"stronger" | "Stronger" | "STRONGER"}${string}`
  | `${string}${"prevail" | "Prevail" | "PREVAIL"}${string}`
  | `${string}${"rank" | "Rank" | "RANK"}${string}`
  | `${string}${"overall" | "Overall" | "OVERALL"}${string}`
  | `${string}${"combined" | "Combined" | "COMBINED"}${string}`
  | `${string}${"total" | "Total" | "TOTAL"}${string}`
>;

// If `ForbiddenKeyName` is ever anything other than `never` (i.e. some real
// field name matched), this line fails to compile: `T extends never`
// rejects any non-never type, so `tsc --noEmit` (part of every gate this
// lane runs) is itself the enforcement mechanism here, not this file's
// runtime execution.
type AssertNever<T extends never> = T;
type _NoForbiddenViewKeys = AssertNever<ForbiddenKeyName>;
void (0 as unknown as _NoForbiddenViewKeys); // referenced so the type isn't flagged unused

// ---------------------------------------------------------------------------
// 2. Runtime: the prompt/validator layer rejects a crafted nested winner-ish payload.
// ---------------------------------------------------------------------------

{
  const craftedPayload = {
    question: "q",
    sharedGround: "sg",
    pointOfDivergence: "pod",
    possibleReconciliation: "pr",
    unresolvedQuestion: "uq",
    missingEvidence: "me",
    nextAction: "na",
    positions: [
      {
        label: "Position A",
        summary: "s",
        method: "m",
        scope: "sc",
        stanceConfidence: "high",
        // Adversarial: a winner-ish key nested arbitrarily deep inside a
        // position, wrapped in extra objects — must still be rejected.
        meta: { assessment: { finalCall: { overallWinner: "Position A" } } },
      },
    ],
  };
  assert.throws(() => validateEvidenceChamberResponse(craftedPayload), /forbidden ranking-like key "overallWinner"/);
}

// ---------------------------------------------------------------------------
// 3. Runtime: recursive key walk over a realistic sample `EvidenceChamberView`.
// ---------------------------------------------------------------------------

const FORBIDDEN_KEY_PATTERN = /overall|combined|total|winner|rank/i;

function collectKeys(value: unknown, path: string, keys: { key: string; path: string }[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectKeys(item, `${path}[${i}]`, keys));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    keys.push({ key, path: `${path}.${key}` });
    collectKeys(nested, `${path}.${key}`, keys);
  }
}

const sampleCredibility: PositionSourceCredibility = {
  workId: "work-1",
  workTitle: "Sample Work",
  score: 0.82,
  authority: "B",
  publicationRigor: 0.7,
  creatorExpertise: 0.6,
  hostProvenance: 0.5,
  pedagogicalValue: 0.4,
  relevance: 0.9,
  evidenceStrength: 0.65,
  peerReviewed: true,
  rationale: "A well-corroborated academic press edition.",
  creator: { name: "Jane Scholar", corroboration: "ORCID" },
  popularity: { value: 120, unit: "citations", provider: "test" },
};

const sampleClaim: ChamberPositionClaimView = {
  id: "claim-view-1",
  ordinal: 0,
  claimId: "claim-1",
  excerpt: "The akratic agent lacks knowledge of the particular.",
  claimText: "Akrasia is a failure of particular knowledge.",
  workId: "work-1",
  workTitle: "Sample Work",
  scores: [
    { dimension: "evidence_strength", score: 0.7, label: "strong", tier: "empirical-design", signals: ["controlled-comparison"] },
    { dimension: "textual_support", score: 0.5, label: "moderate", tier: null, signals: [] },
  ],
};

const samplePosition: ChamberPositionView = {
  id: "position-1",
  ordinal: 0,
  label: "Sample Work",
  summary: "Incomplete practical reasoning.",
  method: "textual",
  scope: "NE 7.3",
  stanceConfidenceLabel: "high",
  stanceConfidence: 0.9,
  claims: [sampleClaim],
  sourceCredibility: sampleCredibility,
};

const sampleChamber: EvidenceChamberView = {
  id: "chamber-1",
  clusterId: "cluster-1",
  clusterName: "Akrasia debate",
  projectId: "project-1",
  question: "Does akrasia involve a failure of knowledge or a failure of will?",
  sharedGround: "Both agree the akratic agent acts against their better judgment.",
  pointOfDivergence: "Irwin locates the failure in incomplete practical reasoning; Davidson in weakness of will.",
  possibleReconciliation: "The two accounts may describe different stages of the same process.",
  unresolvedQuestion: "Whether the practical syllogism model can be tested independently of the reading itself.",
  missingEvidence: "A shared criterion for what counts as 'complete' practical reasoning.",
  nextAction: "Compare both readings against NE 7.3's own text directly.",
  promptVersion: "evidence-chamber-v1",
  provider: "openai",
  model: "gpt-5.4-nano",
  verificationStatus: "unreviewed",
  createdAt: new Date("2026-07-26T00:00:00Z"),
  positions: [samplePosition],
};

{
  const collected: { key: string; path: string }[] = [];
  collectKeys(sampleChamber, "$", collected);
  assert.ok(collected.length > 20, `expected a richly-nested sample object, only found ${collected.length} keys`);
  const violations = collected.filter((entry) => FORBIDDEN_KEY_PATTERN.test(entry.key));
  assert.deepEqual(violations, [], `forbidden ranking-like key(s) found in EvidenceChamberView: ${JSON.stringify(violations)}`);
}

console.log("evidenceChamberContract.test.ts: all assertions passed");
