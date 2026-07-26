import PgBoss from "pg-boss";

/**
 * Postgres-backed job queue (plan §5/§29 rationale: no Redis needed,
 * jobs and data share one transactional store). A singleton per process
 * — `boss.start()` does schema setup work, so it's reused across warm
 * serverless invocations and across the worker's long-running process.
 */

export const QUEUE_EXTRACT_TEXT = "extract-text";
// Phase 4: scholarly analysis (citation extraction → bibliographic
// resolution → relationship classification). A separate queue from
// extraction so a slow/failed analysis never blocks the reader from
// opening a document whose text already extracted fine.
export const QUEUE_ANALYZE_WORK = "analyze-work";
/** Metadata resolution is intentionally decoupled from citation-to-Library projection. */
export const QUEUE_RESOLVE_CITATION_METADATA = "resolve-citation-metadata";
/** Paid, source-grounded cross-work judgements (Phase 12.5). */
export const QUEUE_EXPAND_CROSS_LIBRARY_GRAPH = "expand-cross-library-graph";

/**
 * Phase 25 research engine. Four queues, grouped by cost profile and trigger
 * rather than one queue per pipeline stage:
 *
 *  - `extract-research-claims` — paid extraction over project members. Never
 *    auto-fires on upload (plan §Pipeline): membership, an explicit action, or
 *    a corpus import triggers it, so nothing spends money without a user action.
 *  - `analyze-claim-debates` — relationship detection AND clustering as one
 *    staged, resumable request. Deliberately not two queues: a separate
 *    clustering enqueue would introduce a lost-enqueue failure mode where paid
 *    judgements exist with nothing to group them.
 *  - `synthesize-research-output` — Evidence Chamber + hypotheses, explicit
 *    action only (the most expensive, least automatic stage).
 *  - `import-research-corpus` — zero AI cost; also carries scheduled monitors,
 *    whose cadence defaults to paused behind a flag that defaults off.
 *
 * These run on their OWN queues, independent of `extract-text`: the edition
 * pipeline's stage sequence is untouched by the research engine.
 */
export const QUEUE_EXTRACT_RESEARCH_CLAIMS = "extract-research-claims";
export const QUEUE_ANALYZE_CLAIM_DEBATES = "analyze-claim-debates";
export const QUEUE_SYNTHESIZE_RESEARCH = "synthesize-research-output";
export const QUEUE_IMPORT_RESEARCH_CORPUS = "import-research-corpus";

/** Every research queue carries the same payload. */
export const RESEARCH_QUEUES = [
  QUEUE_EXTRACT_RESEARCH_CLAIMS,
  QUEUE_ANALYZE_CLAIM_DEBATES,
  QUEUE_SYNTHESIZE_RESEARCH,
  QUEUE_IMPORT_RESEARCH_CORPUS,
] as const;

export type ResearchQueueName = (typeof RESEARCH_QUEUES)[number];

export interface ExtractTextJob {
  documentId: string;
}

export interface AnalyzeWorkJob {
  documentId: string;
}

export interface ResolveCitationMetadataJob {
  citationId: string;
}

export interface ExpandCrossLibraryGraphJob {
  expansionRequestId: string;
}

/**
 * The ONLY payload any research queue carries. Everything a handler needs —
 * scope, budget, confirmation state, progress, coverage — lives on the
 * `research_job_request` row this id points at, so a queue message can never
 * disagree with the ledger, and a redelivered message re-reads current state
 * instead of acting on a stale snapshot (the `graph_expansion_request`
 * precedent).
 */
export interface ResearchJobPayload {
  requestId: string;
}

let bossPromise: Promise<PgBoss> | undefined;

/**
 * pg-boss's internal `pg` client re-parses `connectionString` inside
 * node-postgres's `ConnectionParameters` constructor via
 * `Object.assign({}, config, parse(config.connectionString))` — the parsed
 * result is spread LAST, so it silently overwrites any explicit `ssl` option
 * passed alongside `connectionString`. Combined with pg-connection-string
 * >=2.7 now treating sslmode=require/prefer/verify-ca as verify-full, this
 * broke pg-boss startup against Supabase's Supavisor pooler cert chain
 * (SELF_SIGNED_CERT_IN_CHAIN) after its connection string was refreshed with
 * `sslmode=require` during the Phase 18 DB password rotation. Passing
 * discrete host/port/database/user/password fields (no `connectionString`
 * key at all) sidesteps that override path so our explicit `ssl` actually
 * takes effect. Local dev's connection string has no sslmode, so `ssl` stays
 * undefined there, matching its non-TLS local Postgres.
 */
