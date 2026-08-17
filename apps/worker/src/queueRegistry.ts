import { db, getQueue, researchJobRequests, type ResearchQueueName } from "@ice/db";
import { reportError, type ErrorContext } from "@ice/observability";
import { eq } from "drizzle-orm";

/** `apps/worker` has no direct dependency on `pg-boss` (only `@ice/db` does)
 * — derived from `getQueue()`'s own return type rather than importing the
 * package directly, so this file doesn't need a new dependency just for a
 * type annotation. */
type Boss = Awaited<ReturnType<typeof getQueue>>;

/**
 * Declarative queue-wiring for `index.ts`'s `main()`. Before this file
 * existed, every queue was registered inline via `boss.work(...)` in one of
 * three inconsistent shapes:
 *
 *   1. SIMPLE — one handler, the payload goes straight to it
 *      (`extract-text`, `analyze-work`, `resolve-citation-metadata`,
 *      `expand-cross-library-graph`, `extract-research-claims`).
 *   2. TYPED — one queue carries multiple `research_job_request.jobType`
 *      values, dispatched by a per-job DB read of that column, repeated
 *      near-verbatim three times (`import-research-corpus`,
 *      `analyze-claim-debates`, `synthesize-research-output`).
 *   3. GENERIC — every other `RESEARCH_QUEUES` entry, always
 *      `handleUnimplementedResearchJob`. This one stays a plain loop in
 *      `index.ts` (see its comment there) since it needs no per-queue
 *      configuration beyond a queue name.
 *
 * `registerSimpleQueue`/`registerTypedQueue` below are the two generic
 * dispatchers for shapes 1 and 2; `index.ts` supplies each queue's actual
 * business logic (the `run` closures) and error policy. Nothing here
 * decides new behaviour — every quirk (which queue wraps errors, which
 * checks for a missing request row before matching a type, the cron
 * pre-check that must run before any DB read) is preserved exactly as it
 * was, per queue, on purpose. Do not unify a difference you find below;
 * it was verified against the pre-refactor file queue by queue.
 */

/** The failure text a research request carries until its engine ships. Asserted on, so it is a constant. */
export const RESEARCH_NOT_IMPLEMENTED = "research pipeline not yet implemented";

/**
 * Phase 25.6's honest no-op research handler. The queues exist; the engine that
 * fulfils them does not yet. Rather than silently completing a job that did
 * nothing — which would leave the request row stuck `queued` forever and read
 * to the user as "still working" — this records an explicit terminal failure
 * with a truthful reason on the ledger row.
 *
 * It deliberately does NOT rethrow on this path: the no-op is a definitive
 * answer, not a transient fault, so pg-boss must not retry it. Genuine errors
 * (a DB failure while recording the above) do propagate — see
 * `runUnimplementedWrapped` below, which reports and rethrows them.
 *
 * Each research lane REPLACES this registration with its real handler; this
 * function is expected to be deleted, not extended.
 */
async function handleUnimplementedResearchJob(queueName: ResearchQueueName, requestId: string): Promise<void> {
  const [request] = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status })
    .from(researchJobRequests)
    .where(eq(researchJobRequests.id, requestId))
    .limit(1);

  if (!request) {
    // Same class as the stale extract-text jobs D-19-2 addressed: a request
    // deleted after enqueue. Nothing to record, and nothing is wrong.
    console.warn(`[worker] ${queueName}: research_job_request ${requestId} not found; skipping`);
    return;
  }

  console.warn(`[worker] ${queueName}: ${RESEARCH_NOT_IMPLEMENTED} (request ${requestId})`);
  await db
    .update(researchJobRequests)
    .set({ status: "failed", error: RESEARCH_NOT_IMPLEMENTED, updatedAt: new Date() })
    .where(eq(researchJobRequests.id, requestId));
}

/**
 * Wraps `handleUnimplementedResearchJob` in the try/catch + `reportError` +
 * rethrow shape every call site used identically before this refactor: the
 * three TYPED queues' unmatched-jobType fallback below, and `index.ts`'s
 * GENERIC loop over any future unregistered research queue. Extracting this
 * is a pure dedup — all four call sites built the exact same
 * `{ scope: \`worker.${queueName}\`, requestId }` context.
 */
export async function runUnimplementedWrapped(queueName: ResearchQueueName, requestId: string): Promise<void> {
  try {
    await handleUnimplementedResearchJob(queueName, requestId);
  } catch (error) {
    reportError(error, { scope: `worker.${queueName}`, requestId });
    throw error;
  }
}

