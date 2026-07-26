import {
  db,
  enqueueImportResearchCorpus,
  researchJobRequests,
} from "@ice/db";
import {
  formatSemanticScholarPaperId,
  isMonitorDue,
  lookupAuthorRecentPapers,
  lookupCitations,
  normalizedKey,
  searchCorpusCandidates,
  type MonitorCadence,
  type RawResource,
} from "@ice/research";
import { sql } from "drizzle-orm";
import * as repo from "./repository";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * run_monitor handler (Phase 29.1, plan §Pipeline monitoring — "in-app only"
 * delivery per the owner's decision; no email digest surface, unlike the
 * `monitoring_agent.py` reference this transplants topic-scan/citation-alert/
 * author-follow logic from). Replaces `apps/worker/src/index.ts`'s honest
 * no-op for this job type. Zero AI cost by design — every hit is a real
 * provider metadata record, never an LLM inference; nothing here calls
 * `ctx.logUsage()` because nothing here spends against the research budget
 * (the `import_corpus` precedent, `importCorpus.ts`'s own doc comment).
 *
 * Scope shape: `{ monitorId?: string }`.
 *  - `monitorId` set: scan exactly that one monitor NOW, regardless of
 *    whether its cadence says it's due — an explicit "scan now" action
 *    always runs (the `dispatchExtractClaimsJob`-style "explicit action"
 *    precedent), and it must belong to the requesting user.
 *  - `monitorId` absent: scan every DUE monitor this user owns (the "all-due
 *    for this user" branch the cron fan-out's per-user request uses, and
 *    that a "scan my due monitors now" UI action could reuse identically).
 */

export interface RunMonitorScope {
  monitorId?: string;
}

export function parseRunMonitorScope(scope: unknown): RunMonitorScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { monitorId?: unknown };
  if (s.monitorId === undefined) return {};
  if (typeof s.monitorId !== "string" || s.monitorId.length === 0) return null;
  return { monitorId: s.monitorId };
}

const TOPIC_SCAN_LIMIT = 10;
const CITATION_SCAN_LIMIT = 10;
const AUTHOR_SCAN_LIMIT = 10;

/** DI seam for tests — the `importCorpusForScope(lookupById, ...)` precedent. */
export interface RunMonitorDeps {
  searchCorpusCandidates: typeof searchCorpusCandidates;
  lookupCitations: typeof lookupCitations;
  lookupAuthorRecentPapers: typeof lookupAuthorRecentPapers;
}

export const realRunMonitorDeps: RunMonitorDeps = {
  searchCorpusCandidates,
  lookupCitations,
  lookupAuthorRecentPapers,
};

export interface RunMonitorOutcome extends ResearchJobOutcome {
  monitorsScanned: number;
  newHits: number;
}

/**
 * Scans one monitor and inserts any genuinely new hits. Never throws for an
 * expected condition (a disabled/rate-limited/unavailable provider — the
 * adapters' own `runAttempt` contract already turns those into an honest
 * status rather than a throw) or an unrecognized monitor type; an actually
 * unexpected exception is still caught here so ONE broken monitor never
 * aborts the rest of a multi-monitor "all-due" batch (the `import_corpus`
 * per-item try/catch precedent, one level up from per-item to per-monitor).
 */
