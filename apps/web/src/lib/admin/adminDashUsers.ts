import { db, userDeletionArchives, users } from "@ice/db";
import { ilike, or, sql } from "drizzle-orm";

/**
 * Extracted verbatim from `adminDashData.ts` (Workstream H, v.5): the
 * `/admin-dash/users` list query and the active/archived merge it performs
 * in application code. Read-only and parameterized throughout.
 * `adminDashData.ts` re-exports everything below unchanged.
 */

const USERS_PAGE_SIZE = 50;
// Beta-scale safety valve for the users-list merge below (see its own doc
// comment) — a real ceiling on rows fetched per side, not a pagination
// mechanism.
const USERS_FETCH_CAP = 5000;

// ---------------------------------------------------------------------------
// Users list
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  status: "active" | "deleted";
  email: string;
  name: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  docs: number;
  aiCostUsd: number;
  chatMessages: number;
  lastActiveAt: Date | null;
}

export type AdminUsersSortKey = "createdAt" | "email" | "docs" | "aiCostUsd" | "chatMessages" | "lastActiveAt";
export const ADMIN_USERS_SORT_KEYS: AdminUsersSortKey[] = [
  "createdAt",
  "email",
  "docs",
  "aiCostUsd",
  "chatMessages",
  "lastActiveAt",
];

export interface AdminUsersPage {
  rows: AdminUserRow[];
  page: number;
  pageSize: number;
  totalMatching: number;
}

/**
 * Active users and archived (deleted) users live in two differently-shaped
 * tables (`user` has real-time joinable activity; `user_deletion_archive`
 * is a flat point-in-time snapshot) — rather than fight a raw SQL
 * `UNION ALL` across mismatched column types, both search-filtered sets are
 * fetched (each capped at `USERS_FETCH_CAP`, a safety valve rather than a
 * real pagination mechanism) and merged/sorted/paginated in application
 * code, the same "beta-scale, document the trade-off" posture
 * `accountUsage.ts` already established for its own per-user bucketing.
 */
export async function getAdminUsersPage(options: {
  search?: string;
  sort?: AdminUsersSortKey;
  dir?: "asc" | "desc";
  page?: number;
}): Promise<AdminUsersPage> {
  const search = options.search?.trim() ?? "";
  const sort: AdminUsersSortKey = options.sort && ADMIN_USERS_SORT_KEYS.includes(options.sort) ? options.sort : "createdAt";
  const dir = options.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, options.page ?? 1);

  const activeWhere = search ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`)) : undefined;
  const activeRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      // The outer reference is written as the literal qualified column
      // `"user"."id"` rather than interpolating `${users.id}` — drizzle
      // renders a bare `${users.id}` inside a correlated subquery as the
      // UNQUALIFIED column name "id", and since `document` (aliased `d`
      // below) also has its own `id` column, Postgres then reports "column
      // reference \"id\" is ambiguous" (42702) — found live running this
      // exact query. Qualifying it explicitly resolves the correlation
      // unambiguously; `"user"` is this table's real SQL name (`pgTable("user", ...)`
      // in schema.ts), not user input, so a literal fragment is safe here.
      docs: sql<number>`(select count(*) from document d where d.user_id = "user"."id")`,
      aiCostUsd: sql<number>`(
        select coalesce(sum(l.estimated_cost_usd), 0) from ai_usage_log l
        join document d on d.id = l.document_id where d.user_id = "user"."id"
      )`,
      chatMessages: sql<number>`(
        select count(*) from rag_message m
        join rag_conversation c on c.id = m.conversation_id where c.user_id = "user"."id"
      )`,
      lastActiveAt: sql<Date | null>`(select max(e.created_at) from usage_event e where e.user_id = "user"."id")`,
    })
    .from(users)
    .where(activeWhere)
    .limit(USERS_FETCH_CAP);

  const archivedWhere = search
    ? or(ilike(userDeletionArchives.email, `%${search}%`), ilike(userDeletionArchives.name, `%${search}%`))
    : undefined;
  const archivedRows = await db
    .select({
      id: userDeletionArchives.userId,
      email: userDeletionArchives.email,
      name: userDeletionArchives.name,
      createdAt: userDeletionArchives.userCreatedAt,
      deletedAt: userDeletionArchives.deletedAt,
      docs: userDeletionArchives.docsProcessed,
      aiCostUsd: userDeletionArchives.totalAiCostUsd,
      chatMessages: userDeletionArchives.chatMessages,
      lastActiveAt: userDeletionArchives.lastActiveAt,
    })
    .from(userDeletionArchives)
    .where(archivedWhere)
    .limit(USERS_FETCH_CAP);

  const merged: AdminUserRow[] = [
    ...activeRows.map((r): AdminUserRow => ({
      id: r.id,
      status: "active",
      email: r.email,
      name: r.name,
      createdAt: r.createdAt,
      deletedAt: null,
      docs: Number(r.docs),
      aiCostUsd: Number(r.aiCostUsd),
      chatMessages: Number(r.chatMessages),
      lastActiveAt: r.lastActiveAt ?? null,
    })),
    ...archivedRows.map((r): AdminUserRow => ({
      id: r.id,
      status: "deleted",
      email: r.email,
      name: r.name,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      docs: Number(r.docs ?? 0),
      aiCostUsd: Number(r.aiCostUsd ?? 0),
      chatMessages: Number(r.chatMessages ?? 0),
      lastActiveAt: r.lastActiveAt ?? null,
    })),
  ];

  const dirMul = dir === "asc" ? 1 : -1;
  merged.sort((a, b) => {
    const av = a[sort];
    const bv = b[sort];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av instanceof Date && bv instanceof Date) return dirMul * (av.getTime() - bv.getTime());
    if (typeof av === "number" && typeof bv === "number") return dirMul * (av - bv);
    return dirMul * String(av).localeCompare(String(bv));
  });

  const totalMatching = merged.length;
  const start = (page - 1) * USERS_PAGE_SIZE;
  const rows = merged.slice(start, start + USERS_PAGE_SIZE);

  return { rows, page, pageSize: USERS_PAGE_SIZE, totalMatching };
}
