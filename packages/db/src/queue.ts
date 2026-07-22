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