function buildPgBossConfig(connectionString: string): PgBoss.ConstructorOptions {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: sslMode && sslMode !== "disable" ? { rejectUnauthorized: false } : undefined,
  };
}

export function getQueue(): Promise<PgBoss> {
  if (!bossPromise) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — required for the job queue.");
    }
    const boss = new PgBoss(buildPgBossConfig(connectionString));
    boss.on("error", (error) => console.error("[pg-boss]", error));
    // pg-boss v10 requires a queue to be explicitly created before
    // send()/work() — send() no longer auto-creates it, and silently
    // no-ops into an unrelated internal queue if you skip this.
    bossPromise = boss
      .start()
      .then(() => boss.createQueue(QUEUE_EXTRACT_TEXT))
      .then(() => boss.createQueue(QUEUE_ANALYZE_WORK))
      .then(() => boss.createQueue(QUEUE_RESOLVE_CITATION_METADATA))
      .then(() => boss.createQueue(QUEUE_EXPAND_CROSS_LIBRARY_GRAPH))
      .then(() => boss.createQueue(QUEUE_EXTRACT_RESEARCH_CLAIMS))
      .then(() => boss.createQueue(QUEUE_ANALYZE_CLAIM_DEBATES))
      .then(() => boss.createQueue(QUEUE_SYNTHESIZE_RESEARCH))
      .then(() => boss.createQueue(QUEUE_IMPORT_RESEARCH_CORPUS))
      .then(() => boss);
  }
  return bossPromise;
}

/**
 * Extraction is long-running (GROBID + OCR + research) and the worker processes
 * one job at a time, so a queued job's clock includes everything ahead of it.
 * pg-boss's 15-minute default expiration measures from when the job is fetched,
 * and a backlog pushes real work past it: a 10-document load test produced two
 * DUPLICATE runs because jobs still in progress were treated as expired and
 * retried. The generous window below is sized for a realistic backlog rather
 * than a single document.
 */
const EXTRACT_EXPIRE_MINUTES = Number(process.env.EXTRACT_EXPIRE_MINUTES ?? 60);

export async function enqueueExtractText(documentId: string) {
  const boss = await getQueue();
  return boss.send(
    QUEUE_EXTRACT_TEXT,
    { documentId } satisfies ExtractTextJob,
    { expireInMinutes: EXTRACT_EXPIRE_MINUTES },
  );
}

export async function enqueueAnalyzeWork(documentId: string) {
  const boss = await getQueue();
  return boss.send(QUEUE_ANALYZE_WORK, { documentId } satisfies AnalyzeWorkJob);
}

/**
 * One citation per job keeps resolver traffic rate-limited by the single
 * worker consumer and lets a metadata outage leave the durable Library stub
 * intact rather than failing the whole edition run.
 */
export async function enqueueCitationMetadataResolution(citationId: string) {
  const boss = await getQueue();
  return boss.send(
    QUEUE_RESOLVE_CITATION_METADATA,
    { citationId } satisfies ResolveCitationMetadataJob,
    { retryLimit: 1, retryDelay: 15 },
  );
}

/** Idempotency lives in `graph_expansion_request`; this queue payload is its immutable ID. */
export async function enqueueGraphExpansion(expansionRequestId: string) {
  const boss = await getQueue();
  return boss.send(
    QUEUE_EXPAND_CROSS_LIBRARY_GRAPH,
    { expansionRequestId } satisfies ExpandCrossLibraryGraphJob,
    { expireInMinutes: EXTRACT_EXPIRE_MINUTES },
  );
}

/**
 * Phase 25 research enqueues. Idempotency lives entirely in
 * `research_job_request` (partial unique on the in-flight statuses), so these
 * helpers deliberately do nothing but hand the durable request id to pg-boss —
 * exactly like `enqueueGraphExpansion`. They reuse the generous extraction
 * expiration window for the same reason it exists there: the worker processes
 * one job at a time, so a queued research job's clock includes everything ahead
 * of it in the backlog, and the 15-minute pg-boss default would retry live work
 * into duplicate paid runs.
 */
