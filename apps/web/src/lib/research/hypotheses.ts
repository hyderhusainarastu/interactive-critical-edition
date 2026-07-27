import {
  HYPOTHESIS_PROMPT_VERSION,
  MAX_HYPOTHESES_PER_REQUEST,
  TAXONOMY_VERSION_CLAIMS,
  computeConflictWatermark,
  planResearchJob,
  type ExistingResearchRequest,
  type ResearchJobPlan,
} from "@ice/claims";
import {
  claimRelationships,
  db,
  debateClusters,
  enqueueSynthesizeResearch,
  researchGaps,
  researchHypotheses,
  researchHypothesisSources,
  researchHypothesisSupport,
  researchJobRequests,
  researchProjectMembers,
  works,
} from "@ice/db";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { getOwnedResearchProject } from "./projects";

/**
 * The project's current undisputed contradiction/nuance `claim_relationship`
 * ids — the SAME predicate `apps/worker/src/research/repository.ts`'s
 * `loadUndisputedConflictRelationshipsForProject` uses, and the population
 * `computeConflictWatermark` (D-25-15) is keyed over. Kept intentionally
 * narrow (ids only, no other columns) since this only feeds the
 * idempotency-key watermark, not the actual hypothesis-generation prompt
 * (that full read happens in the worker handler, over whatever the
 * conflict set looks like when the job actually runs).
 */
