import { db, feedback } from "@ice/db";
import { desc, eq } from "drizzle-orm";

/**
 * Extracted verbatim from `adminDashData.ts` (Workstream H, v.5): the
 * `/admin-dash/feedback` inbox read plus the one mutation in the whole
 * admin-dash query layer (`markFeedbackReadQuery`, called by
 * `adminDashActions.ts`). `adminDashData.ts` re-exports both unchanged.
 */

// ---------------------------------------------------------------------------
// Feedback inbox
// ---------------------------------------------------------------------------

export interface AdminFeedbackRow {
  id: string;
  userId: string | null;
  email: string | null;
  category: "bug" | "idea" | "praise" | "other";
  body: string;
  path: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export async function getAdminFeedback(): Promise<AdminFeedbackRow[]> {
  return db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(200);
}

export async function markFeedbackReadQuery(feedbackId: string): Promise<void> {
  await db.update(feedback).set({ readAt: new Date() }).where(eq(feedback.id, feedbackId));
}
