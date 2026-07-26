import { createHash } from "node:crypto";

export type ResearchJobType = "claim_extraction" | "judge_scan" | "cluster_naming" | "chamber_synthesis" | "hypothesis_generation";

export interface ResearchJobScope {
  /** The work/paper ids this job would operate over — order doesn't matter,
   *  `computeIdempotencyKey` sorts before hashing. */
  workIds: string[];
  /** Optional narrower scope (e.g. a single cluster or claim pair) beyond
   *  `workIds`; undefined means "the whole workIds scope". */
  detail?: string;
}

export interface ResearchJobVersions {
  taxonomyVersion: string; // e.g. TAXONOMY_VERSION_CLAIMS / TAXONOMY_VERSION_RELATIONSHIPS
  promptVersion: string;
}

export interface ExistingResearchRequest {
  id: string;
  jobType: ResearchJobType;
  idempotencyKey: string;
  status: "created" | "active" | "completed" | "failed";
  requestedAt: Date;
}

export type ResearchJobPlan =
  | { action: "reuse"; idempotencyKey: string; reusedRequestId: string }
  | { action: "enqueue"; idempotencyKey: string }
  | { action: "conflict"; idempotencyKey: string; reason: string }
  | { action: "needs_confirmation"; idempotencyKey: string; reason: string };

export interface PlanResearchJobInput {
  jobType: ResearchJobType;
  scope: ResearchJobScope;
  versions: ResearchJobVersions;
  existingRequests: ExistingResearchRequest[];
  /** Estimated unit count this job would touch (candidate pairs, claims to
   *  extract, etc.) — used only to decide auto-enqueue vs. confirm vs. hard
   *  stop, the same three-tier shape Phase 12's cross-library graph
   *  expansion already established (20-candidate/$0.25 automatic cap,
   *  manual confirmation above $1, $5 hard stop). */
  estimatedUnits?: number;
  autoApproveMaxUnits?: number;
  hardStopMaxUnits?: number;
}

function canonicalScopeString(scope: ResearchJobScope): string {
  const workIds = [...scope.workIds].sort();
  return JSON.stringify({ workIds, detail: scope.detail ?? null });
}

/**
 * Deterministic identity for a research job: the same jobType + scope +
 * taxonomy/prompt versions always hashes to the same key, so a resubmitted
 * identical request is recognizable without comparing every field by hand.
 * Versions are part of the key deliberately — a taxonomy or prompt bump
 * must produce a NEW key rather than silently reusing output computed under
 * a no-longer-current definition.
 */
export function computeIdempotencyKey(
  jobType: ResearchJobType,
  scope: ResearchJobScope,
  versions: ResearchJobVersions,
): string {
  const canonical = `${jobType}|${canonicalScopeString(scope)}|${versions.taxonomyVersion}|${versions.promptVersion}`;
  return createHash("sha256").update(canonical).digest("hex");
}

const DEFAULT_AUTO_APPROVE_MAX_UNITS = 20;
const DEFAULT_HARD_STOP_MAX_UNITS = Infinity;

/**
 * Pure decision core for enqueueing a claims-pipeline research job — mirrors
 * `@ice/db`'s `planReprocess` shape (reuse a pending identical request /
 * enqueue / conflict on a genuinely live duplicate; read `packages/db/src/queue.ts`
 * for the pattern this follows, NOT imported — this package has zero
 * workspace dependencies), plus a fourth action `needs_confirmation` for the
 * cost-tiering behavior Phase 12's cross-library graph expansion already
 * established: small jobs auto-enqueue, larger ones need explicit
 * confirmation, and a hard ceiling refuses outright.
 */
export function planResearchJob(input: PlanResearchJobInput): ResearchJobPlan {
  const idempotencyKey = computeIdempotencyKey(input.jobType, input.scope, input.versions);

  // Duplicate-request protection: an identical pending/active request is
  // exactly what a second click would create — reuse it.
  const reusable = input.existingRequests.find(
    (r) => r.idempotencyKey === idempotencyKey && (r.status === "created" || r.status === "active"),
  );
  if (reusable) return { action: "reuse", idempotencyKey, reusedRequestId: reusable.id };

  // A DIFFERENT active job of the same type is a genuine conflict — starting
  // another would duplicate paid work concurrently against the same job type.
  const conflicting = input.existingRequests.find(
    (r) => r.jobType === input.jobType && r.status === "active" && r.idempotencyKey !== idempotencyKey,
  );
  if (conflicting) {
    return {
      action: "conflict",
      idempotencyKey,
      reason: `A different ${input.jobType} job is already running.`,
    };
  }

  const hardStop = input.hardStopMaxUnits ?? DEFAULT_HARD_STOP_MAX_UNITS;
  const autoApprove = input.autoApproveMaxUnits ?? DEFAULT_AUTO_APPROVE_MAX_UNITS;
  const units = input.estimatedUnits ?? 0;

  if (units > hardStop) {
    return {
      action: "conflict",
      idempotencyKey,
      reason: `Estimated ${units} units exceeds the hard stop of ${hardStop}.`,
    };
  }
  if (units > autoApprove) {
    return {
      action: "needs_confirmation",
      idempotencyKey,
      reason: `Estimated ${units} units exceeds the automatic cap of ${autoApprove}; explicit confirmation required.`,
    };
  }

  return { action: "enqueue", idempotencyKey };
}