export async function enqueueExtractResearchClaims(requestId: string) {
  const boss = await getQueue();
  return boss.send(
    QUEUE_EXTRACT_RESEARCH_CLAIMS,
    { requestId } satisfies ResearchJobPayload,
    { expireInMinutes: EXTRACT_EXPIRE_MINUTES },
  );
}

export async function enqueueAnalyzeClaimDebates(requestId: string) {
  const boss = await getQueue();
  return boss.send(
    QUEUE_ANALYZE_CLAIM_DEBATES,
    { requestId } satisfies ResearchJobPayload,
    { expireInMinutes: EXTRACT_EXPIRE_MINUTES },
  );
}

export async function enqueueSynthesizeResearch(requestId: string) {
  const boss = await getQueue();
  return boss.send(
    QUEUE_SYNTHESIZE_RESEARCH,
    { requestId } satisfies ResearchJobPayload,
    { expireInMinutes: EXTRACT_EXPIRE_MINUTES },
  );
}

export async function enqueueImportResearchCorpus(requestId: string) {
  const boss = await getQueue();
  return boss.send(
    QUEUE_IMPORT_RESEARCH_CORPUS,
    { requestId } satisfies ResearchJobPayload,
    { expireInMinutes: EXTRACT_EXPIRE_MINUTES },
  );
}

/**
 * Phase 29.1 monitoring's cron trigger — the STATIC payload pg-boss's own
 * `schedule()` sends on every cron tick, on the SAME `QUEUE_IMPORT_RESEARCH_CORPUS`
 * queue every other research job on this queue carries a `{requestId}`
 * `ResearchJobPayload` on. Distinct because pg-boss's `schedule` table stores
 * one fixed `data` payload per queue name (there is no way to compute a fresh
 * `requestId` server-side on each tick) — so the cron's own job can only ever
 * be a discovery/fan-out step (find every user with a due monitor, enqueue a
 * real `{requestId}` `run_monitor` request per such user), never the scan
 * itself. `apps/worker/src/index.ts`'s `QUEUE_IMPORT_RESEARCH_CORPUS` handler
 * distinguishes the two payload shapes by presence of `requestId`;
 * `apps/worker/src/research/runMonitor.ts`'s `runDueMonitorFanout` is the
 * fan-out step this trigger runs.
 */
export interface RunMonitorCronTrigger {
  kind: "run-monitor-fanout";
}

export const RUN_MONITOR_CRON_PAYLOAD: RunMonitorCronTrigger = { kind: "run-monitor-fanout" };

/** Once daily, 06:00 UTC — arbitrary but fixed; monitors themselves still
 *  gate on their own `daily`/`weekly` cadence window (`isMonitorDue()`), so
 *  this only needs to run at least as often as the shortest cadence. */
export const RUN_MONITOR_CRON_SCHEDULE = "0 6 * * *";

/** `QUEUE_IMPORT_RESEARCH_CORPUS`'s registered cron schedule name — pg-boss
 *  schedules are keyed by queue name (one schedule row per queue), so this
 *  IS the queue name, not a separate identifier. */
export const RUN_MONITOR_CRON_NAME = QUEUE_IMPORT_RESEARCH_CORPUS;

export function isRunMonitorCronTrigger(data: unknown): data is RunMonitorCronTrigger {
  return Boolean(data && typeof data === "object" && (data as { kind?: unknown }).kind === "run-monitor-fanout");
}

// ---- Phase 20.5: the single idempotent reprocess command's decision core ----

/** pg-boss states that mean "this document already has an extraction attempt
 *  in the queue or in progress" — everything else (`completed`/`failed`/
 *  `cancelled`) is history, not queue state. */
export const PENDING_EXTRACT_JOB_STATES = ["created", "retry", "active"] as const;
export type PendingExtractJobState = (typeof PENDING_EXTRACT_JOB_STATES)[number];

