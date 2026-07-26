import {
  claimLoci,
  claimScores,
  db,
  researchClaims,
  researchProjectMembers,
  researchProjects,
  works,
} from "@ice/db";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

/**
 * Owner-scoped reads over `research_claim` (Phase 28.1). Ownership is a SQL
 * predicate at every entry point — never inferred from a caller-supplied
 * `userId` alone without also joining back through `research_project`/
 * `work` — matching the `lib/research/*` house rule the plan sets out.
 */

export interface ResearchClaimFilters {
  workId?: string;
  claimNature?: string;
  anchorState?: string;
  verificationStatus?: string;
}

export interface ResearchClaimListRow {
  id: string;
  workId: string | null;
  workTitle: string | null;
  claimText: string;
  claimNature: string;
  confidence: string;
  section: string;
  anchorState: string;
  sourceScope: string;
  verificationStatus: string;
  hidden: boolean;
  createdAt: Date;
  /** Added Phase 28.5 (Writer evidence panel): the literal, re-verified
   *  excerpt this claim was grounded in — the "verifiable-offloading
   *  essential" the Evidence panel shows per entry, and the exact text
   *  `buildEvidenceBlockquote()` inserts. Purely additive to this existing
   *  row shape; the pre-existing `/research/[projectId]/claims` consumer
   *  simply doesn't read the new field. */
  supportingExcerpt: string;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Lists a project's claims — scoped through `research_project_member` so a
 * claim only appears here if its work is actually a member of a project the
 * caller owns, never by trusting a bare `projectId` string. Only `active`
 * claims are listed by default: a `superseded` row is reprocess history, not
 * something the claims table itself needs to surface (plan §Schema
 * `research_object_status` — "never delete, always mark").
 */
export async function listResearchClaims(
  userId: string,
  projectId: string,
  filters: ResearchClaimFilters = {},
  pagination: { page?: number; pageSize?: number } = {},
): Promise<{ claims: ResearchClaimListRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pagination.pageSize ?? DEFAULT_PAGE_SIZE));

  const conditions = [
    eq(researchProjects.id, projectId),
    eq(researchProjects.userId, userId),
    eq(researchClaims.userId, userId),
    eq(researchClaims.status, "active"),
  ];
  if (filters.workId) conditions.push(eq(researchClaims.workId, filters.workId));
  if (filters.claimNature) conditions.push(eq(researchClaims.claimNature, filters.claimNature as (typeof researchClaims.$inferSelect)["claimNature"]));
  if (filters.anchorState) conditions.push(eq(researchClaims.anchorState, filters.anchorState as (typeof researchClaims.$inferSelect)["anchorState"]));
  if (filters.verificationStatus) {
    conditions.push(eq(researchClaims.verificationStatus, filters.verificationStatus as (typeof researchClaims.$inferSelect)["verificationStatus"]));
  }

  const baseQuery = db
    .select({
      id: researchClaims.id,
      workId: researchClaims.workId,
      workTitle: works.title,
      claimText: researchClaims.claimText,
      claimNature: researchClaims.claimNature,
      confidence: researchClaims.confidence,
      section: researchClaims.section,
      anchorState: researchClaims.anchorState,
      sourceScope: researchClaims.sourceScope,
      verificationStatus: researchClaims.verificationStatus,
      hidden: researchClaims.hidden,
      createdAt: researchClaims.createdAt,
      supportingExcerpt: researchClaims.supportingExcerpt,
    })
    .from(researchClaims)
    .innerJoin(researchProjectMembers, eq(researchProjectMembers.workId, researchClaims.workId))
    .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .where(and(...conditions));

  const [rows, [{ value: total }]] = await Promise.all([
    baseQuery
      .orderBy(desc(researchClaims.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: count() })
      .from(researchClaims)
      .innerJoin(researchProjectMembers, eq(researchProjectMembers.workId, researchClaims.workId))
      .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
      .where(and(...conditions)),
  ]);

  return { claims: rows, total, page, pageSize };
}

