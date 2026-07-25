import { db, usageEvents } from "@ice/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { reportWebError } from "@/lib/telemetry";
import { shouldRecordUsageEvent } from "@/lib/usageEventDedupe";

const usageEventSchema = z.object({
  eventType: z.enum(["session_start", "page_view"]),
  path: z.string().trim().max(300).startsWith("/"),
});

/**
 * Workstream H (v.5): the client-reachable half of telemetry — receives
 * `TelemetryBeacon.tsx`'s `session_start`/`page_view` posts. `upload`/
 * `chat_message`/`feedback` events never come through here at all; they're
 * recorded server-side by `recordUsageEvent()` at their own routes (see
 * `lib/usageEvents.ts`), so a client can never forge one of those event
 * types by posting directly to this endpoint.
 *
 * ALWAYS 204, regardless of outcome (no session, invalid body, dedupe hit,
 * or even a DB error) — a telemetry beacon must never surface a failure
 * state to the page that fired it, matching `keepalive:true` +
 * `.catch(() => {})` on the sending side.
 */
export async function POST(request: Request) {
  try {
    const userId = await getApiUserId();
    if (!userId) return new NextResponse(null, { status: 204 });

    const input = usageEventSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return new NextResponse(null, { status: 204 });

    if (!shouldRecordUsageEvent(userId, input.data.eventType, input.data.path)) {
      return new NextResponse(null, { status: 204 });
    }

    await db.insert(usageEvents).values({ userId, eventType: input.data.eventType, path: input.data.path });
  } catch (error) {
    reportWebError(error, { scope: "api.usage_event" });
  }
  return new NextResponse(null, { status: 204 });
}
