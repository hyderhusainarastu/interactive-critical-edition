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
