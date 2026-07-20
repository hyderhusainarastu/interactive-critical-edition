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

export interface ExtractTextJob {
  documentId: string;
}

export interface AnalyzeWorkJob {
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
      .then(() => boss.createQueue(QUEUE_ANALYZE_WORK))
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
