import {
  db,
  enqueueImportResearchCorpus,
  researchCorpusItems,
  researchJobRequests,
  researchMonitorHits,
  researchMonitors,
} from "@ice/db";
import { isCorpusProvider, normalizeCorpusItem, normalizedKey, searchCorpusCandidates, type CorpusProvider } from "@ice/research";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getOwnedResearchProject } from "./projects";

/**
 * Scheduled research monitoring CRUD + dispatch (Phase 29.1, plan §Pipeline
 * monitoring — in-app only). Every read/write here is owner-scoped, either
 * directly (`research_monitor.user_id`) or via a join through it
 * (`research_monitor_hit` carries no `user_id` of its own — a hit belongs to
 * a monitor, which belongs to a user), matching the rest of this codebase's
 * IDOR posture (`projects.ts`'s own doc comment): a row that exists but
 * isn't the caller's own resolves to `null`/`false`, so the calling route
 * always answers 404, never a distinguishable 403.
 */

export type MonitorType = "topic" | "citation_alert" | "author_follow";
export type MonitorCadence = "daily" | "weekly" | "paused";

export interface MonitorRow {
  id: string;
  userId: string;
  projectId: string | null;
  monitorType: MonitorType;
  query: string;
  cadence: MonitorCadence;
  isActive: boolean;
  lastScannedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Monitor CRUD
// ---------------------------------------------------------------------------

export async function listMonitorsForUser(userId: string, projectId?: string): Promise<MonitorRow[]> {
  const conditions = projectId ? [eq(researchMonitors.userId, userId), eq(researchMonitors.projectId, projectId)] : [eq(researchMonitors.userId, userId)];
  return db
    .select()
    .from(researchMonitors)
    .where(and(...conditions))
    .orderBy(desc(researchMonitors.createdAt)) as Promise<MonitorRow[]>;
}

export async function getOwnedMonitor(userId: string, monitorId: string): Promise<MonitorRow | null> {
  const [row] = await db
    .select()
    .from(researchMonitors)
    .where(and(eq(researchMonitors.id, monitorId), eq(researchMonitors.userId, userId)))
    .limit(1);
  return (row as MonitorRow) ?? null;
}

export type CreateMonitorResult = { action: "not_found" } | { action: "created"; monitor: MonitorRow };

export async function createMonitor(
  userId: string,
  input: { projectId?: string | null; monitorType: MonitorType; query: string; cadence?: MonitorCadence },
): Promise<CreateMonitorResult> {
  if (input.projectId) {
    const owned = await getOwnedResearchProject(userId, input.projectId, true);
    if (!owned) return { action: "not_found" };
  }
  const [created] = await db
    .insert(researchMonitors)
    .values({
      userId,
      projectId: input.projectId ?? null,
      monitorType: input.monitorType,
      query: input.query,
      // Cadence DEFAULTS `paused` at the DB level too (schema default) — a
      // monitor never scans until the user explicitly opts it in.
      cadence: input.cadence ?? "paused",
    })
    .returning();
  return { action: "created", monitor: created as MonitorRow };
}

export async function updateMonitor(
  userId: string,
  monitorId: string,
  patch: { query?: string; cadence?: MonitorCadence; isActive?: boolean },
): Promise<MonitorRow | null> {
  const owned = await getOwnedMonitor(userId, monitorId);
  if (!owned) return null;
  const [updated] = await db
    .update(researchMonitors)
    .set({
      ...(patch.query !== undefined ? { query: patch.query } : {}),
      ...(patch.cadence !== undefined ? { cadence: patch.cadence } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    })
    .where(eq(researchMonitors.id, monitorId))
    .returning();
  return (updated as MonitorRow) ?? null;
}

export async function deleteMonitor(userId: string, monitorId: string): Promise<boolean> {
  const owned = await getOwnedMonitor(userId, monitorId);
  if (!owned) return false;
  const deleted = await db.delete(researchMonitors).where(eq(researchMonitors.id, monitorId)).returning({ id: researchMonitors.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Dispatch — an explicit "scan now" action, routed through the same
// `research_job_request`/`run_monitor` path the daily cron fan-out uses
// (`apps/worker/src/research/runMonitor.ts`). Zero AI cost, so this never
// needs the extract_claims-style confirmation gate.
// ---------------------------------------------------------------------------

export type DispatchScanMonitorResult = { action: "not_found" } | { action: "reused"; requestId: string } | { action: "queued"; requestId: string };

export async function dispatchScanMonitorJob(userId: string, monitorId: string): Promise<DispatchScanMonitorResult> {
  const owned = await getOwnedMonitor(userId, monitorId);
  if (!owned) return { action: "not_found" };

  // Idempotency key deliberately has no date/time component (unlike the
  // cron fan-out's per-day key): an explicit "scan now" click should reuse
  // an already-in-flight scan of the SAME monitor rather than queuing a
  // second one, for as long as one is in flight — but a fresh click after
  // that one completes must be free to queue a new scan, which the
  // in-flight-only partial unique index already guarantees.
  const idempotencyKey = `run_monitor:scan:${monitorId}`;
  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "run_monitor",
      scope: { monitorId },
      idempotencyKey,
      status: "queued",
      estimatedCostUsd: 0,
      requiresConfirmation: false,
      confirmedAt: new Date(),
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
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "not_found" }; // unreachable in practice — mirrors dispatchExtractClaimsJob's own defensive fallback
  }
  await enqueueImportResearchCorpus(created.id);
  return { action: "queued", requestId: created.id };
}

// ---------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------

export interface MonitorHitRow {
  id: string;
  monitorId: string;
  dedupKey: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  provider: string;
  seenAt: Date;
  dismissedAt: Date | null;
  importedCorpusItemId: string | null;
}

export async function listHitsForMonitor(userId: string, monitorId: string, opts: { includeDismissed?: boolean } = {}): Promise<MonitorHitRow[] | null> {
  const owned = await getOwnedMonitor(userId, monitorId);
  if (!owned) return null;
  const conditions = [eq(researchMonitorHits.monitorId, monitorId)];
  if (!opts.includeDismissed) conditions.push(isNull(researchMonitorHits.dismissedAt));
  return db
    .select()
    .from(researchMonitorHits)
    .where(and(...conditions))
    .orderBy(desc(researchMonitorHits.seenAt)) as Promise<MonitorHitRow[]>;
}

export interface MonitorHitWithMonitorRow extends MonitorHitRow {
  monitorQuery: string;
  monitorType: MonitorType;
}

/** Every hit across every monitor a user owns — the global `/research/monitors`
 *  view's feed, or (with `projectId`) the same feed narrowed to one
 *  project's own monitors for `/research/[projectId]/monitors`. Owner-scoped
 *  via an inner join through `research_monitor` (`research_monitor_hit` has
 *  no `user_id`/`project_id` column of its own). */
export async function listHitsForUser(userId: string, opts: { includeDismissed?: boolean; projectId?: string } = {}): Promise<MonitorHitWithMonitorRow[]> {
  const conditions = [eq(researchMonitors.userId, userId)];
  if (!opts.includeDismissed) conditions.push(isNull(researchMonitorHits.dismissedAt));
  if (opts.projectId) conditions.push(eq(researchMonitors.projectId, opts.projectId));
  const rows = await db
    .select({
      id: researchMonitorHits.id,
      monitorId: researchMonitorHits.monitorId,
      dedupKey: researchMonitorHits.dedupKey,
      title: researchMonitorHits.title,
      authors: researchMonitorHits.authors,
      year: researchMonitorHits.year,
      venue: researchMonitorHits.venue,
      url: researchMonitorHits.url,
      provider: researchMonitorHits.provider,
      seenAt: researchMonitorHits.seenAt,
      dismissedAt: researchMonitorHits.dismissedAt,
      importedCorpusItemId: researchMonitorHits.importedCorpusItemId,
      monitorQuery: researchMonitors.query,
      monitorType: researchMonitors.monitorType,
    })
    .from(researchMonitorHits)
    .innerJoin(researchMonitors, eq(researchMonitors.id, researchMonitorHits.monitorId))
    .where(and(...conditions))
    .orderBy(desc(researchMonitorHits.seenAt))
    .limit(200);
  return rows as MonitorHitWithMonitorRow[];
}

export async function dismissMonitorHit(userId: string, hitId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: researchMonitorHits.id })
    .from(researchMonitorHits)
    .innerJoin(researchMonitors, eq(researchMonitors.id, researchMonitorHits.monitorId))
    .where(and(eq(researchMonitorHits.id, hitId), eq(researchMonitors.userId, userId)))
    .limit(1);
  if (!row) return false;
  await db.update(researchMonitorHits).set({ dismissedAt: new Date() }).where(eq(researchMonitorHits.id, hitId));
  return true;
}

// ---------------------------------------------------------------------------
// "Add to corpus" — one click, network-only, zero AI cost.
//
// `research_monitor_hit` deliberately does not retain the provider's raw
// payload or its own external id (only display fields + `dedup_key` — plan
// §Pipeline's exact schema), so the only anti-hallucination-safe way to
// import it is a REAL round-trip that finds the same candidate again: a
// fresh title-scoped search across the corpus providers, matched back to
// this exact hit by its own `dedup_key` (never guessed or synthesized).
// A hit whose provider no longer surfaces it (removed/renamed since the
// scan) honestly reports `unresolvable` rather than fabricating a record —
// the same anti-hallucination discipline `normalizeCorpusItem`'s own doc
// comment states for `import_corpus`.
// ---------------------------------------------------------------------------

export type AddHitToCorpusResult =
  | { action: "not_found" }
  | { action: "already_imported"; corpusItemId: string }
  | { action: "unresolvable"; reason: string }
  | { action: "imported"; corpusItemId: string };

export async function addMonitorHitToCorpus(userId: string, hitId: string): Promise<AddHitToCorpusResult> {
  const [hit] = await db
    .select({
      id: researchMonitorHits.id,
      dedupKey: researchMonitorHits.dedupKey,
      title: researchMonitorHits.title,
      provider: researchMonitorHits.provider,
      importedCorpusItemId: researchMonitorHits.importedCorpusItemId,
      ownerId: researchMonitors.userId,
    })
    .from(researchMonitorHits)
    .innerJoin(researchMonitors, eq(researchMonitors.id, researchMonitorHits.monitorId))
    .where(eq(researchMonitorHits.id, hitId))
    .limit(1);
  if (!hit || hit.ownerId !== userId) return { action: "not_found" };
  if (hit.importedCorpusItemId) return { action: "already_imported", corpusItemId: hit.importedCorpusItemId };
  if (!isCorpusProvider(hit.provider)) {
    return { action: "unresolvable", reason: `"${hit.provider}" is not a supported corpus source.` };
  }
  const provider: CorpusProvider = hit.provider;

  const { candidates } = await searchCorpusCandidates(hit.title, { limit: 5 });
  const match = candidates.find(
    (c) => c.provider === provider && normalizedKey({ doi: c.doi, isbn: c.isbn, url: c.url, title: c.title, authors: c.authors, year: c.year }) === hit.dedupKey,
  );
  if (!match) {
    return { action: "unresolvable", reason: "Could not re-resolve this result from its provider — try importing it from Corpus search instead." };
  }

  const normalized = normalizeCorpusItem(provider, match);
  if (!normalized) return { action: "unresolvable", reason: "The provider's payload lacked a usable title/id." };

  const [insertedItem] = await db
    .insert(researchCorpusItems)
    .values({
      userId,
      source: normalized.source,
      externalId: normalized.externalId,
      dedupKey: normalized.dedupKey,
      title: normalized.title,
      authors: normalized.authors,
      year: normalized.year,
      doi: normalized.doi,
      url: normalized.url,
      abstract: normalized.abstract,
      venue: normalized.venue,
      raw: normalized.raw,
    })
    .onConflictDoNothing({ target: [researchCorpusItems.userId, researchCorpusItems.dedupKey] })
    .returning({ id: researchCorpusItems.id });

  let corpusItemId = insertedItem?.id;
  if (!corpusItemId) {
    const [existing] = await db
      .select({ id: researchCorpusItems.id })
      .from(researchCorpusItems)
      .where(and(eq(researchCorpusItems.userId, userId), eq(researchCorpusItems.dedupKey, normalized.dedupKey)))
      .limit(1);
    corpusItemId = existing?.id;
  }
  if (!corpusItemId) return { action: "unresolvable", reason: "Could not import this result into your corpus." };

  await db.update(researchMonitorHits).set({ importedCorpusItemId: corpusItemId }).where(eq(researchMonitorHits.id, hitId));
  return { action: "imported", corpusItemId };
}
