import {
  claimLoci,
  claimScores,
  db,
  researchClaims,
  researchCorpusItems,
  researchProjectMembers,
  researchProjects,
  works,
} from "@ice/db";
import { and, asc, count, desc, eq, inArray, or } from "drizzle-orm";

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
  /** Non-null only for a corpus-item-sourced claim (Phase 30 fix lane,
   *  D-25-13) — the exact `workId`/`corpusItemId` XOR the DB enforces on
   *  `research_claim` itself. */
  corpusItemId: string | null;
  corpusItemTitle: string | null;
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
 * claim only appears here if its WORK OR CORPUS ITEM (Phase 30 fix lane,
 * D-25-13 — corpus-item-sourced claims used to have no membership join to
 * match at all, so they never appeared here even after extraction existed)
 * is actually a member of a project the caller owns, never by trusting a
 * bare `projectId` string. Only `active` claims are listed by default: a
 * `superseded` row is reprocess history, not something the claims table
 * itself needs to surface (plan §Schema `research_object_status` — "never
 * delete, always mark").
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

  // Matches a `research_project_member` row for EITHER source kind — a work
  // member matched by `workId` (memberType 'work'), or a corpus-item member
  // matched by `corpusItemId` (memberType 'corpus_item'). Never both at once
  // per row (the `research_claim_exactly_one_source` CHECK), so this OR
  // never double-counts.
  const membershipJoin = or(
    and(eq(researchProjectMembers.workId, researchClaims.workId), eq(researchProjectMembers.memberType, "work")),
    and(eq(researchProjectMembers.corpusItemId, researchClaims.corpusItemId), eq(researchProjectMembers.memberType, "corpus_item")),
  );

  const baseQuery = db
    .select({
      id: researchClaims.id,
      workId: researchClaims.workId,
      workTitle: works.title,
      corpusItemId: researchClaims.corpusItemId,
      corpusItemTitle: researchCorpusItems.title,
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
    .innerJoin(researchProjectMembers, membershipJoin)
    .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .leftJoin(researchCorpusItems, eq(researchCorpusItems.id, researchClaims.corpusItemId))
    .where(and(...conditions));

  const [rows, [{ value: total }]] = await Promise.all([
    baseQuery
      .orderBy(desc(researchClaims.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: count() })
      .from(researchClaims)
      .innerJoin(researchProjectMembers, membershipJoin)
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
      corpusItemId: researchClaims.corpusItemId,
      corpusItemTitle: researchCorpusItems.title,
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
    .leftJoin(researchCorpusItems, eq(researchCorpusItems.id, researchClaims.corpusItemId))
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
    .innerJoin(
      researchProjectMembers,
      or(
        and(eq(researchProjectMembers.workId, researchClaims.workId), eq(researchProjectMembers.memberType, "work")),
        and(eq(researchProjectMembers.corpusItemId, researchClaims.corpusItemId), eq(researchProjectMembers.memberType, "corpus_item")),
      ),
    )
    .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
    .where(and(eq(researchProjects.id, projectId), eq(researchProjects.userId, userId), eq(researchClaims.userId, userId), eq(researchClaims.status, "active")));
  return rows.map((r) => r.claimNature);
}

/**
 * Cross-project recent claims (Knowledge Map rebuild, spec §2.1's "Claim"
 * entry context). `listResearchClaims` above REQUIRES a `projectId` — it is
 * a per-project listing, not the flat, owner-scoped-across-every-project
 * recency list the context chooser's "Claim" tab needs. This is a
 * correction to `docs/design/knowledge-map-spec.md` §2.1's own assumption
 * ("GET /api/research/claims (existing) — reused as-is"): reading that
 * route's actual handler at implementation time (as the spec's own
 * methodology requires) shows it is not reusable for this purpose, so a
 * third genuinely-additive, owner-scoped, no-new-table read is added here —
 * same charter §3 allowance the spec's own §2.3 already uses for
 * `/api/passages/recent`/`/api/research/debates`. `research_claim.user_id`
 * is direct (no project join needed to prove ownership, same as
 * `getResearchClaimDetail` above), so this is a simple owner-scoped scan. */
export interface RecentResearchClaimRow {
  id: string;
  claimText: string;
  claimNature: string;
  workId: string | null;
  workTitle: string | null;
  corpusItemId: string | null;
  corpusItemTitle: string | null;
  updatedAt: Date;
}

export async function listRecentResearchClaims(userId: string, limit = 20): Promise<RecentResearchClaimRow[]> {
  const cappedLimit = Math.min(50, Math.max(1, limit));
  return db
    .select({
      id: researchClaims.id,
      claimText: researchClaims.claimText,
      claimNature: researchClaims.claimNature,
      workId: researchClaims.workId,
      workTitle: works.title,
      corpusItemId: researchClaims.corpusItemId,
      corpusItemTitle: researchCorpusItems.title,
      updatedAt: researchClaims.updatedAt,
    })
    .from(researchClaims)
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .leftJoin(researchCorpusItems, eq(researchCorpusItems.id, researchClaims.corpusItemId))
    .where(and(eq(researchClaims.userId, userId), eq(researchClaims.status, "active")))
    .orderBy(desc(researchClaims.updatedAt))
    .limit(cappedLimit);
}

/** Used by the claims-permalink page to know which project(s) a claim's
 *  owning work belongs to (for the breadcrumb strip's "back to Claims"
 *  crumb, Item 2 of the fix lane — this used to return bare ids only, before
 *  the breadcrumb needed the project's title too) without re-deriving it
 *  from scratch at each call site. */
export async function listProjectsForWork(userId: string, workId: string): Promise<{ projectId: string; projectTitle: string }[]> {
  const rows = await db
    .select({ projectId: researchProjectMembers.projectId, projectTitle: researchProjects.title })
    .from(researchProjectMembers)
    .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
    .where(and(eq(researchProjectMembers.workId, workId), eq(researchProjects.userId, userId), inArray(researchProjectMembers.memberType, ["work"])));
  return rows;
}
