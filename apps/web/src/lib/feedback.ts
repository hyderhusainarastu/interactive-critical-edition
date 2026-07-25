import { z } from "zod";

/**
 * Workstream J (v.5): the feedback modal's validation, shared by the client
 * form (`FeedbackModal.tsx`) and `api/feedback/route.ts` so both sides agree
 * on shape without duplicating the rules. Kept as pure schema/helpers (no DB,
 * no framework imports) so it unit-tests the same way `preAuthRateLimit.ts`
 * and the other `lib/*.test.ts` files do — plain `node:assert`, no DATABASE_URL.
 */

export const FEEDBACK_CATEGORIES = ["bug", "idea", "praise", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Mirrors the `feedback_body_length` CHECK constraint (schema.ts) — kept in
 * sync deliberately rather than read from the DB at request time. */
export const FEEDBACK_BODY_MAX = 10000;

export const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
  // Only meaningful for anonymous submissions — the route ignores this for a
  // signed-in submitter (their account email/identity is enough).
  email: z.email().max(320).optional(),
  path: z.string().trim().max(300).optional(),
  // Honeypot (plan §J): a field a real visitor never sees or fills (visually
  // hidden + aria-hidden + tabIndex -1 in the form). Left unconstrained on
  // purpose — the only thing that matters is whether it carries any value at
  // all, checked by `isHoneypotFilled` below, not what that value is.
  website: z.string().optional(),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

/**
 * True when the honeypot field carries any value. Scripted submissions that
 * blindly fill every input on a form almost always trip this; a human never
 * even sees the field, so any non-blank value here is a strong bot signal
 * independent of anything else in the payload.
 */
export function isHoneypotFilled(website: string | undefined): boolean {
  return typeof website === "string" && website.trim().length > 0;
}
