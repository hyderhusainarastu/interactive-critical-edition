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
  const result = await db.execute(sql`
    delete from pgboss.job
    where name in ('extract-text', 'analyze-work')
      and state in ('created', 'retry', 'active')
      and data ->> 'documentId' in ${documentIds}
  `);
  return result.count ?? 0;
}