export interface ResearchClaimDetail extends ResearchClaimListRow {
  supportingExcerpt: string;
  excerptVerified: boolean;
  promptVersion: string;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  textBlockId: string | null;
  scores: { dimension: string; score: number; label: string; tier: string | null; signals: unknown; scorerVersion: string }[];
  loci: { locusKey: string; origin: string; rawLocus: string | null }[];
  /** True only when a real, currently-live text_block anchor exists for
   *  this claim — the gate the plan's "jump-to-reader link ONLY when a real
   *  text_block anchor exists" rule describes. `rebound` claims have this
   *  true (a live block was just re-matched); `unanchored` ones don't. */
  hasReaderAnchor: boolean;
}

/** A claim is directly owner-scoped (`research_claim.user_id`) — no project
 *  join needed to prove ownership, unlike the list above which also has to
 *  prove *project membership*. Returns `null` (never a distinguishable
 *  403) for a claim that doesn't exist or isn't the caller's own. */
export async function getResearchClaimDetail(userId: string, claimId: string): Promise<ResearchClaimDetail | null> {
  const [claim] = await db
    .select({
      id: researchClaims.id,
      workId: researchClaims.workId,
      workTitle: works.title,
      claimText: researchClaims.claimText,
      claimNature: researchClaims.claimNature,
      confidence: researchClaims.confidence,
      section: researchClaims.section,
      anchorState: researchClaims.anchorState,
      sourceScope: researchClaims.sourceScope,
      verificationStatus: researchClaims.verificationStatus,
      hidden: researchClaims.hidden,
      createdAt: researchClaims.createdAt,
      supportingExcerpt: researchClaims.supportingExcerpt,
      excerptVerified: researchClaims.excerptVerified,
      promptVersion: researchClaims.promptVersion,
      quote: researchClaims.quote,
      prefix: researchClaims.prefix,
      suffix: researchClaims.suffix,
      textBlockId: researchClaims.textBlockId,
    })
    .from(researchClaims)
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .where(and(eq(researchClaims.id, claimId), eq(researchClaims.userId, userId)))
    .limit(1);
  if (!claim) return null;

  const [scores, loci] = await Promise.all([
    db
      .select({ dimension: claimScores.dimension, score: claimScores.score, label: claimScores.label, tier: claimScores.tier, signals: claimScores.signals, scorerVersion: claimScores.scorerVersion })
      .from(claimScores)
      .where(eq(claimScores.claimId, claimId)),
    db
      .select({ locusKey: claimLoci.locusKey, origin: claimLoci.origin, rawLocus: claimLoci.rawLocus })
      .from(claimLoci)
      .where(eq(claimLoci.claimId, claimId))
      .orderBy(asc(claimLoci.locusKey)),
  ]);

  return {
    ...claim,
    scores,
    loci,
    hasReaderAnchor: claim.textBlockId != null && claim.anchorState !== "unanchored",
  };
}

/** Distinct claim natures actually present for a project's claims — powers
 *  the filter control's option list so it never offers a value with zero
 *  matching claims. */
export async function listResearchClaimNaturesInUse(userId: string, projectId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ claimNature: researchClaims.claimNature })
    .from(researchClaims)
    .innerJoin(researchProjectMembers, eq(researchProjectMembers.workId, researchClaims.workId))
    .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
    .where(and(eq(researchProjects.id, projectId), eq(researchProjects.userId, userId), eq(researchClaims.userId, userId), eq(researchClaims.status, "active")));
  return rows.map((r) => r.claimNature);
}

/** Used by the DB-cascading id check the claims-permalink page performs to
 *  know which work ids belong to which project (for a "back to project"
 *  link) without re-deriving it from scratch at each call site. */
export async function listProjectIdsForWork(userId: string, workId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: researchProjectMembers.projectId })
    .from(researchProjectMembers)
    .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
    .where(and(eq(researchProjectMembers.workId, workId), eq(researchProjects.userId, userId), inArray(researchProjectMembers.memberType, ["work"])));
  return rows.map((r) => r.projectId);
}
