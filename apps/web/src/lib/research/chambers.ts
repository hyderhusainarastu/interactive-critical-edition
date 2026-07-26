import { claimScores, db, debateClusters, evidenceChamberPositionClaims, evidenceChamberPositions, evidenceChambers, researchClaims, works } from "@ice/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

/**
 * Owner-scoped reads over `evidence_chamber` (Phase 27.1), assembling the
 * Evidence Chamber contract (plan §Web surfaces): additive-only view types;
 * two credibility levels rendered as SEPARATELY labeled groups, never
 * averaged or compared; per-claim scores shown with named signals but never
 * aggregated to a per-position number; positions in ordinal order;
 * provenance mandatory.
 *
 * `EvidenceChamberView` deliberately has NO field whose name matches
 * `/overall|combined|total|winner|rank/i` — the same three-layer no-winner
 * enforcement `@ice/claims`'s `evidenceChamber.ts` describes (schema +
 * validator + structural test) extended one layer further into the read
 * path: a type-level test (`evidenceChamberContract.test.ts`) asserts this
 * by key extraction, so a future field addition that violates it fails CI
 * rather than shipping silently.
 */

/** `regexp_replace(lower(x), '[^a-z0-9]', '', 'g')` — the exact
 *  `NORM`/`NORM_TITLE` precedent from `lib/graph.ts`/`lib/roadmap.ts`
 *  (also mirrored worker-side by `apps/worker/src/research/citationEngagement.ts`'s
 *  `normalizeTitle`), reused here for the position-level "is this work also
 *  a researched, credibility-assessed resource" self-match. */
const NORM = (c: string) => sql.raw(`regexp_replace(lower(${c}), '[^a-z0-9]', '', 'g')`);

const AUTHORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

export interface PositionSourceCredibility {
  workId: string;
  workTitle: string;
  score: number;
  authority: string | null;
  publicationRigor: number | null;
  creatorExpertise: number | null;
  hostProvenance: number | null;
  pedagogicalValue: number | null;
  relevance: number | null;
  evidenceStrength: number | null;
  peerReviewed: boolean | null;
  rationale: string | null;
  creator: unknown;
  popularity: unknown;
}

interface CredibilityJoinRow {
  work_id: string;
  work_title: string;
  score: number | null;
  authority: string | null;
  publication_rigor: number | null;
  creator_expertise: number | null;
  host_provenance: number | null;
  pedagogical_value: number | null;
  relevance: number | null;
  evidence_strength: number | null;
  peer_reviewed: boolean | null;
  rationale: string | null;
  creator: unknown;
  popularity: unknown;
}

/**
 * Position-level SOURCE credibility (plan §Web surfaces "two-level
 * credibility... position-level source credibility from
 * `credibility_assessment` read-only joins"): does the work a position's
 * claims come from ALSO appear as a researched, credibility-assessed
 * `bibliographic_record` (the `work` -> `bibliographic_record` normalized-
 * title match `lib/graph.ts`'s `in_library` check already establishes,
 * followed one hop further to `research_resource.bib_record_id` ->
 * `credibility_assessment`)? Read-only, best-effort, honestly absent
 * (`null`) when no such assessment exists — most owned works never turn up
 * as a researched resource anywhere else in the user's library, and that is
 * NOT an error. When several assessed resources match the same work (rare —
 * e.g. it was independently discovered while researching two different
 * other works), the best one wins: lowest authority letter first (A beats
 * E), highest score as the tiebreak — the exact `enrichByBib` comparison
 * `lib/graph.ts` already uses for the analogous reference-node case.
 */
export async function loadPositionSourceCredibility(userId: string, workIds: string[]): Promise<Map<string, PositionSourceCredibility>> {
  const out = new Map<string, PositionSourceCredibility>();
  if (workIds.length === 0) return out;

  const rows = (await db.execute(sql`
    SELECT w.id AS work_id, w.title AS work_title, ca.score, ca.authority,
      ca.publication_rigor, ca.creator_expertise, ca.host_provenance, ca.pedagogical_value,
      ca.relevance, ca.evidence_strength, ca.peer_reviewed, ca.rationale, ca.creator, ca.popularity
    FROM work w
    JOIN bibliographic_record br ON ${NORM("w.title")} = ${NORM("br.title")}
    JOIN research_resource rr ON rr.bib_record_id = br.id
    JOIN credibility_assessment ca ON ca.resource_id = rr.id
    WHERE w.id IN ${workIds} AND w.user_id = ${userId} AND ca.score IS NOT NULL
  `)) as unknown as CredibilityJoinRow[];

  for (const row of rows) {
    if (row.score == null) continue;
    const existing = out.get(row.work_id);
    const better = !existing || (AUTHORITY_ORDER[row.authority ?? "E"] ?? 4) < (AUTHORITY_ORDER[existing.authority ?? "E"] ?? 4) ||
      ((AUTHORITY_ORDER[row.authority ?? "E"] ?? 4) === (AUTHORITY_ORDER[existing.authority ?? "E"] ?? 4) && row.score > existing.score);
    if (better) {
      out.set(row.work_id, {
        workId: row.work_id,
        workTitle: row.work_title,
        score: row.score,
        authority: row.authority,
        publicationRigor: row.publication_rigor,
        creatorExpertise: row.creator_expertise,
        hostProvenance: row.host_provenance,
        pedagogicalValue: row.pedagogical_value,
        relevance: row.relevance,
        evidenceStrength: row.evidence_strength,
        peerReviewed: row.peer_reviewed,
        rationale: row.rationale,
        creator: row.creator,
        popularity: row.popularity,
      });
    }
  }
  return out;
}