async function scanOneMonitor(deps: RunMonitorDeps, monitor: repo.MonitorRow, knownDedupKeys: Set<string>): Promise<{ newHits: number; note: string }> {
  try {
    let candidates: RawResource[] = [];
    const attemptNotes: string[] = [];

    if (monitor.monitorType === "topic") {
      const result = await deps.searchCorpusCandidates(monitor.query, { limit: TOPIC_SCAN_LIMIT });
      candidates = result.candidates;
      for (const a of result.attempts) attemptNotes.push(`${a.provider}: ${a.status} (${a.resultCount})`);
    } else if (monitor.monitorType === "citation_alert") {
      const seed = formatSemanticScholarPaperId(monitor.query);
      const result = await deps.lookupCitations(seed, { maxResults: CITATION_SCAN_LIMIT });
      candidates = result.resources;
      attemptNotes.push(`${result.attempt.provider}: ${result.attempt.status} (${result.attempt.resultCount})`);
    } else if (monitor.monitorType === "author_follow") {
      const result = await deps.lookupAuthorRecentPapers(monitor.query, { maxResults: AUTHOR_SCAN_LIMIT });
      candidates = result.resources;
      attemptNotes.push(`${result.attempt.provider}: ${result.attempt.status} (${result.attempt.resultCount})`);
    } else {
      return { newHits: 0, note: `${monitor.monitorType} "${monitor.query}": unrecognized monitor type; skipped` };
    }

    const freshHits: repo.NewMonitorHit[] = [];
    const seenThisScan = new Set<string>();
    for (const c of candidates) {
      const dedupKey = normalizedKey({ doi: c.doi, isbn: c.isbn, url: c.url, title: c.title, authors: c.authors, year: c.year });
      // Can't identify it (no DOI/ISBN/URL/title) — never surfaced as an
      // untraceable hit, matching `normalizeCorpusItem`'s own discipline.
      if (!dedupKey) continue;
      // Already in this user's imported corpus or the shared Library
      // catalog (`loadUserCorpusDedupKeys`/`loadLibraryNormalizedKeys`) —
      // an already-known work never resurfaces as a "new" monitor hit.
      if (knownDedupKeys.has(dedupKey)) continue;
      // Two providers surfacing the same paper in ONE scan (e.g. a topic
      // search hitting both Semantic Scholar and OpenAlex) collapses to one
      // hit here too — the DB unique index would also catch it, but
      // filtering first avoids a redundant insert attempt.
      if (seenThisScan.has(dedupKey)) continue;
      seenThisScan.add(dedupKey);
      freshHits.push({ dedupKey, title: c.title, authors: c.authors, year: c.year, venue: c.venue, url: c.url, provider: c.provider });
    }

    const inserted = freshHits.length > 0 ? await repo.insertMonitorHits(monitor.id, freshHits) : 0;
    const note = `${monitor.monitorType} "${monitor.query}": ${candidates.length} candidate(s), ${inserted} new hit(s) — ${attemptNotes.join(", ")}`;
    return { newHits: inserted, note };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { newHits: 0, note: `${monitor.monitorType} "${monitor.query}": failed — ${message.slice(0, 200)}` };
  }
}

/** The testable core: DI'd provider lookups (the `importCorpusForScope`
 *  precedent), real repository reads/writes. */
export async function runMonitorForScope(deps: RunMonitorDeps, ctx: ResearchJobRunContext, scope: RunMonitorScope): Promise<RunMonitorOutcome> {
  const userId = ctx.request.userId;

  let toScan: repo.MonitorRow[];
  if (scope.monitorId) {
    const monitor = await repo.getMonitorForUser(userId, scope.monitorId);
    if (!monitor) throw new Error(`Monitor ${scope.monitorId} does not belong to the requesting user.`);
    toScan = [monitor]; // explicit "scan now" — runs regardless of cadence due-ness
  } else {
    const now = new Date();
    const owned = await repo.listMonitorsForUser(userId);
    toScan = owned.filter((m) => isMonitorDue({ cadence: m.cadence as MonitorCadence, isActive: m.isActive, lastScannedAt: m.lastScannedAt }, now));
  }

  if (toScan.length === 0) {
    return { coverage: "full", note: "no monitors due", monitorsScanned: 0, newHits: 0 };
  }

  const [corpusKeys, libraryKeys] = await Promise.all([repo.loadUserCorpusDedupKeys(userId), repo.loadLibraryNormalizedKeys()]);
  const knownDedupKeys = new Set<string>([...corpusKeys, ...libraryKeys]);

  const notes: string[] = [];
  let totalNewHits = 0;
  const scannedAt = new Date();
  for (let i = 0; i < toScan.length; i++) {
    const monitor = toScan[i];
    await ctx.setStage("scanning-monitor", { index: i + 1, total: toScan.length });
    const { newHits, note } = await scanOneMonitor(deps, monitor, knownDedupKeys);
    totalNewHits += newHits;
    notes.push(note);
    await repo.markMonitorScanned(monitor.id, scannedAt);
  }

  // Network-only, zero AI cost: every monitor selected to scan was actually
  // attempted (a per-provider failure is recorded honestly in `note`, not
  // hidden behind a downgraded coverage value — the `import_corpus`
  // precedent), so the honest coverage claim is always "full".
  return { coverage: "full", note: notes.join(" | ").slice(0, 2000), monitorsScanned: toScan.length, newHits: totalNewHits };
}

