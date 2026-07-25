import {
  aiUsageLogs,
  citationLibraryLinks,
  citations,
  db,
  documents,
  learningResources,
  processingRuns,
  ragConversations,
  ragMessages,
  readingRecords,
  understandingRatings,
  userDeletionArchives,
  users,
  usageEvents,
  resourceRoles,
  workIdentities,
  works,
} from "@ice/db";
import type { WorkDeletionOutcome } from "@ice/deletion";
import { and, count, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { deletionEffects, executeWorkDeletion, retryPendingCleanups } from "./trash";

/**
 * Workstream G (v.5) account deletion. Mirrors `@ice/deletion`'s split
 * exactly one level up: a pure orchestrator (`runAccountDeletion`) driven by
 * an injected `AccountDeletionEffects` interface, unit-testable with fakes
 * and no DB, plus a real DB-backed implementation (`buildAccountDeletionEffects`)
 * that `deleteAccount()` wires together — same shape as `executeWorkDeletion`
 * / `WorkDeletionEffects` / `deletionEffects()` in `trash.ts`, which this
 * module reuses directly for the per-work part of the flow rather than
 * re-implementing Storage/queue/DB deletion a second time.
 *
 * THE KEY TRAP this flow is built around: `deletion_cleanup.user_id`
 * CASCADES from `users` — deleting the user row while any work's cleanup
 * record is not yet `completed` would destroy the only record of which
 * private Storage paths are still pending, silently leaking those bytes
 * forever. The invariant this module enforces: every work deletion must
 * reach `completed` before `deleteUserRow` ever runs; any other outcome
 * aborts the whole flow — the account and session stay intact, and the
 * persisted `deletion_cleanup` rows (never touched here) make a later retry
 * resumable exactly the way `retryPendingCleanups` already handles for
 * plain work-trash purges.
 */

export interface AccountDeletionAggregates {
  /** Documents ever created under this user's works (see the doc comment on
   *  `buildAccountDeletionEffects`'s `computeAggregates` for exactly what
   *  this counts). */
  docsProcessed: number;
  /**
   * Best-effort total AI spend attributable to this account. `ai_usage_log`
   * has no `user_id` column — only `document_id` (nullable, `set null` on
   * delete) and `run_id` — so summing it directly UNDERCOUNTS whenever a
   * log row has already been orphaned by an earlier document deletion. The
   * real effects cross-check against `sum(processing_run.ai_cost_usd)` for
   * the same documents (a running total written by the pipeline itself,
   * immune to that particular undercount) and reports whichever of the two
   * is larger — still an honest best-effort figure, not an authoritative
   * one, which is why the archive column is nullable and this is documented
   * rather than presented as exact.
   */
  totalAiCostUsd: number;
  chatMessages: number;
  lastActiveAt: Date | null;
}

export interface AccountDeletionUser {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  readerLevel: string | null;
  dataSharingEnabled: boolean;
}

export interface OrphanCandidates {
  workIdentityIds: string[];
  learningResourceIds: string[];
}

export interface AccountDeletionEffects {
  getUser(userId: string): Promise<AccountDeletionUser | null>;
  computeAggregates(userId: string): Promise<AccountDeletionAggregates>;
  /** Upsert by userId — idempotent, so a retried deletion never duplicates
   *  the archive row (see `user_deletion_archive`'s unique index). */
  upsertArchive(input: AccountDeletionUser & AccountDeletionAggregates): Promise<void>;
  /** Resumes any of this user's works left mid-deletion by an earlier,
   *  aborted attempt — same opportunistic-retry posture as the plain
   *  work-trash purge flow. */
  retryPendingCleanups(userId: string): Promise<void>;
  /** Every work this user owns, trashed or not — account deletion purges
   *  all of it, not just what's already in trash. */
  listWorks(userId: string): Promise<Array<{ id: string; title: string }>>;
  /** Runs (or resumes) one work's permanent deletion via the same
   *  `executeWorkDeletion` state machine `trash.ts` uses. */
  deleteWork(userId: string, workId: string, workTitle: string): Promise<WorkDeletionOutcome>;
  /** Collected BEFORE any destructive step — see that function's own doc
   *  comment for why order matters here. */
  collectOrphanCandidates(userId: string): Promise<OrphanCandidates>;
  /** Deletes a candidate `work_identity`/`learning_resource` row only when
   *  re-checking finds no remaining reference anywhere (not just from this
   *  user) — see the real implementation's doc comment for the exact
   *  reference check. Returns counts for observability only. */
  sweepOrphans(candidates: OrphanCandidates): Promise<{ workIdentitiesDeleted: number; learningResourcesDeleted: number }>;
  /** Hard-deletes the user row. 22 cascade FKs remove everything else that
   *  isn't handled explicitly above (rate limits, sessions, notes, RAG
   *  conversations, etc.) */
  deleteUserRow(userId: string): Promise<void>;
}

export type AccountDeletionOutcome =
  | { outcome: "completed" }
  | { outcome: "storage_abort"; message: string }
  | { outcome: "not_found" };

/** User-facing copy for the abort case — exact text per the plan, reused by
 *  `accountActions.ts` so the UI and this module never drift. */
export const ACCOUNT_DELETION_STORAGE_ABORT_MESSAGE =
  "Some files could not be removed; nothing else was deleted — try again.";

/**
 * Pure orchestrator — no I/O of its own, every effect injected. Unit-tested
 * with in-memory fakes (see `accountDeletion.test.ts`), same convention as
 * `@ice/deletion`'s `executeWorkDeletion`.
 */
export async function runAccountDeletion(
  effects: AccountDeletionEffects,
  input: { userId: string },
): Promise<AccountDeletionOutcome> {
  const user = await effects.getUser(input.userId);
  if (!user) return { outcome: "not_found" };

  const aggregates = await effects.computeAggregates(input.userId);

  // Durable BEFORE any destructive step — fulfills the privacy page's
  // existing promise that a content-free (plus basic identifiers) record
  // survives deletion, and is safe to re-run: the unique index on userId
  // makes this an idempotent upsert if a prior attempt already wrote it.
  await effects.upsertArchive({ ...user, ...aggregates });

  await effects.retryPendingCleanups(input.userId);

  // Collected before the deletion loop below removes the very rows that
  // make these candidates reachable in the first place.
  const candidates = await effects.collectOrphanCandidates(input.userId);

  const ownedWorks = await effects.listWorks(input.userId);
  let anyIncomplete = false;
  for (const work of ownedWorks) {
    const outcome = await effects.deleteWork(input.userId, work.id, work.title);
    if (outcome.outcome !== "completed") anyIncomplete = true;
  }

  if (anyIncomplete) {
    // Abort retryably: the account and session stay intact, and every
    // work's own `deletion_cleanup` row (persisted by `executeWorkDeletion`
    // itself, not touched here) makes a later retry resume rather than
    // restart. This is the invariant the whole module exists to enforce —
    // the user row must never be deleted while any work deletion could
    // still be incomplete.
    return { outcome: "storage_abort", message: ACCOUNT_DELETION_STORAGE_ABORT_MESSAGE };
  }

  await effects.sweepOrphans(candidates);
  await effects.deleteUserRow(input.userId);

  return { outcome: "completed" };
}

// ---------------------------------------------------------------------------
// Real, DB-backed effects.
// ---------------------------------------------------------------------------

async function getUser(userId: string): Promise<AccountDeletionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      readerLevel: users.readerLevel,
      dataSharingEnabled: users.dataSharingEnabled,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

async function computeAggregates(userId: string): Promise<AccountDeletionAggregates> {
  const [{ docsProcessed }] = await db
    .select({ docsProcessed: count() })
    .from(documents)
    .where(eq(documents.userId, userId));

  // Best-effort: undercounts whenever an ai_usage_log row's document_id was
  // already nulled by an earlier document deletion (see the doc comment on
  // AccountDeletionAggregates.totalAiCostUsd).
  const [{ costFromLogs }] = await db
    .select({ costFromLogs: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .innerJoin(documents, eq(aiUsageLogs.documentId, documents.id))
    .where(eq(documents.userId, userId));

  // Cross-check: processing_run.document_id is never nullable, so summing
  // its running per-run cost total for this user's own documents doesn't
  // suffer the same undercount — it just can't distinguish which stage
  // spent it. Reporting the larger of the two is the honest "at least this
  // much" figure the archive column documents itself as.
  const [{ costFromRuns }] = await db
    .select({ costFromRuns: sql<number>`coalesce(sum(${processingRuns.aiCostUsd}), 0)` })
    .from(processingRuns)
    .innerJoin(documents, eq(processingRuns.documentId, documents.id))
    .where(eq(documents.userId, userId));

  const [{ chatMessages }] = await db
    .select({ chatMessages: count() })
    .from(ragMessages)
    .innerJoin(ragConversations, eq(ragMessages.conversationId, ragConversations.id))
    .where(eq(ragConversations.userId, userId));

  const [{ lastActiveAt }] = await db
    .select({ lastActiveAt: max(usageEvents.createdAt) })
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId));

  return {
    docsProcessed: Number(docsProcessed),
    totalAiCostUsd: Math.max(Number(costFromLogs), Number(costFromRuns)),
    chatMessages: Number(chatMessages),
    lastActiveAt: lastActiveAt ?? null,
  };
}

async function upsertArchive(input: AccountDeletionUser & AccountDeletionAggregates): Promise<void> {
  const values = {
    userId: input.id,
    email: input.email,
    name: input.name,
    userCreatedAt: input.createdAt,
    docsProcessed: input.docsProcessed,
    totalAiCostUsd: input.totalAiCostUsd,
    chatMessages: input.chatMessages,
    lastActiveAt: input.lastActiveAt,
    readerLevel: input.readerLevel,
    dataSharingWasEnabled: input.dataSharingEnabled,
  };
  await db
    .insert(userDeletionArchives)
    .values(values)
    .onConflictDoUpdate({ target: userDeletionArchives.userId, set: values });
}

async function listWorks(userId: string): Promise<Array<{ id: string; title: string }>> {
  return db.select({ id: works.id, title: works.title }).from(works).where(eq(works.userId, userId));
}

/**
 * Candidates are collected BEFORE the per-work deletion loop below removes
 * the rows that make them reachable at all: `works.work_identity_id` (this
 * user's own uploads' canonical identity) and every `learning_resource` this
 * user's own data references — their reading records/understanding ratings,
 * a citation in one of their own documents projected into the Library, OR
 * (the case that's easy to miss) a `resource_role` recommending some
 * catalog resource FOR one of this user's own work identities. That last
 * source matters because deleting an orphaned `work_identity` below
 * CASCADES its `resource_role` rows — so a resource recommended only for
 * this user's now-deleted work loses its one and only reference at the same
 * moment, and would never be reachable to check again afterward if it
 * weren't collected here first. Same technique `e2e/helpers.ts`'s
 * `deleteTestUser` already uses for its own (test-only) sweep.
 */
async function collectOrphanCandidates(userId: string): Promise<OrphanCandidates> {
  const identityRows = await db
    .select({ id: works.workIdentityId })
    .from(works)
    .where(and(eq(works.userId, userId), isNotNull(works.workIdentityId)));
  const workIdentityIds = [...new Set(identityRows.map((r) => r.id).filter((id): id is string => id !== null))];

  const rrRows = await db
    .select({ id: readingRecords.learningResourceId })
    .from(readingRecords)
    .where(and(eq(readingRecords.userId, userId), isNotNull(readingRecords.learningResourceId)));
  const urRows = await db
    .select({ id: understandingRatings.learningResourceId })
    .from(understandingRatings)
    .where(and(eq(understandingRatings.userId, userId), isNotNull(understandingRatings.learningResourceId)));
  const cllRows = await db
    .select({ id: citationLibraryLinks.learningResourceId })
    .from(citationLibraryLinks)
    .innerJoin(citations, eq(citationLibraryLinks.citationId, citations.id))
    .innerJoin(documents, eq(citations.documentId, documents.id))
    .where(eq(documents.userId, userId));
  const roleRows =
    workIdentityIds.length > 0
      ? await db
          .select({ id: resourceRoles.learningResourceId })
          .from(resourceRoles)
          .where(inArray(resourceRoles.workIdentityId, workIdentityIds))
      : [];

  const learningResourceIds = [
    ...new Set(
      [...rrRows, ...urRows, ...cllRows, ...roleRows]
        .map((r) => r.id)
        .filter((id): id is string => id !== null),
    ),
  ];

  return { workIdentityIds, learningResourceIds };
}

/**
 * Deletes a candidate only when NO remaining row anywhere still references
 * it — a global check, not scoped to this user, since both tables are
 * shared, unscoped catalogs (same precedent as `bibliographic_record`).
 * `work_identity` is still referenced if any surviving `work` or
 * `learning_resource` points at it; `learning_resource` is still referenced
 * if any surviving `reading_record`, `understanding_rating`, or
 * `citation_library_link` points at it (checked across ALL users — this is
 * the production condition the plan calls for, deliberately not scoped to a
 * test-key pattern the way the e2e-only sweep in `e2e/helpers.ts` is).
 */
async function sweepOrphans(candidates: OrphanCandidates): Promise<{ workIdentitiesDeleted: number; learningResourcesDeleted: number }> {
  let workIdentitiesDeleted = 0;
  for (const identityId of candidates.workIdentityIds) {
    const [stillOwned] = await db.select({ id: works.id }).from(works).where(eq(works.workIdentityId, identityId)).limit(1);
    if (stillOwned) continue;
    const [stillHeld] = await db.select({ id: learningResources.id }).from(learningResources).where(eq(learningResources.workIdentityId, identityId)).limit(1);
    if (stillHeld) continue;
    // Cascades any resource_role still pointing at this identity.
    await db.delete(workIdentities).where(eq(workIdentities.id, identityId));
    workIdentitiesDeleted += 1;
  }

  let learningResourcesDeleted = 0;
  for (const resourceId of candidates.learningResourceIds) {
    const [rr] = await db.select({ id: readingRecords.id }).from(readingRecords).where(eq(readingRecords.learningResourceId, resourceId)).limit(1);
    if (rr) continue;
    const [ur] = await db.select({ id: understandingRatings.id }).from(understandingRatings).where(eq(understandingRatings.learningResourceId, resourceId)).limit(1);
    if (ur) continue;
    const [cll] = await db.select({ id: citationLibraryLinks.id }).from(citationLibraryLinks).where(eq(citationLibraryLinks.learningResourceId, resourceId)).limit(1);
    if (cll) continue;
    // The identity loop above runs first and already cascaded away any
    // resource_role pointing at THIS user's own now-deleted identities —
    // this check is for a role still pointing at some OTHER (still-alive,
    // possibly another user's) work identity, which must not be swept.
    const [role] = await db.select({ id: resourceRoles.id }).from(resourceRoles).where(eq(resourceRoles.learningResourceId, resourceId)).limit(1);
    if (role) continue;
    await db.delete(learningResources).where(eq(learningResources.id, resourceId));
    learningResourcesDeleted += 1;
  }

  return { workIdentitiesDeleted, learningResourcesDeleted };
}

async function deleteUserRow(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

export function buildAccountDeletionEffects(): AccountDeletionEffects {
  return {
    getUser,
    computeAggregates,
    upsertArchive,
    retryPendingCleanups,
    listWorks,
    async deleteWork(userId, workId, workTitle) {
      return executeWorkDeletion(deletionEffects(userId), { userId, workId, workTitle });
    },
    collectOrphanCandidates,
    sweepOrphans,
    deleteUserRow,
  };
}

/** The real entry point `accountActions.ts` calls after its own auth/rate-limit/password checks pass. */
export async function deleteAccount(userId: string): Promise<AccountDeletionOutcome> {
  return runAccountDeletion(buildAccountDeletionEffects(), { userId });
}
