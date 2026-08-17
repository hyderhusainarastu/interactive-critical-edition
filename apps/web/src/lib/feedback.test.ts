import { describe, expect, it } from "vitest";
import { FEEDBACK_BODY_MAX, feedbackSchema, isHoneypotFilled } from "@/lib/feedback";

/**
 * Workstream J (v.5): feedback zod schema + honeypot behavior. Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `preAuthRateLimit.test.ts` — no DB import, so no DATABASE_URL needed).
 */

describe("feedback schema and honeypot", () => {
  // A minimal valid submission passes.
  it("accepts a minimal valid submission", () => {
    const result = feedbackSchema.safeParse({ category: "bug", body: "Something broke on the reader page." });
    expect(result.success).toBe(true);
  });

  // Every declared category is accepted; anything else is rejected.
  it("accepts every declared category and rejects anything else", () => {
    for (const category of ["bug", "idea", "praise", "other"]) {
      expect(feedbackSchema.safeParse({ category, body: "note" }).success).toBe(true);
    }
    expect(feedbackSchema.safeParse({ category: "feature-request", body: "note" }).success).toBe(false);
  });

  // Body: empty (or whitespace-only, since the schema trims first) is rejected.
  it("rejects an empty or whitespace-only body, since the schema trims first", () => {
    expect(feedbackSchema.safeParse({ category: "idea", body: "" }).success).toBe(false);
    expect(feedbackSchema.safeParse({ category: "idea", body: "   " }).success).toBe(false);
  });

  // Body: exactly at the cap passes, one over fails — mirrors the DB's
  // `feedback_body_length` CHECK (<= 10000 chars) so a request never reaches
  // the database only to be rejected by the constraint.
  it("accepts a body exactly at the cap and rejects one over, mirroring the DB CHECK", () => {
    expect(feedbackSchema.safeParse({ category: "idea", body: "x".repeat(FEEDBACK_BODY_MAX) }).success).toBe(true);
    expect(feedbackSchema.safeParse({ category: "idea", body: "x".repeat(FEEDBACK_BODY_MAX + 1) }).success).toBe(false);
  });

  // Email is optional; when present it must actually look like an email.
  it("treats email as optional but validates it when present", () => {
    expect(feedbackSchema.safeParse({ category: "other", body: "note", email: "reader@example.test" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ category: "other", body: "note" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ category: "other", body: "note", email: "not-an-email" }).success).toBe(false);
  });

  // path is optional and bounded.
  it("treats path as optional and bounded", () => {
    expect(feedbackSchema.safeParse({ category: "other", body: "note", path: "/works/123" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ category: "other", body: "note", path: "/".repeat(301) }).success).toBe(false);
  });

  // The honeypot field itself is unconstrained by the schema (any string, or
  // absent) — validation happens purely via isHoneypotFilled at the route.
  it("leaves the honeypot field unconstrained by the schema", () => {
    expect(feedbackSchema.safeParse({ category: "other", body: "note" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ category: "other", body: "note", website: "" }).success).toBe(true);
    expect(feedbackSchema.safeParse({ category: "other", body: "note", website: "http://spam.example" }).success).toBe(true);
  });

  // isHoneypotFilled: only a real, non-blank value counts as filled.
  it("counts only a real, non-blank value as a filled honeypot", () => {
    expect(isHoneypotFilled(undefined)).toBe(false);
    expect(isHoneypotFilled("")).toBe(false);
    expect(isHoneypotFilled("   ")).toBe(false);
    expect(isHoneypotFilled("http://spam.example")).toBe(true);
    expect(isHoneypotFilled("a")).toBe(true);
  });
});