/** Real-provider wrapper wired into the worker's queue handler. */
export async function runMonitor(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseRunMonitorScope(ctx.request.scope);
  if (!scope) throw new Error('run_monitor scope must be {"monitorId"?: string}.');
  const outcome = await runMonitorForScope(realRunMonitorDeps, ctx, scope);
  return { coverage: outcome.coverage, note: outcome.note };
}

// ---------------------------------------------------------------------------
// Cron fan-out (the daily `boss.schedule()` tick's own job body).
// ---------------------------------------------------------------------------

/**
 * pg-boss's `schedule()` stores one FIXED payload per queue name and resends
 * it verbatim on every cron tick — there is no way to compute a fresh
 * `requestId` server-side per tick. So the scheduled job itself can only ever
 * be a discovery/fan-out step: find every user who owns at least one DUE
 * monitor, and enqueue one real `{requestId}` `run_monitor` request per such
 * user (scope `{}` = "all due for this user"), which then runs through the
 * normal `runResearchJob(requestId, runMonitor)` path exactly like a manual
 * scan would. `apps/worker/src/index.ts` calls this directly when the
 * `QUEUE_IMPORT_RESEARCH_CORPUS` payload has no `requestId` (i.e. is the
 * cron's own trigger, not a real research job message).
 *
 * Idempotent per UTC calendar day, but not via the unique index — that
 * index (`research_job_request_inflight_idempotency_unique`) is PARTIAL and
 * only covers `('planned', 'queued', 'running')`, so it just prevents two
 * *overlapping in-flight* requests for the same day; it does nothing once
 * the first request reaches a terminal status, at which point a second
 * insert with the same `idempotencyKey` would no longer conflict. The real
 * same-day idempotency comes from upstream, at the monitor-selection step:
 * `isMonitorDue()` compares `now` against each monitor's own `lastScannedAt`
 * (set by `markMonitorScanned` at the end of every scan, per-monitor
 * fan-out or this cron path alike), so once a user's due monitors have been
 * scanned today, `dueUserIds` naturally excludes that user on a same-day
 * re-trigger — there is nothing left to enqueue, not a duplicate request
 * blocked after the fact. The unique index's role here is narrower: it only
 * guards against two cron ticks racing concurrently before either has
 * updated `lastScannedAt`.
 */
export async function runDueMonitorFanout(now: Date = new Date()): Promise<{ usersEnqueued: number }> {
  const candidates = await repo.listActiveNonPausedMonitorsAcrossUsers();
  const dueUserIds = new Set(
    candidates
      .filter((m) => isMonitorDue({ cadence: m.cadence as MonitorCadence, isActive: m.isActive, lastScannedAt: m.lastScannedAt }, now))
      .map((m) => m.userId),
  );

  const dayKey = now.toISOString().slice(0, 10); // UTC yyyy-mm-dd
  let usersEnqueued = 0;
  for (const userId of dueUserIds) {
    const idempotencyKey = `run_monitor:all-due:${dayKey}`;
    const [created] = await db
      .insert(researchJobRequests)
      .values({
        userId,
        jobType: "run_monitor",
        scope: {},
        idempotencyKey,
        status: "queued",
        estimatedCostUsd: 0,
        // Zero AI cost by design — never gated on a confirmation step.
        requiresConfirmation: false,
        confirmedAt: now,
      })
      .onConflictDoNothing({
        target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
        where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
      })
      .returning({ id: researchJobRequests.id });
    if (!created) continue; // already enqueued today (or still running) — an honest no-op, not a duplicate
    await enqueueImportResearchCorpus(created.id);
    usersEnqueued += 1;
  }
  return { usersEnqueued };
}
