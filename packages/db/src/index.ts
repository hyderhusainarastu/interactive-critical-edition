import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and point it at local Postgres (see docker-compose.yml) or Supabase.",
  );
}

const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export * from "./schema";
export * from "./queue";

/**
 * Deletes any not-yet-resolved `extract-text`/`analyze-work` pg-boss jobs
 * still queued for these document ids. Deleting a document (work purge,
 * test teardown) has no idea pg-boss's job table exists — it's a separate,
 * unrelated schema with no FK to `document` — so without this a job left
 * `created`/`retry`/`active` at delete time survives forever and later
 * fires "Document not found" through `reportError` when a worker eventually
 * dequeues it, indistinguishable in logs/Sentry from a real fault (found
 * during the Phase 19 backend/data audit: a batch of hours-old stale jobs
 * drained on local worker boot and logged as errors). Already-`completed`/
 * `failed` job rows are left alone — they're history, not queue state.
 */
export async function cancelQueuedJobsForDocuments(documentIds: string[]): Promise<number> {
  if (documentIds.length === 0) return 0;
  try {
    const result = await db.execute(sql`
      delete from pgboss.job
      where name in ('extract-text', 'analyze-work')
        and state in ('created', 'retry', 'active')
        and data ->> 'documentId' in ${documentIds}
    `);
    return result.count ?? 0;
  } catch (err) {
    // pg-boss lazily creates its own `pgboss` schema/tables the first time
    // getQueue() runs (boss.start()) — Drizzle's migrations never touch it.
    // An environment where no job has ever been enqueued yet (a fresh CI
    // Postgres container, or a test user whose documents were seeded
    // directly rather than uploaded) genuinely has nothing queued, so
    // "the schema doesn't exist" and "nothing to cancel" are the same fact.
    // Drizzle wraps the driver error in its own DrizzleQueryError, with the
    // real PostgresError (and its .code) nested on .cause — not on err
    // itself.
    const cause = err instanceof Error ? err.cause : undefined;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "42P01") return 0;
    throw err;
  }
}

/** Drizzle wraps the driver's PostgresError in DrizzleQueryError with `.code`
 *  on the nested `.cause` (see cancelQueuedJobsForDocuments above). `42P01` =
 *  the `pgboss` schema/tables don't exist yet, which is the same fact as
 *  "nothing queued" — pg-boss only creates them on first `boss.start()`. */
function isMissingPgbossSchema(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  return Boolean(cause && typeof cause === "object" && "code" in cause && cause.code === "42P01");
}

/**
 * Non-terminal (`created`/`retry`/`active`) extract-text jobs for one
 * document — the queue-state snapshot `planReprocess` (queue.ts) decides on.
 * Lives here rather than queue.ts for the same reason as
 * `cancelQueuedJobsForDocuments`: these need `db`, and queue.ts is itself
 * re-exported by this module.
 */
export async function findPendingExtractJobs(documentId: string): Promise<import("./queue").PendingExtractJob[]> {
  try {
    const rows = await db.execute(sql`
      select id, state, started_on
      from pgboss.job
      where name = 'extract-text'
        and state in ('created', 'retry', 'active')
        and data ->> 'documentId' = ${documentId}
      order by created_on asc
    `);
    return [...rows].map((row) => {
      const r = row as { id: string; state: string; started_on: Date | string | null };
      return {
        id: r.id,
        state: r.state as import("./queue").PendingExtractJobState,
        startedOn: r.started_on ? new Date(r.started_on) : null,
      };
    });
  } catch (err) {
    if (isMissingPgbossSchema(err)) return [];
    throw err;
  }
}

/**
 * Deletes one extract-text job row if it is still non-terminal. Used by the
 * reprocess command's stale-active-job recovery: the orphaned `active` row
 * must be removed (not just superseded) or pg-boss would eventually treat it
 * as expired and RETRY it into a duplicate run — the exact failure the
 * 10-document load test observed (see EXTRACT_EXPIRE_MINUTES in queue.ts).
 * Guarded by id+state so a job that completed in the meantime is left alone.
 * Returns true when a row was actually removed.
 */
export async function cancelExtractJob(jobId: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      delete from pgboss.job
      where name = 'extract-text'
        and id = ${jobId}
        and state in ('created', 'retry', 'active')
    `);
    return (result.count ?? 0) > 0;
  } catch (err) {
    if (isMissingPgbossSchema(err)) return false;
    throw err;
  }
}

/**
 * Deletes `active` extract-text rows for these documents whose fetch time
 * predates `olderThan` — the worker-boot companion to the reprocess command's
 * recovery (an orphaned active row would otherwise be retried into a
 * duplicate run after its expiration window). Deliberately narrower than
 * `cancelQueuedJobsForDocuments`: `created`/`retry` rows are legitimate
 * queued work (e.g. a retry the user just clicked) and must survive.
 */
export async function cancelStaleActiveExtractJobs(documentIds: string[], olderThan: Date): Promise<number> {
  if (documentIds.length === 0) return 0;
  try {
    // ISO string, not the Date object: postgres.js can't bind a raw Date
    // through drizzle's sql template here (ERR_INVALID_ARG_TYPE).
    const result = await db.execute(sql`
      delete from pgboss.job
      where name = 'extract-text'
        and state = 'active'
        and started_on < ${olderThan.toISOString()}::timestamptz
        and data ->> 'documentId' in ${documentIds}
    `);
    return result.count ?? 0;
  } catch (err) {
    if (isMissingPgbossSchema(err)) return 0;
    throw err;
  }
}
