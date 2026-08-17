import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { deletionCleanupStatusEnum, feedbackCategoryEnum, usageEventTypeEnum } from "./enums";

/**
 * Fixed-window per-user API counters. Feature-gated routes use these as the
 * shared limiter across server instances; callers retain a small in-process
 * fallback only while an older production database has not received this
 * additive migration yet.
 */
export const apiRateLimits = pgTable(
  "api_rate_limit",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    windowStartedAt: timestamp("window_started_at").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.scope] }),
    index("api_rate_limit_window_idx").on(t.windowStartedAt),
    check("api_rate_limit_count_valid", sql`${t.count} >= 0`),
  ],
);

/**
 * Phase 20.3: the durable record behind `@ice/deletion`'s permanent-deletion
 * state machine (real effects in `apps/web/src/lib/trash.ts`). One row per
 * permanently-deleted work; created BEFORE any destructive step so pending
 * Storage paths survive a crash, kept after completion as the deletion's
 * audit trail, and surfaced on the admin dashboard as the cleanup queue
 * whenever `status != completed`. `work_id` is deliberately NOT a foreign
 * key — the work row is hard-deleted mid-flow and this record must outlive
 * it (same "Postgres can't know about this" reasoning as the Storage and
 * pg-boss cleanup entries in the project log, made durable this time).
 */
export const deletionCleanups = pgTable(
  "deletion_cleanup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id").notNull(),
    /** Retained so the admin queue can still name the work after its row is gone. */
    workTitle: text("work_title").notNull(),
    status: deletionCleanupStatusEnum("status").notNull().default("in_progress"),
    /** Private Storage object paths not yet confirmed deleted. */
    pendingStoragePaths: jsonb("pending_storage_paths").notNull().default(sql`'[]'::jsonb`),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Bounded per-stage log (`@ice/deletion`'s STAGE_LOG_LIMIT). */
    stageLog: jsonb("stage_log").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("deletion_cleanup_work_unique").on(t.workId),
    index("deletion_cleanup_user_idx").on(t.userId),
    index("deletion_cleanup_status_idx").on(t.status),
  ],
);

/**
 * Workstream G (v.5): a durable, privacy-page-promised snapshot written
 * BEFORE any destructive step of account deletion (see
 * `apps/web/src/lib/accountDeletion.ts`). `userId` is deliberately NOT a
 * foreign key — the user row is hard-deleted by the flow this row records,
 * and the archive must outlive it, same reasoning as `deletion_cleanup.workId`
 * above. The unique index on `userId` makes the archive-upsert idempotent, so
 * a retried deletion attempt (e.g. after the storage-abort gate below) never
 * produces duplicate archive rows.
 */
export const userDeletionArchives = pgTable(
  "user_deletion_archive",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    userCreatedAt: timestamp("user_created_at").notNull(),
    deletedAt: timestamp("deleted_at").notNull().defaultNow(),
    /** Best-effort aggregates computed just before destruction; see the
     * accountDeletion.ts doc comment for the known ai_usage_log undercount
     * caveat (no user_id column on that table). */
    docsProcessed: integer("docs_processed"),
    totalAiCostUsd: real("total_ai_cost_usd"),
    chatMessages: integer("chat_messages"),
    lastActiveAt: timestamp("last_active_at"),
    readerLevel: text("reader_level"),
    dataSharingWasEnabled: boolean("data_sharing_was_enabled"),
  },
  (t) => [
    uniqueIndex("user_deletion_archive_user_unique").on(t.userId),
    index("user_deletion_archive_deleted_at_idx").on(t.deletedAt),
  ],
);

export const usageEvents = pgTable(
  "usage_event",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id").notNull(),
    eventType: usageEventTypeEnum("event_type").notNull(),
    path: text("path"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("usage_event_user_created_idx").on(t.userId, t.createdAt),
    index("usage_event_type_created_idx").on(t.eventType, t.createdAt),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email"),
    category: feedbackCategoryEnum("category").notNull(),
    body: text("body").notNull(),
    path: text("path"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    readAt: timestamp("read_at"),
  },
  (t) => [
    index("feedback_created_at_idx").on(t.createdAt),
    check("feedback_body_length", sql`char_length(${t.body}) <= 10000`),
  ],
);
