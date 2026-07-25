import assert from "node:assert/strict";
import { FEEDBACK_BODY_MAX, feedbackSchema, isHoneypotFilled } from "./feedback";

/**
 * Workstream J (v.5): feedback zod schema + honeypot behavior. Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `preAuthRateLimit.test.ts` — no DB import, so no DATABASE_URL needed).
 */

// A minimal valid submission passes.
{
  const result = feedbackSchema.safeParse({ category: "bug", body: "Something broke on the reader page." });
  assert.equal(result.success, true);
}

// Every declared category is accepted; anything else is rejected.
for (const category of ["bug", "idea", "praise", "other"]) {
  assert.equal(feedbackSchema.safeParse({ category, body: "note" }).success, true);
}
assert.equal(feedbackSchema.safeParse({ category: "feature-request", body: "note" }).success, false);

// Body: empty (or whitespace-only, since the schema trims first) is rejected.
assert.equal(feedbackSchema.safeParse({ category: "idea", body: "" }).success, false);
assert.equal(feedbackSchema.safeParse({ category: "idea", body: "   " }).success, false);

// Body: exactly at the cap passes, one over fails — mirrors the DB's
// `feedback_body_length` CHECK (<= 10000 chars) so a request never reaches
// the database only to be rejected by the constraint.
assert.equal(feedbackSchema.safeParse({ category: "idea", body: "x".repeat(FEEDBACK_BODY_MAX) }).success, true);
assert.equal(feedbackSchema.safeParse({ category: "idea", body: "x".repeat(FEEDBACK_BODY_MAX + 1) }).success, false);

// Email is optional; when present it must actually look like an email.
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note", email: "reader@example.test" }).success, true);
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note" }).success, true);
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note", email: "not-an-email" }).success, false);

// path is optional and bounded.
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note", path: "/works/123" }).success, true);
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note", path: "/".repeat(301) }).success, false);

// The honeypot field itself is unconstrained by the schema (any string, or
// absent) — validation happens purely via isHoneypotFilled at the route.
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note" }).success, true);
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note", website: "" }).success, true);
assert.equal(feedbackSchema.safeParse({ category: "other", body: "note", website: "http://spam.example" }).success, true);

// isHoneypotFilled: only a real, non-blank value counts as filled.
assert.equal(isHoneypotFilled(undefined), false);
assert.equal(isHoneypotFilled(""), false);
assert.equal(isHoneypotFilled("   "), false);
assert.equal(isHoneypotFilled("http://spam.example"), true);
assert.equal(isHoneypotFilled("a"), true);

console.log("feedback.test.ts: all assertions passed");
