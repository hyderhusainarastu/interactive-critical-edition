/**
 * Workstream H (v.5) admin-dashboard queries. Every read `/admin-dash` needs
 * lives in this one file, read-only and parameterized throughout — no raw
 * string interpolation of request input into SQL anywhere below. This is
 * also the first file in the codebase to use SQL `date_trunc`
 * (`accountUsage.ts`'s own doc comment explicitly reserves that here): the
 * daily series need a real day-bucketed GROUP BY over a row count that can
 * meaningfully exceed any one user's own history, unlike the per-user
 * bucketing `accountUsage.ts` does in application code.
 *
 * THE PRIVACY GATE (plan §H, "data-sharing gate lives in the QUERY layer"):
 * `getAdminUserDetail` below only ever calls `getUserChatTranscripts` inside
 * the branch where the resolved user's data-sharing flag is true. A
 * non-opted-in user's conversation content is never selected out of
 * Postgres in the first place — the page can't accidentally render what was
 * never fetched.
 */

/**
 * The declarations the doc comment above describes now live in four sibling
 * modules — one per `/admin-dash` route — plus the day-axis helpers they
 * share. Nothing moved changed: each declaration was cut and pasted
 * verbatim, and this file re-exports the exact same public surface it had
 * before, so every importer keeps working unchanged.
 *
 *   adminDashDayAxis.ts     shared, DB-free day-axis helpers
 *   adminDashOverview.ts    /admin-dash            (tiles, series, run health)
 *   adminDashUsers.ts       /admin-dash/users      (list + active/archived merge)
 *   adminDashUserDetail.ts  /admin-dash/users/[id] (drill-down, privacy gate)
 *   adminDashFeedback.ts    /admin-dash/feedback   (inbox + mark-read)
 */

export type {
  AdminOverviewTiles,
  AdminDailySeries,
  AdminRunHealth,
  AdminOverview,
} from "@/lib/admin/adminDashOverview";
export { getAdminOverview } from "@/lib/admin/adminDashOverview";

export type { AdminUserRow, AdminUsersSortKey, AdminUsersPage } from "@/lib/admin/adminDashUsers";
export { ADMIN_USERS_SORT_KEYS, getAdminUsersPage } from "@/lib/admin/adminDashUsers";

export type { AdminChatMessage, AdminChatTranscript, AdminUserDetail } from "@/lib/admin/adminDashUserDetail";
export { getAdminUserDetail } from "@/lib/admin/adminDashUserDetail";

export type { AdminFeedbackRow } from "@/lib/admin/adminDashFeedback";
export { getAdminFeedback, markFeedbackReadQuery } from "@/lib/admin/adminDashFeedback";
