import {
  HYPOTHESIS_OUTPUT_SCHEMA,
  HYPOTHESIS_PROMPT_VERSION,
  MAX_CONFLICTS_FOR_HYPOTHESIS_CONTEXT,
  MAX_HYPOTHESES_PER_REQUEST,
  NOVELTY_THRESHOLDS,
  TAXONOMY_VERSION_CLAIMS,
  assertThresholdsCalibratedFor,
  buildGapDescription,
  buildHypothesisPrompt,
  computeHypothesisRunHash,
  computeIdempotencyKey,
  noveltyFor,
  validateHypothesisResponse,
  type HypothesisConflictInput,
  type HypothesisResult,
  type ResearchJobScope,
  type ResearchJobVersions,
} from "@ice/claims";
import { AnthropicTextJsonClient, OpenAIResponsesClient, TASK_ROUTES, resolveEmbeddingProvider, safetyIdentifierFor, type EmbeddingProvider } from "@ice/ai-adapters";
import { canAfford, overSoftCap, type StructuredCaller } from "@ice/research";
import * as repo from "./repository";
import type { JudgeAnthropicCaller } from "./detectRelationships";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * generate_hypotheses handler (Phase 27.2, plan §Program "27 — Synthesis"):
 * ports ScholarLens's `[CONFLICT_N]` label-then-validate hypothesis
 * generation (`@ice/claims`'s `prompts/hypothesis.ts`) over a project's
 * detected, UNDISPUTED `claim_relationship` conflicts (contradiction/nuance),
 * plus a $0, deterministic, template-based `research_gap` derivation from
 * `debate_cluster`s that still carry an unresolved contradiction — the two
 * run in the SAME job because they're both synthesis over the same relationship
 * graph, and gap derivation is free regardless of whether hypothesis
 * generation had anything to work with this run.
 *
 * Two DISTINCT idempotency mechanisms are in play, deliberately not
 * conflated:
 *
 *  1. `research_hypothesis.run_hash` (row-level, `@ice/claims`'s
 *     `computeHypothesisRunHash`): THIS hypothesis's own validated,
 *     sorted `sourceConflictIds` + question + prompt version + novelty
 *     model. Protects against literally duplicating one hypothesis — it
 *     canNOT by itself make a full re-run of this job cost $0, because
 *     which conflicts a given hypothesis cites is a MODEL decision, not
 *     knowable before the call.
 *  2. This job's OWN `research_job_request.idempotency_key` (job-level,
 *     `@ice/claims`'s `computeIdempotencyKey`, the same function
 *     `apps/web/src/lib/research/jobs.ts` uses at dispatch time): recomputed
 *     here from the CURRENT project scope + question + maxHypotheses, and
 *     checked against every OTHER completed `generate_hypotheses` request for
 *     this user under that exact key. A match means an identical scope was
 *     already fully processed — the whole run short-circuits BEFORE any LLM
 *     call, which is what makes "repeat run costs $0" a real, testable
 *     guarantee (the canary's own requirement) rather than just a row-level
 *     dedup that still burns tokens on every re-run.
 */

interface GenerateHypothesesScope {
  projectId: string;
  question: string | null;
  maxHypotheses?: number;
}

function parseGenerateHypothesesScope(scope: unknown): GenerateHypothesesScope | null {
  const s = scope as { projectId?: unknown; question?: unknown; maxHypotheses?: unknown } | null;
  if (!s || typeof s.projectId !== "string" || s.projectId.length === 0) return null;
  const question = typeof s.question === "string" && s.question.trim().length > 0 ? s.question.trim() : null;
  const maxHypotheses = typeof s.maxHypotheses === "number" && Number.isFinite(s.maxHypotheses) ? s.maxHypotheses : undefined;
  return { projectId: s.projectId, question, maxHypotheses };
}

/** Same shape both the web dispatcher (`apps/web/src/lib/research/hypotheses.ts`)
 *  and this handler build the idempotency key from — exported so both sides
 *  (and this file's own integration tests) call the ONE real implementation
 *  rather than each re-deriving the same scope shape and risking silent
 *  drift between them. */
export function hypothesisJobScope(workIds: string[], question: string | null, maxHypotheses: number): ResearchJobScope {
  return { workIds: [...workIds].sort(), detail: JSON.stringify({ question, maxHypotheses }) };
}
export const HYPOTHESIS_JOB_VERSIONS: ResearchJobVersions = { taxonomyVersion: TAXONOMY_VERSION_CLAIMS, promptVersion: HYPOTHESIS_PROMPT_VERSION };

// A short generation call (up to 5 hypotheses, each with rationale/
// methodology/challenges) — conservative per-call upper bound, the
// `JUDGE_COST_ESTIMATE_USD`/`NAMING_COST_ESTIMATE_USD` precedent.
const HYPOTHESIS_COST_ESTIMATE_USD = 0.03;
const HYPOTHESIS_MAX_OUTPUT_TOKENS = 2000;
const HYPOTHESIS_SYSTEM_PROMPT =
  "You are a research hypothesis generator comparing claims across scholarly works. " +
  "Follow the instructions in the user message exactly and return only the JSON requested.";

export interface HypothesisGenerationCallResult {
  hypotheses: HypothesisResult[];
  provider: string;
  model: string;
}

/**
 * One hypothesis-generation call: preferred openai structured
 * (`HYPOTHESIS_OUTPUT_SCHEMA`, unwrapping `.hypotheses` the `extractClaims.ts`
 * `.claims`-unwrap precedent), falling back to anthropic's raw-text-JSON mode
 * (which validates a bare top-level array directly — the prompt's own prose
 * asks for one). Returns null (never fabricates) when no provider is
 * configured or every attempted provider failed — the caller's job is to
 * skip hypothesis generation for this run, not invent one.
 */
export async function callHypothesisGeneration(
  ctx: ResearchJobRunContext,
  openai: StructuredCaller,
  anthropic: JudgeAnthropicCaller,
  conflicts: HypothesisConflictInput[],
  question: string | null,
  safetyIdentifier: string,
): Promise<HypothesisGenerationCallResult | null> {
  const route = TASK_ROUTES.hypothesis_generation;
  const { prompt, labelToReal } = buildHypothesisPrompt(conflicts, question);

  if (openai.available) {
    try {
      const res = await openai.call({
        model: route.preferred.model,
        schemaName: "hypothesis_generation",
        schema: HYPOTHESIS_OUTPUT_SCHEMA,
        system: HYPOTHESIS_SYSTEM_PROMPT,
        input: prompt,
        safetyIdentifier,
        maxOutputTokens: HYPOTHESIS_MAX_OUTPUT_TOKENS,
        validate: (parsed) => validateHypothesisResponse((parsed as { hypotheses?: unknown }).hypotheses, labelToReal),
      });
      await ctx.logUsage({
        task: "hypothesis_generation",
        stage: "generating-hypotheses",
        provider: "openai",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
      return { hypotheses: res.data, provider: "openai", model: res.model };
    } catch {
      // Falls through to the anthropic alternate — OpenAIResponsesClient
      // already retried (MAX_RETRIES) internally, matching every other
      // dual-provider stage's catch-and-fall-through in this package.
    }
  }

  if (anthropic.available) {
    const res = await anthropic.call({
      model: route.alternate.model,
      system: HYPOTHESIS_SYSTEM_PROMPT,
      user: prompt,
      maxOutputTokens: HYPOTHESIS_MAX_OUTPUT_TOKENS,
      validate: (parsed) => validateHypothesisResponse(parsed, labelToReal),
    });
    if (res.promptTokens > 0 || res.completionTokens > 0) {
      await ctx.logUsage({
        task: "hypothesis_generation",
        stage: "generating-hypotheses",
        provider: "anthropic",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
    }
    if (res.ok) return { hypotheses: res.data, provider: "anthropic", model: res.model };
  }

  return null;
}

export interface GenerateHypothesesOutcome extends ResearchJobOutcome {
  conflictsInScope: number;
  hypothesesGenerated: number;
  /** A validated hypothesis whose EVERY cited label turned out fabricated —
   *  zero real sources left after validation — is dropped entirely rather
   *  than persisted ungrounded (never a whole-project synthesis with no
   *  traceable source). */
  hypothesesDroppedNoRealSource: number;
  /** Sum of `HypothesisResult.fabricatedLabelCount` across every hypothesis
   *  this run produced (including ones kept, if they cited at least one real
   *  label alongside a fabricated one). */
  fabricatedLabelsDropped: number;
  gapsGenerated: number;
  gapsRefreshed: number;
  concerns: string[];
}

/**
 * The testable synthesis core. `embedder`/`openai`/`anthropic` are DI'd (the
 * `extractClaimsForWork`/`detectRelationshipsForProject` precedent).
 */
export async function generateHypothesesForProject(
  ctx: ResearchJobRunContext,
  projectId: string,
  question: string | null,
  maxHypotheses: number,
  embedder: EmbeddingProvider,
  openai: StructuredCaller,
  anthropic: JudgeAnthropicCaller,
): Promise<GenerateHypothesesOutcome> {
  const concerns: string[] = [];
  const userId = ctx.request.userId;

  await ctx.setStage("loading-project-scope");
  const project = await repo.loadResearchProjectForUser(projectId, userId);
  if (!project) throw new Error(`Research project ${projectId} does not belong to the requesting user, or does not exist.`);

  const workIds = await repo.loadProjectWorkIds(projectId);

  // --- Job-level idempotency short-circuit (see this file's top doc comment). ---
  const scope = hypothesisJobScope(workIds, question, maxHypotheses);
  const idempotencyKey = computeIdempotencyKey("hypothesis_generation", scope, HYPOTHESIS_JOB_VERSIONS);
  if (idempotencyKey === ctx.request.idempotencyKey) {
    const alreadyDone = await repo.hasCompletedResearchJobRequestWithIdempotencyKey(userId, "generate_hypotheses", idempotencyKey, ctx.request.id);
    if (alreadyDone) {
      return {
        coverage: "full",
        note: "An identical scope (same project conflicts, question, and settings) was already fully processed by a prior generate_hypotheses run — reused, no new LLM call.",
        conflictsInScope: 0,
        hypothesesGenerated: 0,
        hypothesesDroppedNoRealSource: 0,
        fabricatedLabelsDropped: 0,
        gapsGenerated: 0,
        gapsRefreshed: 0,
        concerns: [],
      };
    }
  } else {
    // Defensive only — the web dispatcher and this handler build the scope
    // the same way, so this should never actually diverge; recorded rather
    // than silently skipped if it ever does.
    concerns.push("This request's recomputed scope signature did not match its own stored idempotency key — the repeat-run short-circuit was skipped for this run (does not affect correctness of what gets generated).");
  }

  await ctx.setStage("loading-conflicts");
  const conflictRows = await repo.loadUndisputedConflictRelationshipsForProject(userId, projectId);

  let hypothesesGenerated = 0;
  let hypothesesDroppedNoRealSource = 0;
  let fabricatedLabelsDropped = 0;
  let cappedContext = false;
  let cappedOutput = false;
  let budgetStoppedGeneration = false;

  if (conflictRows.length === 0) {
    concerns.push("No undisputed contradiction/nuance conflicts found in this project's scope — hypothesis generation skipped this run.");
  } else {
    const claimIds = [...new Set(conflictRows.flatMap((c) => [c.claimLoId, c.claimHiId]))];
    const claimDetails = await repo.loadClaimJudgeDetails(claimIds);

    const cappedConflicts = conflictRows.slice(0, MAX_CONFLICTS_FOR_HYPOTHESIS_CONTEXT);
    if (conflictRows.length > cappedConflicts.length) {
      cappedContext = true;
      concerns.push(`Conflict context capped at ${MAX_CONFLICTS_FOR_HYPOTHESIS_CONTEXT} of ${conflictRows.length} undisputed conflicts.`);
    }

    const conflictInputs: HypothesisConflictInput[] = [];
    for (const row of cappedConflicts) {
      const loClaim = claimDetails.get(row.claimLoId);
      const hiClaim = claimDetails.get(row.claimHiId);
      if (!loClaim || !hiClaim) continue; // a claim's detail vanished since judging — skip, don't crash
      conflictInputs.push({
        id: row.id,
        relationship: row.valence,
        category: row.category,
        workATitle: loClaim.workTitle,
        claimAText: loClaim.claimText,
        workBTitle: hiClaim.workTitle,
        claimBText: hiClaim.claimText,
        explanation: row.explanation,
        resolution: row.resolution,
      });
    }

    if (conflictInputs.length === 0) {
      concerns.push("Every undisputed conflict's claim detail was missing — nothing to hypothesize about this run.");
    } else if (overSoftCap(ctx.budget) || !canAfford(ctx.budget, HYPOTHESIS_COST_ESTIMATE_USD)) {
      budgetStoppedGeneration = true;
      concerns.push("Hypothesis generation skipped: cost budget reached before the generation call.");
    } else {
      const safetyIdentifier = safetyIdentifierFor(userId);
      await ctx.setStage("generating-hypotheses");
      const generation = await callHypothesisGeneration(ctx, openai, anthropic, conflictInputs, question, safetyIdentifier);

      if (!generation) {
        concerns.push("No hypothesis-generation provider configured (neither ANTHROPIC_API_KEY nor OPENAI_API_KEY), or every attempted provider failed — hypotheses skipped this run.");
      } else {
        const cappedHypotheses = generation.hypotheses.slice(0, maxHypotheses);
        if (generation.hypotheses.length > cappedHypotheses.length) {
          cappedOutput = true;
          concerns.push(`Model returned ${generation.hypotheses.length} hypotheses; capped to the requested ${maxHypotheses}.`);
        }

        const grounded = cappedHypotheses.filter((h) => h.sourceConflictIds.length > 0);
        hypothesesDroppedNoRealSource += cappedHypotheses.length - grounded.length;
        fabricatedLabelsDropped += cappedHypotheses.reduce((sum, h) => sum + h.fabricatedLabelCount, 0);
        if (hypothesesDroppedNoRealSource > 0) {
          concerns.push(`${hypothesesDroppedNoRealSource} hypothesis/hypotheses dropped: every cited conflict label was fabricated (no real source left).`);
        }

        // --- Novelty (computed, never model-asserted) — one batch embed call for every grounded hypothesis's statement. ---
        const noveltyByIndex = new Map<number, { distance: number | null; tier: string }>();
        let noveltyEmbeddingModel: string | null = null;
        let noveltyCorpusDescriptor: string | null = null;

        if (grounded.length > 0 && embedder.available) {
          await ctx.setStage("computing-novelty");
          try {
            assertThresholdsCalibratedFor(embedder.model, NOVELTY_THRESHOLDS);
            const corpusClaims = await repo.loadScopedClaimsForRelationshipDetection(userId, workIds);
            const corpusEmbeddings = await repo.loadClaimEmbeddingsForModel(
              corpusClaims.map((c) => c.id),
              embedder.model,
            );
            const corpusVectors = [...corpusEmbeddings.values()];
            noveltyEmbeddingModel = embedder.model;
            noveltyCorpusDescriptor = `project_claims:${corpusVectors.length}`;

            const texts = grounded.map((h) => h.statement);
            const projectedTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
            const projectedCost = embedder.estimateCostUsd(projectedTokens);
            if (canAfford(ctx.budget, projectedCost)) {
              const embedResult = await embedder.embedBatch(texts);
              await ctx.logUsage({
                task: "hypothesis_novelty_embedding",
                stage: "computing-novelty",
                provider: embedder.id,
                model: embedResult.model,
                promptTokens: embedResult.inputTokens,
                completionTokens: 0,
                costOverride: embedder.estimateCostUsd(embedResult.inputTokens),
              });
              grounded.forEach((_, i) => {
                const vector = embedResult.vectors[i];
                if (!vector) return;
                const result = noveltyFor(vector, corpusVectors, NOVELTY_THRESHOLDS, embedder.model);
                noveltyByIndex.set(i, { distance: result.tier === "unknown" ? null : result.distance, tier: result.tier });
              });
            } else {
              concerns.push("Novelty embedding skipped: projected cost would exceed the hard cap.");
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            concerns.push(`Novelty computation failed; hypotheses were persisted with no novelty score (${message.slice(0, 200)}).`);
          }
        } else if (grounded.length > 0) {
          concerns.push("No embedding provider configured — hypotheses persisted with no novelty score.");
        }

        for (let i = 0; i < grounded.length; i++) {
          const h = grounded[i];
          const novelty = noveltyByIndex.get(i) ?? null;
          const runHash = computeHypothesisRunHash({
            relationshipIds: h.sourceConflictIds,
            question,
            promptVersion: HYPOTHESIS_PROMPT_VERSION,
            noveltyModel: novelty ? noveltyEmbeddingModel : null,
          });

          const hypothesisId = await repo.insertResearchHypothesis(userId, projectId, {
            question,
            statement: h.statement,
            rationale: h.rationale,
            methodology: h.methodology,
            challenges: h.challenges,
            grounding: "detected_conflicts",
            noveltyDistance: novelty?.distance ?? null,
            noveltyTier: (novelty?.tier as "high" | "medium" | "low" | "unknown" | undefined) ?? null,
            noveltyEmbeddingModel: novelty ? noveltyEmbeddingModel : null,
            noveltyCorpus: novelty ? noveltyCorpusDescriptor : null,
            runHash,
            promptVersion: HYPOTHESIS_PROMPT_VERSION,
            provider: generation.provider,
            model: generation.model,
          });
          // Dedup hit (hypothesisId null) — this exact grounding (same
          // conflicts + question + versions) was already persisted by a
          // prior run; source/support/revision rows already exist for it too.
          if (!hypothesisId) continue;

          await repo.insertResearchHypothesisSources(hypothesisId, h.sourceConflictIds);

          const workIdsTouched = new Set<string>();
          for (const relId of h.sourceConflictIds) {
            const row = cappedConflicts.find((c) => c.id === relId);
            if (!row) continue;
            const loClaim = claimDetails.get(row.claimLoId);
            const hiClaim = claimDetails.get(row.claimHiId);
            if (loClaim) workIdsTouched.add(loClaim.workId);
            if (hiClaim) workIdsTouched.add(hiClaim.workId);
          }
          if (workIdsTouched.size > 0) {
            await repo.insertResearchHypothesisSupport(
              hypothesisId,
              [...workIdsTouched].map((wid) => ({ workId: wid, corpusItemId: null })),
            );
          }

          await repo.insertGeneratedHypothesisRevision(userId, hypothesisId, {
            statement: h.statement,
            rationale: h.rationale,
            methodology: h.methodology,
            challenges: h.challenges,
            sourceConflictIds: h.sourceConflictIds,
            novelty,
          });

          hypothesesGenerated += 1;
        }
      }
    }
  }

  // --- Gap derivation (always runs, $0/deterministic — plan §Pipeline). ---
  await ctx.setStage("deriving-gaps");
  const clustersWithContradictions = await repo.loadActiveClustersWithContradictions(userId, projectId);
  let gapsGenerated = 0;
  let gapsRefreshed = 0;
  for (const cluster of clustersWithContradictions) {
    const contradictionCount = cluster.counts.contradiction ?? 0;
    const description = buildGapDescription({ name: cluster.name, researchQuestion: cluster.researchQuestion, contradictionCount });
    const result = await repo.upsertResearchGap(userId, projectId, {
      debateClusterId: cluster.id,
      description,
      unresolvedContradictionCount: contradictionCount,
    });
    if (result.wasNew) {
      gapsGenerated += 1;
      await repo.insertGeneratedGapRevision(userId, result.id, {
        description,
        unresolvedContradictionCount: contradictionCount,
        debateClusterId: cluster.id,
      });
    } else {
      gapsRefreshed += 1;
    }
  }

  const grounding = hypothesesGenerated > 0 ? "detected_conflicts" : "single_work_gaps";
  const note = [
    `${conflictRows.length} undisputed conflict(s) in scope`,
    `hypotheses: ${hypothesesGenerated} generated (grounding=${grounding}), ${hypothesesDroppedNoRealSource} dropped (no real source after label validation), ${fabricatedLabelsDropped} fabricated label(s) dropped`,
    `gaps: ${gapsGenerated} new, ${gapsRefreshed} refreshed (from clusters with unresolved contradictions)`,
    ...concerns,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" | ")
    .slice(0, 2000);

  return {
    coverage: budgetStoppedGeneration || cappedContext || cappedOutput ? "partial" : "full",
    note,
    conflictsInScope: conflictRows.length,
    hypothesesGenerated,
    hypothesesDroppedNoRealSource,
    fabricatedLabelsDropped,
    gapsGenerated,
    gapsRefreshed,
    concerns,
  };
}

/** Real-provider wrapper wired into the worker's queue handler. */
export async function generateHypotheses(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseGenerateHypothesesScope(ctx.request.scope);
  if (!scope) {
    throw new Error('generate_hypotheses scope must be {"projectId": string, "question"?: string, "maxHypotheses"?: number}.');
  }
  const maxHypotheses = Math.max(1, Math.min(MAX_HYPOTHESES_PER_REQUEST, scope.maxHypotheses ?? MAX_HYPOTHESES_PER_REQUEST));
  const embedder = resolveEmbeddingProvider();
  const outcome = await generateHypothesesForProject(
    ctx,
    scope.projectId,
    scope.question,
    maxHypotheses,
    embedder,
    new OpenAIResponsesClient(),
    new AnthropicTextJsonClient(),
  );
  return { coverage: outcome.coverage, note: outcome.note };
}