async function loadUndisputedConflictIdsForProject(userId: string, projectId: string): Promise<string[]> {
  const rows = await db
    .select({ id: claimRelationships.id })
    .from(claimRelationships)
    .where(
      and(
        eq(claimRelationships.userId, userId),
        eq(claimRelationships.projectId, projectId),
        eq(claimRelationships.status, "active"),
        eq(claimRelationships.hidden, false),
        ne(claimRelationships.verificationStatus, "disputed"),
        or(eq(claimRelationships.valence, "contradiction"), eq(claimRelationships.valence, "nuance")),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Owner-scoped reads + dispatch for `research_hypothesis`/`research_gap`
 * (Phase 27.2). Ownership is a SQL predicate at every entry point — the
 * `lib/research/claims.ts` house rule, applied here.
 */

export interface ResearchHypothesisListRow {
  id: string;
  question: string | null;
  statement: string;
  rationale: string;
  methodology: string;
  challenges: string[];
  grounding: string;
  noveltyDistance: number | null;
  noveltyTier: string | null;
  noveltyEmbeddingModel: string | null;
  noveltyCorpus: string | null;
  provider: string;
  model: string;
  verificationStatus: string;
  hidden: boolean;
  createdAt: Date;
  /** Cited conflicts, resolved to their real `claim_relationship` rows —
   *  the label-validated provenance the UI links out to. `verificationStatus`/
   *  `hidden` are included so the Phase 29.2 review chips shown alongside
   *  each chip reflect the relationship's actual current state on load. */
  sources: { claimRelationshipId: string; valence: string; category: string; verificationStatus: string; hidden: boolean }[];
  /** Distinct works this hypothesis's cited conflicts touch. */
  supportingWorks: { workId: string; workTitle: string }[];
}

/** Lists a project's active, non-hidden hypotheses with their resolved
 *  source relationships and supporting works — everything the hypothesis
 *  card needs in one call, no client-side waterfall of per-hypothesis
 *  detail fetches. */
export async function listResearchHypotheses(userId: string, projectId: string): Promise<ResearchHypothesisListRow[]> {
  const rows = await db
    .select({
      id: researchHypotheses.id,
      question: researchHypotheses.question,
      statement: researchHypotheses.statement,
      rationale: researchHypotheses.rationale,
      methodology: researchHypotheses.methodology,
      challenges: researchHypotheses.challenges,
      grounding: researchHypotheses.grounding,
      noveltyDistance: researchHypotheses.noveltyDistance,
      noveltyTier: researchHypotheses.noveltyTier,
      noveltyEmbeddingModel: researchHypotheses.noveltyEmbeddingModel,
      noveltyCorpus: researchHypotheses.noveltyCorpus,
      provider: researchHypotheses.provider,
      model: researchHypotheses.model,
      verificationStatus: researchHypotheses.verificationStatus,
      hidden: researchHypotheses.hidden,
      createdAt: researchHypotheses.createdAt,
    })
    .from(researchHypotheses)
    .where(and(eq(researchHypotheses.userId, userId), eq(researchHypotheses.projectId, projectId), eq(researchHypotheses.status, "active"), eq(researchHypotheses.hidden, false)))
    .orderBy(desc(researchHypotheses.createdAt));
  if (rows.length === 0) return [];

  const hypothesisIds = rows.map((r) => r.id);
  const [sourceRows, supportRows] = await Promise.all([
    db
      .select({
        hypothesisId: researchHypothesisSources.hypothesisId,
        claimRelationshipId: researchHypothesisSources.claimRelationshipId,
        valence: claimRelationships.valence,
        category: claimRelationships.category,
        verificationStatus: claimRelationships.verificationStatus,
        hidden: claimRelationships.hidden,
      })
      .from(researchHypothesisSources)
      .innerJoin(claimRelationships, eq(claimRelationships.id, researchHypothesisSources.claimRelationshipId))
      .where(inArray(researchHypothesisSources.hypothesisId, hypothesisIds)),
    db
      .select({ hypothesisId: researchHypothesisSupport.hypothesisId, workId: researchHypothesisSupport.workId, workTitle: works.title })
      .from(researchHypothesisSupport)
      .leftJoin(works, eq(works.id, researchHypothesisSupport.workId))
      .where(inArray(researchHypothesisSupport.hypothesisId, hypothesisIds)),
  ]);

  const sourcesByHypothesis = new Map<string, ResearchHypothesisListRow["sources"]>();
  for (const s of sourceRows) {
    const existing = sourcesByHypothesis.get(s.hypothesisId) ?? [];
    existing.push({ claimRelationshipId: s.claimRelationshipId, valence: s.valence, category: s.category, verificationStatus: s.verificationStatus, hidden: s.hidden });
    sourcesByHypothesis.set(s.hypothesisId, existing);
  }
  const supportByHypothesis = new Map<string, ResearchHypothesisListRow["supportingWorks"]>();
  for (const s of supportRows) {
    if (!s.workId || !s.workTitle) continue;
    const existing = supportByHypothesis.get(s.hypothesisId) ?? [];
    existing.push({ workId: s.workId, workTitle: s.workTitle });
    supportByHypothesis.set(s.hypothesisId, existing);
  }

  return rows.map((r) => ({
    ...r,
    challenges: Array.isArray(r.challenges) ? (r.challenges as string[]) : [],
    sources: sourcesByHypothesis.get(r.id) ?? [],
    supportingWorks: supportByHypothesis.get(r.id) ?? [],
  }));
}

export interface ResearchGapListRow {
  id: string;
  debateClusterId: string;
  debateClusterName: string | null;
  description: string;
  unresolvedContradictionCount: number;
  verificationStatus: string;
  hidden: boolean;
  createdAt: Date;
}

/** Lists a project's active, non-hidden gaps, joined to their source
 *  cluster's current name for display (never the description alone, which
 *  is a frozen snapshot from whenever the gap was last refreshed). */
export async function listResearchGaps(userId: string, projectId: string): Promise<ResearchGapListRow[]> {
  const rows = await db
    .select({
      id: researchGaps.id,
      debateClusterId: researchGaps.debateClusterId,
      debateClusterName: debateClusters.name,
      description: researchGaps.description,
      unresolvedContradictionCount: researchGaps.unresolvedContradictionCount,
      verificationStatus: researchGaps.verificationStatus,
      hidden: researchGaps.hidden,
      createdAt: researchGaps.createdAt,
    })
    .from(researchGaps)
    .leftJoin(debateClusters, eq(debateClusters.id, researchGaps.debateClusterId))
    .where(and(eq(researchGaps.userId, userId), eq(researchGaps.projectId, projectId), eq(researchGaps.status, "active"), eq(researchGaps.hidden, false)))
    .orderBy(desc(researchGaps.createdAt));
  return rows;
}

// ---------------------------------------------------------------------------
// Dispatch (mirrors `lib/research/jobs.ts`'s `dispatchExtractClaimsJob` shape).
// ---------------------------------------------------------------------------

function mapStatusForPlanner(status: string): ExistingResearchRequest["status"] {
  if (status === "planned" || status === "queued") return "created";
  if (status === "running") return "active";
  if (status === "failed") return "failed";
  return "completed";
}

export type DispatchGenerateHypothesesResult =
  | { action: "not_found" }
  | { action: "reused"; requestId: string }
  | { action: "queued"; requestId: string }
  | { action: "conflict"; reason: string }
  | { action: "needs_confirmation"; reason: string };

/**
 * The "Generate hypotheses" action a project overview/hypotheses page
 * offers. `maxHypotheses` is always clamped to `MAX_HYPOTHESES_PER_REQUEST`
 * (<=5) BEFORE it's part of the idempotency-key scope, so a caller-supplied
 * value above the cap can never produce a scope the worker's own clamp would
 * disagree with. Cost is never estimated/shown here (Workstream F
 * precedent) — hypothesis generation is a small, bounded, explicit action,
 * not a large enough spend to warrant its own confirmation-gate UI; the
 * `needs_confirmation` branch is still wired through `planResearchJob` for
 * consistency with every other research job type, even though the small,
 * fixed `maxHypotheses<=5` unit count means it is realistically never hit.
 *
 * The scope's `detail` folds in `computeConflictWatermark` (D-25-15) over
 * this project's CURRENT undisputed contradiction/nuance conflict set —
 * without it, the idempotency key depended only on workIds/question/
 * maxHypotheses, so a project that started at 0 conflicts and later
 * accumulated real ones would recompute the IDENTICAL key forever, and the
 * worker's own job-level short-circuit (`generateHypotheses.ts`) would keep
 * "reusing" a stale zero-conflict completion as if it still reflected
 * reality. The worker recomputes this watermark independently from its own
 * fresh read at run time — this dispatch-time value only has to produce the
 * SAME key the worker will, which it does as long as nothing detects a new
 * conflict in the (normally very short) gap between dispatch and pickup.
 */
export async function dispatchGenerateHypothesesJob(
  userId: string,
  projectId: string,
  question: string | null,
  maxHypothesesInput: number | undefined,
  confirm = false,
): Promise<DispatchGenerateHypothesesResult> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return { action: "not_found" };

  const maxHypotheses = Math.max(1, Math.min(MAX_HYPOTHESES_PER_REQUEST, maxHypothesesInput ?? MAX_HYPOTHESES_PER_REQUEST));
  const normalizedQuestion = question && question.trim().length > 0 ? question.trim() : null;

  const memberWorkIds = (
    await db.select({ workId: researchProjectMembers.workId }).from(researchProjectMembers).where(eq(researchProjectMembers.projectId, projectId))
  )
    .map((r) => r.workId)
    .filter((id): id is string => id !== null)
    .sort();

  const conflictWatermark = computeConflictWatermark(await loadUndisputedConflictIdsForProject(userId, projectId));

  const scope = { workIds: memberWorkIds, detail: JSON.stringify({ question: normalizedQuestion, maxHypotheses, conflictWatermark }) };
  const versions = { taxonomyVersion: TAXONOMY_VERSION_CLAIMS, promptVersion: HYPOTHESIS_PROMPT_VERSION };

  const existingWithKeys = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status, idempotencyKey: researchJobRequests.idempotencyKey, createdAt: researchJobRequests.createdAt })
    .from(researchJobRequests)
    .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.jobType, "generate_hypotheses")));
  const existingRequests: ExistingResearchRequest[] = existingWithKeys.map((r) => ({
    id: r.id,
    jobType: "hypothesis_generation",
    idempotencyKey: r.idempotencyKey,
    status: mapStatusForPlanner(r.status),
    requestedAt: r.createdAt,
  }));

  const jobPlan: ResearchJobPlan = planResearchJob({
    jobType: "hypothesis_generation",
    scope,
    versions,
    existingRequests,
    estimatedUnits: maxHypotheses,
    autoApproveMaxUnits: MAX_HYPOTHESES_PER_REQUEST,
    hardStopMaxUnits: MAX_HYPOTHESES_PER_REQUEST,
  });

  if (jobPlan.action === "reuse") return { action: "reused", requestId: jobPlan.reusedRequestId };
  if (jobPlan.action === "conflict") return { action: "conflict", reason: jobPlan.reason };
  if (jobPlan.action === "needs_confirmation" && !confirm) return { action: "needs_confirmation", reason: jobPlan.reason };

  const requiresConfirmation = jobPlan.action === "needs_confirmation";
  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "generate_hypotheses",
      scope: { projectId, question: normalizedQuestion, maxHypotheses, conflictWatermark },
      idempotencyKey: jobPlan.idempotencyKey,
      status: "queued",
      requiresConfirmation,
      confirmedAt: requiresConfirmation ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
      where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
    })
    .returning({ id: researchJobRequests.id });

  if (!created) {
    const [existing] = await db
      .select({ id: researchJobRequests.id })
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, jobPlan.idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "conflict", reason: "Could not create the hypothesis-generation request; please try again." };
  }

  await enqueueSynthesizeResearch(created.id);
  return { action: "queued", requestId: created.id };
}
