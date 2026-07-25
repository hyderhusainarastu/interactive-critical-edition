import { requireAdminDash } from "@/lib/adminDash";
import { getAdminFeedback } from "@/lib/adminDashData";
import { markFeedbackReadAction } from "@/lib/adminDashActions";

const CATEGORY_LABEL: Record<string, string> = { bug: "Bug", idea: "Idea", praise: "Praise", other: "Other" };

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Workstream H (v.5) feedback inbox — newest first, unread rows visually
 *  emphasized, mark-read via the one admin-dash server action. */
export default async function AdminDashFeedbackPage() {
  await requireAdminDash();
  const rows = await getAdminFeedback();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--color-text-muted)]">
        {rows.filter((r) => !r.readAt).length} unread of {rows.length} total.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No feedback submitted yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`app-card rounded-lg p-4 ${row.readAt ? "" : "border-l-4 border-l-[var(--color-accent-burgundy)]"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    {CATEGORY_LABEL[row.category] ?? row.category}
                  </span>
                  {!row.readAt && (
                    <span className="text-xs font-semibold text-[var(--color-accent-burgundy)]">Unread</span>
                  )}
                  <span className="text-xs text-[var(--color-text-muted)]">{formatDateTime(row.createdAt)}</span>
                  {row.path && <span className="text-xs text-[var(--color-text-muted)]">from {row.path}</span>}
                </div>
                {!row.readAt && (
                  <form
                    action={async () => {
                      "use server";
                      await markFeedbackReadAction(row.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="min-h-11 rounded-md border border-[var(--color-border)] px-3 text-xs text-[var(--color-text)]"
                    >
                      Mark as read
                    </button>
                  </form>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text)]">{row.body}</p>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {row.email ? row.email : row.userId ? `Signed-in user ${row.userId}` : "Anonymous"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
