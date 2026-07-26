import {
  EVIDENCE_CHAMBER_OUTPUT_SCHEMA,
  EVIDENCE_CHAMBER_PROMPT_VERSION,
  buildEvidenceChamberPrompt,
  computeChamberBasisHash,
  validateEvidenceChamberResponse,
  type EvidenceChamberResult,
} from "@ice/claims";
import { AnthropicTextJsonClient, OpenAIResponsesClient, TASK_ROUTES, safetyIdentifierFor } from "@ice/ai-adapters";
import { EVIDENCE_CHAMBER_STANCE_CONFIDENCE_VALUE } from "@ice/db";
import { canAfford, overSoftCap, type StructuredCaller } from "@ice/research";
import * as repo from "./repository";
import type { JudgeAnthropicCaller } from "./detectRelationships";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * synthesize_chamber handler (Phase 27.1, plan §Program "27 — Synthesis"):
 * one Evidence Chamber synthesis over ONE `debate_cluster`, scope
 * `{clusterId}` (`generate_hypotheses`, the sibling job type on the same
 * `synthesize-research-output` queue, stays a no-op — Phase 27.2's own
 * lane). Explicit-action only (plan §Pipeline: "synthesize-research-output —
 * Evidence Chamber + hypotheses, explicit action only, the most expensive,
 * least automatic stage") — this handler never runs unless a user dispatched
 * it via `dispatchSynthesizeChamberJob` (`apps/web/src/lib/research/jobs.ts`).
 *
 * Cheap-first per `TASK_ROUTES.evidence_chamber_synthesis`: openai structured
 * (`EVIDENCE_CHAMBER_OUTPUT_SCHEMA`) preferred, anthropic raw-text-validated
 * fallback — the `nameCluster`/`callJudge` precedent (`clusterDebates.ts`/
 * `detectRelationships.ts`). UNLIKE cluster naming, there is NO deterministic
 * fallback: a chamber's entire value IS its structured neutral comparison, so
 * when both providers fail (or neither is configured), this cluster is
 * simply skipped this run — never a fabricated placeholder synthesis.
 */

interface SynthesizeChamberScope {
  clusterId: string;
}

function parseSynthesizeChamberScope(scope: unknown): SynthesizeChamberScope | null {
  const s = scope as { clusterId?: unknown } | null;
  if (s && typeof s.clusterId === "string" && s.clusterId.length > 0) return { clusterId: s.clusterId };
  return null;
}

// Conservative per-chamber upper bound (a longer prompt than judge/naming —
// up to `EVIDENCE_CHAMBER_MAX_CLAIMS` claims — plus a much longer structured
// JSON reply, seven prose fields plus N positions) — the
// `JUDGE_COST_ESTIMATE_USD` precedent from `detectRelationships.ts`, scaled
// up for this call's larger expected output.
const CHAMBER_COST_ESTIMATE_USD = 0.03;
// 1500 was measured live (Phase 27.1 canary) to be too tight once a cluster
// reaches even 6 claims/positions — both providers returned genuinely valid,
// well-formed JSON at 1260/1338 completion tokens for exactly that scale, so
// 1500 left no margin and produced truncated/invalid JSON (silent retry
// exhaustion on BOTH providers) once the real pipeline's map-reduce
// extraction yielded double-digit claims. 3000 keeps real headroom above
// that measured baseline even with `EVIDENCE_CHAMBER_MAX_CLAIMS`'s own cap
// bounding the input side too.
const CHAMBER_MAX_OUTPUT_TOKENS = 3000;
const CHAMBER_SYSTEM_PROMPT =
  "You are mapping a scholarly disagreement neutrally, without declaring who is right. " +
  "Follow the instructions in the user message exactly and return only the JSON requested.";

interface ChamberCallSuccess {
  result: EvidenceChamberResult;
  provider: string;
  model: string;
}

/**
 * One synthesis call, preferred-then-alternate per
 * `TASK_ROUTES.evidence_chamber_synthesis`. Returns null (never fabricates)
 * when no provider is configured, or every attempted provider failed — the
 * caller's job is to skip this cluster this run, not invent a comparison.
 * Both `OpenAIResponsesClient.call()` and `AnthropicTextJsonClient.call()`
 * already retry internally on a `validate()` rejection (the no-winner
 * validator, `MAX_RETRIES`) before either surfaces failure here — this
 * function only decides what happens AFTER both providers' own retries are
 * exhausted.
 *
 * `buildEvidenceChamberPrompt` now returns the prompt text alongside a
 * `labelToClaimId` map (the `hypothesis.ts` CONFLICT_N/`labelToReal`
 * pattern) — `validateEvidenceChamberResponse` is bound to that SAME map
 * via a closure for both providers, so a position's `claimLabels` resolve
 * to real claim ids at validation time rather than needing a separate
 * title-matching pass afterward (the earlier, conceptually wrong contract
 * this replaces — see `EvidenceChamberPosition.claimIds`'s doc comment in
 * `@ice/claims`).
 */
export async function callChamberSynthesis(
  ctx: ResearchJobRunContext,
  openai: StructuredCaller,
  anthropic: JudgeAnthropicCaller,
  clusterName: string,
  claims: { id: string; text: string; workTitle: string }[],
  safetyIdentifier: string,
): Promise<ChamberCallSuccess | null> {
  const route = TASK_ROUTES.evidence_chamber_synthesis;
  const { prompt, labelToClaimId } = buildEvidenceChamberPrompt({ clusterName, claims });
  const validate = (parsed: unknown) => validateEvidenceChamberResponse(parsed, labelToClaimId);

  if (openai.available) {
    try {
      const res = await openai.call({
        model: route.preferred.model,
        schemaName: "evidence_chamber_synthesis",
        schema: EVIDENCE_CHAMBER_OUTPUT_SCHEMA,
        system: CHAMBER_SYSTEM_PROMPT,
        input: prompt,
        safetyIdentifier,
        maxOutputTokens: CHAMBER_MAX_OUTPUT_TOKENS,
        validate,
      });
      await ctx.logUsage({
        task: "evidence_chamber_synthesis",
        stage: "synthesizing-chamber",
        provider: "openai",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
      return { result: res.data, provider: "openai", model: res.model };
    } catch {
      // Falls through to the anthropic alternate — OpenAIResponsesClient
      // already retried (MAX_RETRIES) with no usable token count on final
      // failure, matching the judge/naming stages' own catch-and-fall-through.
    }
  }

  if (anthropic.available) {
    const res = await anthropic.call({
      model: route.alternate.model,
      system: CHAMBER_SYSTEM_PROMPT,
      user: prompt,
      maxOutputTokens: CHAMBER_MAX_OUTPUT_TOKENS,
      validate,
    });
    if (res.promptTokens > 0 || res.completionTokens > 0) {
      await ctx.logUsage({
        task: "evidence_chamber_synthesis",
        stage: "synthesizing-chamber",
        provider: "anthropic",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
    }
    if (res.ok) return { result: res.data, provider: "anthropic", model: res.model };
  }

  return null;
}

export interface SynthesizeChamberOutcome extends ResearchJobOutcome {
  claimsInScope: number;
  synthesized: boolean;
  reused: boolean;
  concerns: string[];
}

/**
 * The testable synthesis core. `openai`/`anthropic` are DI'd (the
 * `clusterDebatesForProject`/`detectRelationshipsForProject` precedent) so a
 * test can inject mocks without a real provider key.
 */
export async function synthesizeChamberForCluster(
  ctx: ResearchJobRunContext,
  clusterId: string,
  openai: StructuredCaller,
  anthropic: JudgeAnthropicCaller,
): Promise<SynthesizeChamberOutcome> {
  const concerns: string[] = [];
  const userId = ctx.request.userId;
  const scope = ctx.request.scope as { projectId?: unknown } | null;
  const projectId = typeof scope?.projectId === "string" ? scope.projectId : null;
  if (!projectId) throw new Error('synthesize_chamber scope must include a "projectId" alongside "clusterId".');

  await ctx.setStage("loading-cluster");
  const cluster = await repo.loadDebateClusterForUser(userId, projectId, clusterId);
  if (!cluster) throw new Error(`Debate cluster ${clusterId} does not belong to the requesting user/project, or does not exist.`);

  await ctx.setStage("loading-cluster-claims");
  const claims = await repo.loadClusterMemberClaims(clusterId);
  if (claims.length === 0) {
    return { coverage: "full", note: "Cluster has no active, visible member claims — nothing to synthesize.", claimsInScope: 0, synthesized: false, reused: false, concerns };
  }

  const basisHash = computeChamberBasisHash({
    claims: claims.map((c) => ({ id: c.id, text: c.claimText, excerpt: c.supportingExcerpt })),
    promptVersion: EVIDENCE_CHAMBER_PROMPT_VERSION,
  });

  await ctx.setStage("checking-existing-chamber");
  const existing = await repo.findExistingChamberByBasisHash(userId, clusterId, basisHash);
  if (existing) {
    return {
      coverage: "full",
      note: `Reused an existing chamber (unchanged cluster membership and prompt version) — $0.`,
      claimsInScope: claims.length,
      synthesized: false,
      reused: true,
      concerns,
    };
  }

  if (!openai.available && !anthropic.available) {
    concerns.push("No synthesis provider configured (neither OPENAI_API_KEY nor ANTHROPIC_API_KEY) — chamber left unsynthesized.");
    return { coverage: "partial", note: concerns.join(" | "), claimsInScope: claims.length, synthesized: false, reused: false, concerns };
  }
  if (overSoftCap(ctx.budget) || !canAfford(ctx.budget, CHAMBER_COST_ESTIMATE_USD)) {
    concerns.push("Cost budget reached before synthesis — chamber left unsynthesized this run.");
    return { coverage: "partial", note: concerns.join(" | "), claimsInScope: claims.length, synthesized: false, reused: false, concerns };
  }

  await ctx.setStage("synthesizing-chamber");
  const safetyIdentifier = safetyIdentifierFor(userId);
  const outcome = await callChamberSynthesis(
    ctx,
    openai,
    anthropic,
    cluster.name,
    claims.map((c) => ({ id: c.id, text: c.claimText, workTitle: c.workTitle })),
    safetyIdentifier,
  );
  if (!outcome) {
    concerns.push("Every configured synthesis provider failed — chamber left unsynthesized this run (never fabricated).");
    return { coverage: "partial", note: concerns.join(" | "), claimsInScope: claims.length, synthesized: false, reused: false, concerns };
  }

  // Grounding is now resolved inside `validateEvidenceChamberResponse`
  // itself (the label-then-validate contract, `EvidenceChamberPosition.claimIds`)
  // — every returned position is already guaranteed >=1 real claim id, and
  // the response as a whole is guaranteed >= EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS
  // positions, or `callChamberSynthesis` above would have failed (retried,
  // then returned null) instead of reaching here. No separate title-matching
  // pass is needed — see this file's own doc comment on `callChamberSynthesis`.
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const positions: repo.NewChamberPosition[] = outcome.result.positions.map((position, index) => ({
    ordinal: index,
    label: position.label,
    summary: position.summary,
    method: position.method,
    scope: position.scope,
    stanceConfidenceLabel: position.stanceConfidence,
    stanceConfidence: EVIDENCE_CHAMBER_STANCE_CONFIDENCE_VALUE[position.stanceConfidence],
    claims: position.claimIds.map((claimId) => ({
      claimId,
      // Guaranteed non-null: every id in `claimIds` resolved via the SAME
      // `labelToClaimId` map `buildEvidenceChamberPrompt` built from `claims` above.
      excerpt: claimById.get(claimId)!.supportingExcerpt,
    })),
  }));

  await ctx.setStage("persisting-chamber");
  await repo.insertEvidenceChamber(userId, projectId, {
    clusterId,
    question: outcome.result.question,
    sharedGround: outcome.result.sharedGround,
    pointOfDivergence: outcome.result.pointOfDivergence,
    possibleReconciliation: outcome.result.possibleReconciliation,
    unresolvedQuestion: outcome.result.unresolvedQuestion,
    missingEvidence: outcome.result.missingEvidence,
    nextAction: outcome.result.nextAction,
    basisHash,
    promptVersion: EVIDENCE_CHAMBER_PROMPT_VERSION,
    provider: outcome.provider,
    model: outcome.model,
    positions,
  });

  return {
    coverage: "full",
    note: `Synthesized ${positions.length} position(s) from ${claims.length} claim(s) via ${outcome.provider}/${outcome.model}.`,
    claimsInScope: claims.length,
    synthesized: true,
    reused: false,
    concerns,
  };
}

/** Real-provider wrapper wired into the worker's queue handler. Scope is
 *  `{clusterId, projectId}` — `projectId` is required alongside `clusterId`
 *  (unlike `detect_relationships`/`cluster_debates`, whose scope is JUST
 *  `{projectId}`) because a chamber's ownership check needs to prove the
 *  cluster belongs to a SPECIFIC project the caller owns, not merely "some
 *  project of theirs" — the same reasoning `dispatchSynthesizeChamberJob`
 *  (`apps/web/src/lib/research/jobs.ts`) already has the project id in hand
 *  from the debates-cluster-view route it dispatches from. */
export async function synthesizeChamber(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseSynthesizeChamberScope(ctx.request.scope);
  if (!scope) throw new Error('synthesize_chamber scope must be {"projectId": string, "clusterId": string}.');
  return synthesizeChamberForCluster(ctx, scope.clusterId, new OpenAIResponsesClient(), new AnthropicTextJsonClient());
}
