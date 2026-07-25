import { db, usageEvents } from "@ice/db";
import { after } from "next/server";
import { reportWebError } from "@/lib/telemetry";

export type ServerRecordedUsageEventType = "upload" | "chat_message" | "feedback";

/**
 * Workstream H (v.5): the SERVER-side half of telemetry, for event types a
 * client must never be able to forge by posting directly to
 * `api/usage-event/route.ts` (which only accepts `session_start`/
 * `page_view` — see that route's own doc comment). Called from the routes
 * that already know these things genuinely happened: upload completion, a
 * RAG message being answered, a feedback submission.
 *
 * Runs entirely inside Next 16's `after()` — strictly POST-response, so a
 * slow or failing insert can never add latency to (or fail) the caller's
 * own request. Any error is caught and reported, never thrown past this
 * function (there is nothing left downstream to catch it: `after()`
 * callbacks run after the response has already been sent).
 */
export function recordUsageEvent(input: { userId: string; eventType: ServerRecordedUsageEventType; path?: string | null }): void {
  after(async () => {
    try {
      await db.insert(usageEvents).values({ userId: input.userId, eventType: input.eventType, path: input.path ?? null });
    } catch (error) {
      reportWebError(error, { scope: "usage_events.record", userId: input.userId, eventType: input.eventType });
    }
  });
}
