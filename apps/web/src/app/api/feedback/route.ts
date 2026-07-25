import { db, feedback, usageEvents } from "@ice/db";
import { reportEvent } from "@ice/observability";
import { after, NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/apiRateLimit";
import { rateLimitResponse } from "@/lib/apiResponse";
import { feedbackSchema, isHoneypotFilled } from "@/lib/feedback";
import { feedbackEmailHtml, mailProvider } from "@/lib/mail";
import { clientIdentity, preAuthRateLimit } from "@/lib/preAuthRateLimit";
import { reportWebError } from "@/lib/telemetry";

/**
 * Workstream J (v.5): accepts a `FeedbackModal` submission (see that
 * component and `lib/feedback.ts` for the shared shape). Two side effects —
 * the signed-in `usage_event` row and the optional admin-notification email
 * — run in `after()` (Next 16), i.e. AFTER the response is already sent, so
 * neither can slow down or fail the submitter's own request; both failures
 * are caught and reported rather than thrown.
 *
 * `recordUsageEvent()` (Workstream H's planned shared `lib/usageEvents.ts`
 * helper) does not exist yet in this worktree — Lane H may still be adding
 * it in parallel. The `usage_event` insert below is written inline as the
 * documented stand-in; when that helper lands, this call site should be the
 * one line `recordUsageEvent({ userId, eventType: "feedback", path })`
 * instead of constructing the insert itself.
 */
export async function POST(request: Request) {
  const input = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });
  }

  // Honeypot: a real visitor never sees or fills this hidden field (see
  // FeedbackModal.tsx). Any value here is treated as a bot signal — respond
  // with a convincing success and do nothing else, so the sender gets no
  // signal their submission was rejected and nothing touches the database.
  if (isHoneypotFilled(input.data.website)) {
    return NextResponse.json({ ok: true });
  }

  const userId = await getApiUserId();
  if (userId) {
    const rate = await enforceUserRateLimit({ userId, scope: "feedback", limit: 3, windowMs: 60 * 60_000 });
    if (!rate.allowed) return rateLimitResponse(rate);
  } else {
    const limited = preAuthRateLimit({
      scope: "feedback-ip",
      identity: clientIdentity(request),
      limit: 5,
      windowMs: 60 * 60_000,
    });
    if (limited) return limited;
  }

  // A signed-in submitter's account is the identity; the optional email
  // field only matters (and is only ever stored) for an anonymous one.
  const email = userId ? null : input.data.email ?? null;
  const path = input.data.path ?? null;

  const [row] = await db
    .insert(feedback)
    .values({ userId, email, category: input.data.category, body: input.data.body, path })
    .returning({ id: feedback.id });

  reportEvent("feedback.received", { feedbackId: row.id, category: input.data.category, authenticated: Boolean(userId) });

  after(async () => {
    // usage_event.userId has no FK and is NOT NULL by design (plan §H) —
    // events survive account deletion, but they can't exist without an
    // account at all, so this is signed-in only.
    if (userId) {
      try {
        await db.insert(usageEvents).values({ userId, eventType: "feedback", path });
      } catch (error) {
        reportWebError(error, { scope: "api.feedback.usage_event", userId, feedbackId: row.id });
      }
    }

    // Admin notification is optional and best-effort: ConsoleMailProvider
    // logs instead of sending when RESEND_API_KEY isn't configured, and any
    // real Resend failure here is caught rather than surfaced — the
    // submitter's own request already succeeded and must stay that way.
    const adminEmail = process.env.ADMIN_EMAILS?.split(",").map((value) => value.trim()).find(Boolean);
    if (!adminEmail) return;
    try {
      await mailProvider.send({
        to: adminEmail,
        subject: `New ${input.data.category} feedback`,
        html: feedbackEmailHtml({ category: input.data.category, body: input.data.body, email, path }),
      });
    } catch (error) {
      reportWebError(error, { scope: "api.feedback.admin_email", feedbackId: row.id });
    }
  });

  return NextResponse.json({ ok: true });
}