export interface ChamberPositionClaimView {
  id: string;
  ordinal: number;
  claimId: string;
  /** A literal snapshot taken at synthesis time — see `evidence_chamber_position_claim`'s schema doc comment. */
  excerpt: string;
  claimText: string;
  workId: string | null;
  workTitle: string | null;
  /** Claim-level scores (plan: "claim-level scores from `claim_score` with
   *  dimension labels + signals") — the two independent dimensions, NEVER
   *  aggregated into one number and never compared against each other or
   *  against the position's own source-credibility score above. Empty when
   *  the claim has zero `claim_score` rows (honestly "unscored", the
   *  `claim_score` schema's own doc comment — never a fabricated default). */
  scores: { dimension: string; score: number; label: string; tier: string | null; signals: unknown }[];
}

export interface ChamberPositionView {
  id: string;
  ordinal: number;
  label: string;
  summary: string;
  method: string;
  scope: string;
  stanceConfidenceLabel: string;
  stanceConfidence: number;
  claims: ChamberPositionClaimView[];
  /** Position-level SOURCE credibility (see `loadPositionSourceCredibility`
   *  above) — a SEPARATE labeled group from `claims[].scores`, never
   *  averaged or compared with it. Null when no assessment exists for the
   *  claims' owning work(s) (the common, honest case). */
  sourceCredibility: PositionSourceCredibility | null;
}

export interface EvidenceChamberView {
  id: string;
  clusterId: string;
  clusterName: string;
  projectId: string;
  question: string;
  sharedGround: string;
  pointOfDivergence: string;
  possibleReconciliation: string;
  unresolvedQuestion: string;
  missingEvidence: string;
  nextAction: string;
  /** Provenance is mandatory (plan §Web surfaces "provenance mandatory") —
   *  never optional/nullable, since `evidence_chamber` has no deterministic
   *  fallback path (unlike `debate_cluster`'s nullable naming provenance). */
  promptVersion: string;
  provider: string;
  model: string;
  verificationStatus: string;
  /** The Phase 29.2 review workflow's hide/restore state — read here so the
   *  chamber page's `ResearchCorrectionControls` reflects the DB's actual
   *  current value on load rather than always assuming `false`. */
  hidden: boolean;
  createdAt: Date;
  /** Rendered in ordinal order — never re-sorted by any score. */
  positions: ChamberPositionView[];
}

export interface EvidenceChamberSummaryRow {
  id: string;
  clusterId: string;
  clusterName: string;
  question: string;
  verificationStatus: string;
  hidden: boolean;
  createdAt: Date;
}

/** Lightweight, project-scoped chamber summaries — the Phase 28.5 Writer
 *  Evidence panel's list ("...debate clusters, and chambers"), which only
 *  needs enough to link out to `/research/chambers/[chamberId]` and show the
 *  verification status, not the full `EvidenceChamberView` positions/scores
 *  assembly above. `active` status only — the `listDebateClustersForProject`
 *  precedent (superseded chambers are re-synthesis history, not something a
 *  citation-picking panel needs to surface). */
export async function listEvidenceChambersForProject(userId: string, projectId: string): Promise<EvidenceChamberSummaryRow[]> {
  return db
    .select({
      id: evidenceChambers.id,
      clusterId: evidenceChambers.clusterId,
      clusterName: debateClusters.name,
      question: evidenceChambers.question,
      verificationStatus: evidenceChambers.verificationStatus,
      hidden: evidenceChambers.hidden,
      createdAt: evidenceChambers.createdAt,
    })
    .from(evidenceChambers)
    .innerJoin(debateClusters, eq(debateClusters.id, evidenceChambers.clusterId))
    .where(and(eq(evidenceChambers.userId, userId), eq(evidenceChambers.projectId, projectId), eq(evidenceChambers.status, "active")))
    .orderBy(desc(evidenceChambers.createdAt));
}

/** A chamber is directly owner-scoped (`evidence_chamber.user_id`) — no
 *  project/cluster join needed to prove ownership, the `getResearchClaimDetail`
 *  precedent. Returns `null` (never a distinguishable 403) for a chamber
 *  that doesn't exist or isn't the caller's own. */