type ErrorPolicy<TData> = { kind: "selfReported" } | { kind: "wrapped"; context: (data: TData) => ErrorContext };

/** A queue with exactly one handler; the payload goes straight to it. */
export interface SimpleQueueEntry<TData> {
  name: string;
  /**
   * `selfReported` — the handler (or the function it calls) records its own
   * failure state and rethrows; nothing here calls `reportError`.
   * `wrapped` — this dispatcher wraps the call in try/catch, calls
   * `reportError` with the given per-queue context, then rethrows.
   */
  errorPolicy: ErrorPolicy<TData>;
  run: (data: TData) => Promise<void>;
}

export async function registerSimpleQueue<TData>(boss: Boss, entry: SimpleQueueEntry<TData>): Promise<void> {
  await boss.work<TData>(entry.name, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      if (entry.errorPolicy.kind === "wrapped") {
        const { context } = entry.errorPolicy;
        try {
          await entry.run(job.data);
        } catch (error) {
          reportError(error, context(job.data));
          throw error;
        }
      } else {
        await entry.run(job.data);
      }
    }
  });
}

/** One `research_job_request.jobType` branch on a TYPED queue. Routes are
 * tried in array order; the first whose `test` matches wins — mirrors the
 * pre-refactor `if (request?.jobType === "…") { … continue; }` chains. */
export interface TypedQueueRoute {
  test: (jobType: string | undefined) => boolean;
  /** Every existing route runs via `runResearchJob(requestId, handler)`,
   * which self-reports its own errors — this is never wrapped. */
  run: (requestId: string) => Promise<void>;
}

/** A queue whose messages are dispatched by a fresh per-job DB read of
 * `research_job_request.jobType`. */
export interface TypedQueueEntry<TData> {
  name: ResearchQueueName;
  /** Pulls the `research_job_request.id` to look up out of a payload already
   * known NOT to match `preCheck` (if any). */
  getRequestId: (data: TData) => string;
  /**
   * Optional check on the RAW payload, before any DB read — currently only
   * `import-research-corpus`'s daily monitor-cron trigger, whose payload
   * carries no `requestId` at all and so MUST be checked first, before any
   * `jobType` lookup by id could even be attempted. When it matches, its own
   * handler runs (wrapped per its own `context`) and the job is considered
   * fully handled — no jobType lookup happens for it.
   */
  preCheck?: {
    test: (data: TData) => boolean;
    run: (data: TData) => Promise<void>;
    context: (data: TData) => ErrorContext;
  };
  /**
   * Whether a missing `research_job_request` row is checked and skipped
   * (console.warn, no failure recorded, no `handleUnimplementedResearchJob`
   * call at all) BEFORE jobType matching — true for `analyze-claim-debates`
   * and `synthesize-research-output` — or left to fall through to the
   * unmatched-type fallback naturally (an undefined jobType just matches no
   * route, same as any other unrecognized value) — false for
   * `import-research-corpus`. This is a REAL behavioural difference between
   * queues today; it is preserved here, not unified.
   */
  explicitNotFoundCheck: boolean;
  /** Ordered; first matching predicate wins. */
  routes: TypedQueueRoute[];
}

export async function registerTypedQueue<TData>(boss: Boss, entry: TypedQueueEntry<TData>): Promise<void> {
  await boss.work<TData>(entry.name, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      const data = job.data;

      if (entry.preCheck && entry.preCheck.test(data)) {
        try {
          await entry.preCheck.run(data);
        } catch (error) {
          reportError(error, entry.preCheck.context(data));
          throw error;
        }
        continue;
      }

      const requestId = entry.getRequestId(data);
      // Same query, same place in the control flow, same `.limit(1)` as
      // every pre-refactor call site — executed fresh per job, per queue,
      // never memoized or shared across queues.
      const [request] = await db
        .select({ jobType: researchJobRequests.jobType })
        .from(researchJobRequests)
        .where(eq(researchJobRequests.id, requestId))
        .limit(1);

      if (entry.explicitNotFoundCheck && !request) {
        // Same class as the stale extract-text/analyze-work jobs D-19-2
        // addressed: a request row deleted after enqueue. Nothing to do.
        console.warn(`[worker] ${entry.name}: research_job_request ${requestId} not found; skipping`);
        continue;
      }

      const route = entry.routes.find((r) => r.test(request?.jobType));
      if (route) {
        await route.run(requestId);
        continue;
      }

      await runUnimplementedWrapped(entry.name, requestId);
    }
  });
}
