import PgBoss from "pg-boss";

/**
 * Postgres-backed job queue (plan §5/§29 rationale: no Redis needed,
 * jobs and data share one transactional store). A singleton per process
 * — `boss.start()` does schema setup work, so it's reused across warm
 * serverless invocations and across the worker's long-running process.
 */

export const QUEUE_EXTRACT_TEXT = "extract-text";

export interface ExtractTextJob {
  documentId: string;
}

let bossPromise: Promise<PgBoss> | undefined;

export function getQueue(): Promise<PgBoss> {
  if (!bossPromise) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — required for the job queue.");
    }
    const boss = new PgBoss({ connectionString });
    boss.on("error", (error) => console.error("[pg-boss]", error));
    // pg-boss v10 requires a queue to be explicitly created before
    // send()/work() — send() no longer auto-creates it, and silently
    // no-ops into an unrelated internal queue if you skip this.
    bossPromise = boss
      .start()
      .then(() => boss.createQueue(QUEUE_EXTRACT_TEXT))
      .then(() => boss);
  }
  return bossPromise;
}

export async function enqueueExtractText(documentId: string) {
  const boss = await getQueue();
  return boss.send(QUEUE_EXTRACT_TEXT, { documentId } satisfies ExtractTextJob);
}
