import { db, learningResources, researchCorpusItems, researchMonitorHits, researchMonitors } from "@ice/db";
import { and, eq, ne } from "drizzle-orm";

// ---------------------------------------------------------------------------
// run_monitor (Phase 29.1). Zero AI cost — every write below is either a
// real-provider-payload insert or a read-only lookup, the same discipline
// `import_corpus` writes above apply.
// ---------------------------------------------------------------------------

export interface MonitorRow {
  id: string;
  userId: string;
  projectId: string | null;
  monitorType: string;
  query: string;
  cadence: string;
  isActive: boolean;
  lastScannedAt: Date | null;
}

const monitorColumns = {
  id: researchMonitors.id,
  userId: researchMonitors.userId,
  projectId: researchMonitors.projectId,
  monitorType: researchMonitors.monitorType,
  query: researchMonitors.query,
  cadence: researchMonitors.cadence,
  isActive: researchMonitors.isActive,
  lastScannedAt: researchMonitors.lastScannedAt,
};

/** Owner-scoped single-monitor lookup — the `{monitorId}` scope branch's
 *  ownership guard, matching `userOwnsResearchProject`'s precedent. */
export async function getMonitorForUser(userId: string, monitorId: string): Promise<MonitorRow | null> {
  const [row] = await db
    .select(monitorColumns)
    .from(researchMonitors)
    .where(and(eq(researchMonitors.id, monitorId), eq(researchMonitors.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Every monitor a user owns, active or not — the `{}` "all-due for this
 *  user" scope branch's candidate set. Due-ness itself is decided by
 *  `@ice/research`'s pure `isMonitorDue()` in application code (the
 *  `loadActiveClustersWithContradictions` in-memory-filter precedent — a
 *  single user's monitor count is small). */
export async function listMonitorsForUser(userId: string): Promise<MonitorRow[]> {
  return db.select(monitorColumns).from(researchMonitors).where(eq(researchMonitors.userId, userId));
}

/**
 * EVERY active, non-paused monitor across ALL users — the one deliberately
 * cross-user read in this file, and only ever called from the cron
 * fan-out's own handler (never from a per-request handler, which is always
 * scoped to `ctx.request.userId`). `cadence <> 'paused'` is pushed into SQL
 * since it is a real filter on a small, indexed enum column; whether each
 * remaining row is actually DUE right now is still decided by
 * `isMonitorDue()` in application code, same as the per-user path.
 */
export async function listActiveNonPausedMonitorsAcrossUsers(): Promise<MonitorRow[]> {
  return db
    .select(monitorColumns)
    .from(researchMonitors)
    .where(and(eq(researchMonitors.isActive, true), ne(researchMonitors.cadence, "paused")));
}

export async function markMonitorScanned(monitorId: string, when: Date): Promise<void> {
  await db.update(researchMonitors).set({ lastScannedAt: when }).where(eq(researchMonitors.id, monitorId));
}

/** A user's own imported corpus, by dedup key — one of the two "already
 *  known" checks a fresh hit must clear before it's worth surfacing. */
export async function loadUserCorpusDedupKeys(userId: string): Promise<Set<string>> {
  const rows = await db.select({ dedupKey: researchCorpusItems.dedupKey }).from(researchCorpusItems).where(eq(researchCorpusItems.userId, userId));
  return new Set(rows.map((r) => r.dedupKey));
}

/** The shared `learning_resource` catalog's normalized keys — the Library's
 *  own dedup identity (`packages/db/src/schema.ts`'s `learningResources` doc
 *  comment: "shared across runs and users"), read globally rather than
 *  per-user for the same reason `bibliographic_record` is read globally
 *  elsewhere in this codebase: it is an append-only shared catalog, not
 *  user-owned data. */
export async function loadLibraryNormalizedKeys(): Promise<Set<string>> {
  const rows = await db.select({ normalizedKey: learningResources.normalizedKey }).from(learningResources);
  return new Set(rows.map((r) => r.normalizedKey));
}

export interface NewMonitorHit {
  dedupKey: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  provider: string;
}

/** Idempotent bulk insert on the `(monitor_id, dedup_key)` unique — a hit
 *  already recorded for this monitor (a prior scan already surfaced it, or
 *  the same candidate was returned by two providers in one scan) inserts
 *  nothing new. Returns how many rows were ACTUALLY new. */
export async function insertMonitorHits(monitorId: string, hits: NewMonitorHit[]): Promise<number> {
  if (hits.length === 0) return 0;
  const inserted = await db
    .insert(researchMonitorHits)
    .values(
      hits.map((h) => ({
        monitorId,
        dedupKey: h.dedupKey,
        title: h.title,
        authors: h.authors,
        year: h.year,
        venue: h.venue,
        url: h.url,
        provider: h.provider,
      })),
    )
    .onConflictDoNothing({ target: [researchMonitorHits.monitorId, researchMonitorHits.dedupKey] })
    .returning({ id: researchMonitorHits.id });
  return inserted.length;
}
