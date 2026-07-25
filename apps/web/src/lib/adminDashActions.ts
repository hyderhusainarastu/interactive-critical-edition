"use server";

import { revalidatePath } from "next/cache";
import { requireAdminDash } from "@/lib/adminDash";
import { markFeedbackReadQuery } from "@/lib/adminDashData";

/** The one mutating admin-dash action (mark-read). Guarded the same way
 *  every `/admin-dash` page is — `requireAdminDash()` first, since a server
 *  action is reachable independent of whatever page rendered its form. */
export async function markFeedbackReadAction(feedbackId: string): Promise<void> {
  await requireAdminDash();
  await markFeedbackReadQuery(feedbackId);
  revalidatePath("/admin-dash/feedback");
}