export interface PendingExtractJob {
  id: string;
  state: PendingExtractJobState;
  /** Null until pg-boss fetches the job (i.e. while `created`/`retry`). */
  startedOn: Date | null;
}

/**
 * How long an `active` extract-text job may go without any progress on its
 * document's latest processing run before it is treated as orphaned by a dead
 * worker. The worker heartbeats `processing_run.updated_at` every minute while
 * a run executes (see apps/worker), so a live run — even one sitting in a
 * single long research stage — never looks stale; only a crashed/killed worker
 * stops the heartbeat. Deliberately much shorter than the 60-minute
 * `expireInMinutes` window: that window exists for queue backlogs, and before
 * this existed an orphaned job was unrecoverable until it elapsed
 * (docs/PROJECT-LOG.md Known Problems), then retried into a duplicate run.
 */
export const STALE_ACTIVE_EXTRACT_MINUTES_DEFAULT = 10;

export function staleActiveExtractMs(): number {
  const configured = Number(process.env.STALE_ACTIVE_EXTRACT_MINUTES ?? STALE_ACTIVE_EXTRACT_MINUTES_DEFAULT);
  return Math.max(1, Number.isFinite(configured) ? configured : STALE_ACTIVE_EXTRACT_MINUTES_DEFAULT) * 60_000;
}

export type ReprocessPlan =
  /** An identical attempt is already queued — return it instead of enqueueing a duplicate. */
  | { action: "reuse"; jobId: string }
  /** An `active` job was orphaned by a dead worker: cancel it and enqueue a fresh attempt. */
  | { action: "recover"; staleJobId: string }
  /** No pending attempt exists and the document's status allows one — enqueue. */
  | { action: "enqueue" }
  /** A live attempt is genuinely running — starting another would duplicate paid work. */
  | { action: "conflict"; reason: string };

/**
 * Pure decision core for `POST /api/works/:id/reprocess` (plan §20.5):
 * one idempotent command with explicit allowed source statuses,
 * duplicate-request protection, and stale-active-job recovery. Kept pure
 * (no DB access) so every branch is unit-testable; the route supplies the
 * queue/run snapshots and executes the returned action.
 *
 * Allowed source statuses: `ready`, `needs_review`, `failed`, and `uploaded`
 * enqueue directly when nothing is pending ("uploaded" covers a lost initial
 * enqueue). `processing` is only ever recovered (stale) or conflicted (live) —
 * never blindly re-enqueued.
 */
export function planReprocess(input: {
  documentStatus: "uploaded" | "processing" | "needs_review" | "ready" | "failed";
  pendingJobs: PendingExtractJob[];
  /** The document's latest processing run, if any (highest version). */
  latestRun: { status: string; updatedAt: Date } | null;
  now?: Date;
  staleAfterMs?: number;
}): ReprocessPlan {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? staleActiveExtractMs();
  const cutoff = now.getTime() - staleAfterMs;

  // Duplicate-request protection: a queued (not-yet-fetched) attempt is
  // exactly what a second click would create — reuse it.
  const queued = input.pendingJobs.find((job) => job.state === "created" || job.state === "retry");
  if (queued) return { action: "reuse", jobId: queued.id };

  const active = input.pendingJobs.find((job) => job.state === "active");
  if (active) {
    const jobStale = (active.startedOn?.getTime() ?? 0) < cutoff;
    // A live worker heartbeats the run row; "running run with a fresh
    // updatedAt" is proof of life regardless of how old the job is.
    const runFresh = input.latestRun !== null && input.latestRun.status === "running" && input.latestRun.updatedAt.getTime() >= cutoff;
    if (jobStale && !runFresh) return { action: "recover", staleJobId: active.id };
    return { action: "conflict", reason: "Processing is already running for this work." };
  }

  // No pending job at all. A `processing` document whose latest run is still
  // fresh means a worker is mid-run in the narrow window where queue state
  // is ambiguous — don't stack a duplicate on top of it.
  if (input.documentStatus === "processing") {
    const runFresh = input.latestRun !== null && input.latestRun.status === "running" && input.latestRun.updatedAt.getTime() >= cutoff;
    if (runFresh) return { action: "conflict", reason: "Processing is already running for this work." };
    return { action: "enqueue" };
  }

  return { action: "enqueue" };
}