export async function getEvidenceChamberView(userId: string, chamberId: string): Promise<EvidenceChamberView | null> {
  const [chamberRow] = await db
    .select({
      id: evidenceChambers.id,
      clusterId: evidenceChambers.clusterId,
      projectId: evidenceChambers.projectId,
      question: evidenceChambers.question,
      sharedGround: evidenceChambers.sharedGround,
      pointOfDivergence: evidenceChambers.pointOfDivergence,
      possibleReconciliation: evidenceChambers.possibleReconciliation,
      unresolvedQuestion: evidenceChambers.unresolvedQuestion,
      missingEvidence: evidenceChambers.missingEvidence,
      nextAction: evidenceChambers.nextAction,
      promptVersion: evidenceChambers.promptVersion,
      provider: evidenceChambers.provider,
      model: evidenceChambers.model,
      verificationStatus: evidenceChambers.verificationStatus,
      hidden: evidenceChambers.hidden,
      createdAt: evidenceChambers.createdAt,
      clusterName: sql<string>`(select name from debate_cluster where id = ${evidenceChambers.clusterId})`,
    })
    .from(evidenceChambers)
    .where(and(eq(evidenceChambers.id, chamberId), eq(evidenceChambers.userId, userId)))
    .limit(1);
  if (!chamberRow) return null;

  const positionRows = await db
    .select({
      id: evidenceChamberPositions.id,
      ordinal: evidenceChamberPositions.ordinal,
      label: evidenceChamberPositions.label,
      summary: evidenceChamberPositions.summary,
      method: evidenceChamberPositions.method,
      scope: evidenceChamberPositions.scope,
      stanceConfidenceLabel: evidenceChamberPositions.stanceConfidenceLabel,
      stanceConfidence: evidenceChamberPositions.stanceConfidence,
    })
    .from(evidenceChamberPositions)
    .where(eq(evidenceChamberPositions.chamberId, chamberId))
    .orderBy(asc(evidenceChamberPositions.ordinal));
  if (positionRows.length === 0) {
    return { ...chamberRow, positions: [] };
  }

  const positionIds = positionRows.map((p) => p.id);
  const claimRows = await db
    .select({
      id: evidenceChamberPositionClaims.id,
      positionId: evidenceChamberPositionClaims.positionId,
      ordinal: evidenceChamberPositionClaims.ordinal,
      excerpt: evidenceChamberPositionClaims.excerpt,
      claimId: researchClaims.id,
      claimText: researchClaims.claimText,
      workId: researchClaims.workId,
      workTitle: works.title,
    })
    .from(evidenceChamberPositionClaims)
    .innerJoin(researchClaims, eq(researchClaims.id, evidenceChamberPositionClaims.claimId))
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .where(inArray(evidenceChamberPositionClaims.positionId, positionIds))
    .orderBy(asc(evidenceChamberPositionClaims.ordinal));

  const claimIds = [...new Set(claimRows.map((r) => r.claimId))];
  const scoreRows = claimIds.length
    ? await db
        .select({ claimId: claimScores.claimId, dimension: claimScores.dimension, score: claimScores.score, label: claimScores.label, tier: claimScores.tier, signals: claimScores.signals })
        .from(claimScores)
        .where(inArray(claimScores.claimId, claimIds))
    : [];
  const scoresByClaim = new Map<string, ChamberPositionClaimView["scores"]>();
  for (const row of scoreRows) {
    const existing = scoresByClaim.get(row.claimId) ?? [];
    existing.push({ dimension: row.dimension, score: row.score, label: row.label, tier: row.tier, signals: row.signals });
    scoresByClaim.set(row.claimId, existing);
  }

  const workIds = [...new Set(claimRows.map((r) => r.workId).filter((id): id is string => id != null))];
  const credibilityByWork = await loadPositionSourceCredibility(userId, workIds);

  const claimsByPosition = new Map<string, ChamberPositionClaimView[]>();
  for (const row of claimRows) {
    const existing = claimsByPosition.get(row.positionId) ?? [];
    existing.push({
      id: row.id,
      ordinal: row.ordinal,
      claimId: row.claimId,
      excerpt: row.excerpt,
      claimText: row.claimText,
      workId: row.workId,
      workTitle: row.workTitle,
      scores: scoresByClaim.get(row.claimId) ?? [],
    });
    claimsByPosition.set(row.positionId, existing);
  }

  const positions: ChamberPositionView[] = positionRows.map((p) => {
    const claims = (claimsByPosition.get(p.id) ?? []).sort((a, b) => a.ordinal - b.ordinal);
    // A position's source credibility is the BEST assessed credibility among
    // the work(s) its own grounding claims come from — never averaged across
    // several works, matching `loadPositionSourceCredibility`'s own
    // best-wins comparison, just applied at the position (not claim) level.
    let sourceCredibility: PositionSourceCredibility | null = null;
    for (const claim of claims) {
      if (!claim.workId) continue;
      const candidate = credibilityByWork.get(claim.workId);
      if (!candidate) continue;
      if (!sourceCredibility || (AUTHORITY_ORDER[candidate.authority ?? "E"] ?? 4) < (AUTHORITY_ORDER[sourceCredibility.authority ?? "E"] ?? 4)) {
        sourceCredibility = candidate;
      }
    }
    return { ...p, claims, sourceCredibility };
  });

  return { ...chamberRow, positions };
}
