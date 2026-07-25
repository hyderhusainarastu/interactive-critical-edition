import Link from "next/link";
import { requireAdminDash } from "@/lib/adminDash";
import { ADMIN_USERS_SORT_KEYS, getAdminUsersPage, type AdminUsersSortKey } from "@/lib/adminDashData";

const COLUMNS: Array<{ key: AdminUsersSortKey; label: string }> = [
  { key: "email", label: "Email" },
  { key: "createdAt", label: "Joined" },
  { key: "docs", label: "Docs" },
  { key: "aiCostUsd", label: "AI spend" },
  { key: "chatMessages", label: "Chats" },
  { key: "lastActiveAt", label: "Last active" },
];

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Workstream H (v.5): searchParams-driven users list — no client state, so
 * every filter/sort/page is a real, bookmarkable/shareable URL. See
 * `getAdminUsersPage`'s own doc comment for why active and deleted rows are
 * merged in application code rather than a raw SQL `UNION ALL`.
 */
export default async function AdminDashUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string }>;
}) {
  await requireAdminDash();
  const params = await searchParams;
  const search = params.q ?? "";
  const sort: AdminUsersSortKey = ADMIN_USERS_SORT_KEYS.includes(params.sort as AdminUsersSortKey)
    ? (params.sort as AdminUsersSortKey)
    : "createdAt";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const result = await getAdminUsersPage({ search, sort, dir, page });
  const totalPages = Math.max(1, Math.ceil(result.totalMatching / result.pageSize));

  function sortHref(key: AdminUsersSortKey) {
    const nextDir = sort === key && dir === "desc" ? "asc" : "desc";
    const qs = new URLSearchParams();
    if (search) qs.set("q", search);
    qs.set("sort", key);
    qs.set("dir", nextDir);
    return `/admin-dash/users?${qs.toString()}`;
  }

  function pageHref(target: number) {
    const qs = new URLSearchParams();
    if (search) qs.set("q", search);
    qs.set("sort", sort);
    qs.set("dir", dir);
    qs.set("page", String(target));
    return `/admin-dash/users?${qs.toString()}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <form method="GET" action="/admin-dash/users" className="flex gap-2">
        <label className="sr-only" htmlFor="admin-users-search">
          Search users by email or name
        </label>
        <input
          id="admin-users-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Search by email or name"
          className="min-h-11 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm"
        />
        <button type="submit" className="min-h-11 rounded-md border border-[var(--color-border)] px-4 text-sm text-[var(--color-text)]">
          Search
        </button>
      </form>

      <p className="text-sm text-[var(--color-text-muted)]">
        {result.totalMatching} matching {result.totalMatching === 1 ? "account" : "accounts"} — page {page} of {totalPages}.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
              {COLUMNS.map((col) => (
                <th key={col.key} className="py-2 pr-4 font-medium">
                  <Link href={sortHref(col.key)} className="hover:text-[var(--color-text)]">
                    {col.label}
                    {sort === col.key ? (dir === "asc" ? " ▲" : " ▼") : ""}
                  </Link>
                </th>
              ))}
              <th className="py-2 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id} className="border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4 text-[var(--color-text)]">
                  <Link href={`/admin-dash/users/${row.id}`} className="underline hover:no-underline">
                    {row.email}
                  </Link>
                  {row.name && <span className="block text-xs text-[var(--color-text-muted)]">{row.name}</span>}
                </td>
                <td className="py-2 pr-4 text-[var(--color-text-muted)]">{formatDate(row.createdAt)}</td>
                <td className="py-2 pr-4 tabular-nums text-[var(--color-text-muted)]">{row.docs}</td>
                <td className="py-2 pr-4 tabular-nums text-[var(--color-text-muted)]">${row.aiCostUsd.toFixed(4)}</td>
                <td className="py-2 pr-4 tabular-nums text-[var(--color-text-muted)]">{row.chatMessages}</td>
                <td className="py-2 pr-4 text-[var(--color-text-muted)]">{formatDate(row.lastActiveAt)}</td>
                <td className="py-2 pr-4">
                  {row.status === "deleted" ? (
                    <span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-accent-burgundy)]">
                      Deleted
                    </span>
                  ) : (
                    <span className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                      Active
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="py-4 text-center text-[var(--color-text-muted)]">
                  No accounts match this search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Users pagination">
          <Link
            href={pageHref(Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={`min-h-11 rounded-md border border-[var(--color-border)] px-3 py-2 ${page <= 1 ? "pointer-events-none opacity-40" : "text-[var(--color-text)]"}`}
          >
            Previous
          </Link>
          <span className="text-[var(--color-text-muted)]">
            Page {page} of {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={`min-h-11 rounded-md border border-[var(--color-border)] px-3 py-2 ${page >= totalPages ? "pointer-events-none opacity-40" : "text-[var(--color-text)]"}`}
          >
            Next
          </Link>
        </nav>
      )}
    </div>
  );
}
