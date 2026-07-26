import {
  CLUSTER_NAMING_OUTPUT_SCHEMA,
  CLUSTER_NAMING_PROMPT_VERSION,
  buildClusterNamingPrompt,
  deterministicFallbackName,
  findClaimClusters,
  parseClusterDebatesScope,
  validateClusterNamingResponse,
  type ClaimRelationEdge,
} from "@ice/claims";
import { AnthropicTextJsonClient, OpenAIResponsesClient, TASK_ROUTES, safetyIdentifierFor } from "@ice/ai-adapters";
import { canAfford, overSoftCap, type StructuredCaller } from "@ice/research";
import * as repo from "./repository";
import type { JudgeAnthropicCaller } from "./detectRelationships";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * cluster_debates handler (Phase 26.3, plan §Program "26 — Claims engine"):
 * BFS connected components over a project's judged, non-`unrelated`
 * `claim_relationship` edges (`@ice/claims`'s `findClaimClusters`), named
 * via a cheap structured LLM call and persisted as `debate_cluster` rows.
 * Shares the `analyze-claim-debates` queue with `detect_relationships`
 * (`packages/db/src/queue.ts`'s doc comment: "relationship detection AND
 * clustering as one staged, resumable request") as a SEPARATE job type on
 * that same queue, not a second stage within `detectRelationships.ts` —
 * clustering only makes sense once at least one relationship has been
 * judged, so it is triggered as its own explicit request rather than always
 * running immediately after every `detect_relationships` call.
 *
 * Naming is idempotent on `member_hash` (`@ice/claims`'s `memberHash()`):
 * an EXACT repeat of a cluster's prior membership reuses the existing row
 * ($0, no LLM call) rather than re-naming it, which is what makes "a
 * repeat cluster run over an unchanged relationship set costs $0" a real,
 * testable guarantee. A membership CHANGE (an edge added/removed/hidden)
 * produces a different `member_hash`, so the OLD row is marked `stale`
 * (never deleted — a user's verification of that debate survives) and a
 * new row is named for the new membership.
 */

// Small, structured, sampled to 6 claims (buildClusterNamingPrompt's own
// cap) — cheaper than a judge call.
const NAMING_COST_ESTIMATE_USD = 0.005;
const NAMING_MAX_OUTPUT_TOKENS = 300;
const NAMING_SYSTEM_PROMPT =
  "You are naming a scholarly debate cluster from a set of related claims. " +
  "Follow the instructions in the user message exactly and return only the JSON requested.";

export interface ClusterNamingOutcome {
  result: { name: string; researchQuestion: string | null; description: string | null };
  /** Null on the deterministic-fallback path — the `promptVersion: "heuristic"` precedent, applied via nulling every provenance field instead of a sentinel string. */
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
}

/**
 * Names one cluster: preferred openai structured call
 * (`TASK_ROUTES.debate_cluster_naming`), falling back to anthropic's
 * raw-text-JSON mode, falling back to `deterministicFallbackName` when
 * neither provider is configured or both calls fail — a cluster is NEVER
 * left unnamed, matching the annotation-classifier heuristic-fallback
 * precedent (`docs/PROJECT-LOG.md`'s Design Decisions row on the
 * deterministic heuristic classifier).
 */
export async function nameCluster(
  ctx: ResearchJobRunContext,
  openai: StructuredCaller,
  anthropic: JudgeAnthropicCaller,
  claimTexts: string[],
  safetyIdentifier: string,
): Promise<ClusterNamingOutcome> {
  const route = TASK_ROUTES.debate_cluster_naming;
  const prompt = buildClusterNamingPrompt({ claimTexts });

  if (openai.available) {
    try {
      const res = await openai.call({
        model: route.preferred.model,
        schemaName: "debate_cluster_naming",
        schema: CLUSTER_NAMING_OUTPUT_SCHEMA,
        system: NAMING_SYSTEM_PROMPT,
        input: prompt,
        safetyIdentifier,
        maxOutputTokens: NAMING_MAX_OUTPUT_TOKENS,
        validate: validateClusterNamingResponse,
      });
      await ctx.logUsage({
        task: "debate_cluster_naming",
        stage: "naming-cluster",
        provider: "openai",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
      return { result: res.data, promptVersion: CLUSTER_NAMING_PROMPT_VERSION, provider: "openai", model: res.model };
    } catch {
      // Falls through to the anthropic alternate — OpenAIResponsesClient
      // already retried (MAX_RETRIES) with no usable token count on final
      // failure, matching the judge stage's own catch-and-fall-through.
    }
  }

  if (anthropic.available) {
    const res = await anthropic.call({
      model: route.alternate.model,
      system: NAMING_SYSTEM_PROMPT,
      user: prompt,
      maxOutputTokens: NAMING_MAX_OUTPUT_TOKENS,
      validate: validateClusterNamingResponse,
    });
    if (res.promptTokens > 0 || res.completionTokens > 0) {
      await ctx.logUsage({
        task: "debate_cluster_naming",
        stage: "naming-cluster",
        provider: "anthropic",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
    }
    if (res.ok) {
      return { result: res.data, promptVersion: CLUSTER_NAMING_PROMPT_VERSION, provider: "anthropic", model: res.model };
    }
  }

  return {
    result: { name: deterministicFallbackName(claimTexts), researchQuestion: null, description: null },
    promptVersion: null,
    provider: null,
    model: null,
  };
}

export interface ClusterDebatesOutcome extends ResearchJobOutcome {
  edgesInScope: number;
  clustersFound: number;
  /** Newly named via a real LLM call this run (never counts a fallback-named cluster — see `clustersFallbackNamed`). */
  clustersNamed: number;
  /** Exact `member_hash` match already existed — $0, no naming call at all. */
  clustersSkippedNaming: number;
  /** A NEW cluster this run, but named via the $0 deterministic fallback (budget exhausted, or every provider failed) rather than a real LLM call. */
  clustersFallbackNamed: number;
  clustersMarkedStale: number;
  concerns: string[];
}

/**
 * The testable clustering+naming core. `openai`/`anthropic` are DI'd (the
 * `detectRelationshipsForProject` precedent) so a test can inject mocks
 * without a real provider key.
 */
export async function clusterDebatesForProject(
  ctx: ResearchJobRunContext,
  projectId: string,
  openai: StructuredCaller,
  anthropic: JudgeAnthropicCaller,
): Promise<ClusterDebatesOutcome> {
  const concerns: string[] = [];
  const userId = ctx.request.userId;

  await ctx.setStage("loading-project-scope");
  const project = await repo.loadResearchProjectForUser(projectId, userId);
  if (!project) throw new Error(`Research project ${projectId} does not belong to the requesting user, or does not exist.`);

  await ctx.setStage("loading-relationships");
  const edges = await repo.loadJudgedRelationshipsForProject(userId, projectId);
  const clusterEdges: ClaimRelationEdge[] = edges.map((e) => ({
    claimLo: e.claimLoId,
    claimHi: e.claimHiId,
    valence: e.valence as ClaimRelationEdge["valence"],
  }));
  const clusters = findClaimClusters(clusterEdges);

  if (clusters.length === 0) {
    const clustersMarkedStale = await repo.markStaleDebateClusters(userId, projectId, []);
    return {
      coverage: "full",
      note: `${edges.length} judged relationship(s) in scope; no clusters found (either no non-unrelated edges yet, or none connect two or more claims).`,
      edgesInScope: edges.length,
      clustersFound: 0,
      clustersNamed: 0,
      clustersSkippedNaming: 0,
      clustersFallbackNamed: 0,
      clustersMarkedStale,
      concerns,
    };
  }

  await ctx.setStage("loading-existing-clusters");
  const existing = await repo.loadExistingDebateClustersForProject(userId, projectId);
  const existingByHash = new Map(existing.map((c) => [c.memberHash, c]));

  const allMemberIds = [...new Set(clusters.flatMap((c) => c.memberIds))];
  const claimDetails = await repo.loadClaimJudgeDetails(allMemberIds);

  const safetyIdentifier = safetyIdentifierFor(userId);
  const survivingClusterIds: string[] = [];
  let clustersNamed = 0;
  let clustersSkippedNaming = 0;
  let clustersFallbackNamed = 0;
  let budgetExhausted = false;

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const existingCluster = existingByHash.get(cluster.memberHash);
    let clusterId: string;

    if (existingCluster) {
      // Idempotent naming: this EXACT membership was already named
      // (possibly by an earlier, now-stale row reappearing) — reactivate
      // and refresh the display counts, but never re-pay for a name.
      clustersSkippedNaming += 1;
      await repo.reactivateDebateCluster(existingCluster.id, cluster.edgeCount, cluster.counts);
      clusterId = existingCluster.id;
    } else {
      const claimTexts = cluster.memberIds.map((id) => claimDetails.get(id)?.claimText).filter((t): t is string => Boolean(t));

      if (budgetExhausted || overSoftCap(ctx.budget) || !canAfford(ctx.budget, NAMING_COST_ESTIMATE_USD)) {
        // A NEW cluster still gets created and its membership persisted
        // even when the naming budget is gone — the $0 deterministic
        // fallback name is always available, and leaving a real,
        // structurally-detected cluster entirely unwritten just because
        // its NAME would cost money is a worse outcome than a plainly-
        // named cluster the user can rename later.
        if (!budgetExhausted) concerns.push("Cluster-naming cost budget reached — remaining new clusters named deterministically instead of via the LLM.");
        budgetExhausted = true;
        clustersFallbackNamed += 1;
        clusterId = await repo.insertDebateCluster(userId, projectId, {
          memberHash: cluster.memberHash,
          name: deterministicFallbackName(claimTexts),
          researchQuestion: null,
          description: null,
          edgeCount: cluster.edgeCount,
          counts: cluster.counts,
          promptVersion: null,
          provider: null,
          model: null,
        });
      } else {
        await ctx.setStage("naming-cluster", { index: i + 1, total: clusters.length });
        const naming = await nameCluster(ctx, openai, anthropic, claimTexts, safetyIdentifier);
        if (naming.provider) clustersNamed += 1;
        else clustersFallbackNamed += 1;
        clusterId = await repo.insertDebateCluster(userId, projectId, {
          memberHash: cluster.memberHash,
          name: naming.result.name,
          researchQuestion: naming.result.researchQuestion,
          description: naming.result.description,
          edgeCount: cluster.edgeCount,
          counts: cluster.counts,
          promptVersion: naming.promptVersion,
          provider: naming.provider,
          model: naming.model,
        });
      }
    }

    survivingClusterIds.push(clusterId);

    const memberSet = new Set(cluster.memberIds);
    const relationshipIds = edges
      .filter((e) => e.valence !== "unrelated" && memberSet.has(e.claimLoId) && memberSet.has(e.claimHiId))
      .map((e) => e.id);
    await repo.replaceDebateClusterMembership(clusterId, cluster.memberIds, relationshipIds);
  }

  await ctx.setStage("marking-stale-clusters");
  const clustersMarkedStale = await repo.markStaleDebateClusters(userId, projectId, survivingClusterIds);

  const note = [
    `${edges.length} judged relationship(s) in scope, ${clusters.length} cluster(s) found`,
    `naming: ${clustersNamed} via LLM, ${clustersSkippedNaming} skipped (unchanged membership), ${clustersFallbackNamed} deterministic fallback`,
    clustersMarkedStale > 0 ? `${clustersMarkedStale} prior cluster(s) marked stale (membership changed or vanished)` : null,
    ...concerns,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" | ")
    .slice(0, 2000);

  return {
    // 'partial' whenever any NEW cluster this run went out with the $0
    // fallback name instead of a real LLM one — structurally complete, but
    // the naming enrichment this job type also promises isn't fully done.
    coverage: clustersFallbackNamed > 0 ? "partial" : "full",
    note,
    edgesInScope: edges.length,
    clustersFound: clusters.length,
    clustersNamed,
    clustersSkippedNaming,
    clustersFallbackNamed,
    clustersMarkedStale,
    concerns,
  };
}

/** Real-provider wrapper wired into the worker's queue handler. */
export async function clusterDebates(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseClusterDebatesScope(ctx.request.scope);
  if (!scope) throw new Error('cluster_debates scope must be {"projectId": string}.');
  return clusterDebatesForProject(ctx, scope.projectId, new OpenAIResponsesClient(), new AnthropicTextJsonClient());
}
