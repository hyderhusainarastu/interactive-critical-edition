import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { bibliographicRecords } from "./citationsGraph";
import { learningResources } from "./conceptsIdentity";
import { masterySourceEnum } from "./enums";
import { works } from "./works";

/**
 * Phase 5 scope: reading roadmap + knowledge profile (plan §7/§13).
 *
 * The roadmap itself is computed on demand (a graph traversal over
 * `graphEdges` + a ranking pass — fast, no AI), NOT stored as a snapshot:
 * a persisted `reading_roadmaps`/`roadmap_items` pair (plan §9's literal
 * shape) would drift the moment analysis re-runs or a rating changes. So
 * only the durable, user-authored state lives here — the knowledge
 * profile (`readingRecords`, `understandingRatings`) and manual roadmap
 * adjustments (`roadmapOverrides`) — and the roadmap is recomputed from
 * those each request (recalculation-respects-overrides falls out for
 * free). A recorded deviation from plan §9, same spirit as prior phases.
 *
 * A "target" throughout is either the user's own uploaded `work` or a
 * referenced `bibliographicRecord` (a recommended reading not necessarily
 * in the library) — exactly one of the two id columns is set on each row.
 */

export const readingStatusEnum = pgEnum("reading_status", [
  "planned",
  "reading",
  "completed",
  "abandoned",
]);

// plan §13 priority tiers, in ranked order (essential highest).
export const priorityTierEnum = pgEnum("priority_tier", [
  "essential",
  "high",
  "strongly_recommended",
  "contextual",
  "interpretive_aid",
  "comparative",
  "optional",
]);

export const readingRecords = pgTable("reading_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
  bibId: uuid("bib_id").references(() => bibliographicRecords.id, { onDelete: "cascade" }),
  // Third polymorphic target (plan §34.4 9.5): a Library item that is neither
  // the reader's own upload nor a scholarly bibliographic record (a video, a
  // blog post, a lecture). Exactly one of the three is ever set — enforced
  // below by a DB CHECK, not just convention, same precedent as
  // `passage_annotation`'s anchor-or-whole-work constraint.
  learningResourceId: uuid("learning_resource_id").references((): AnyPgColumn => learningResources.id, { onDelete: "cascade" }),
  status: readingStatusEnum("status").notNull().default("planned"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("reading_record_user_idx").on(t.userId),
  index("reading_record_learning_resource_idx").on(t.learningResourceId),
  check(
    "reading_record_exactly_one_target",
    sql`(
      (case when ${t.workId} is null then 0 else 1 end) +
      (case when ${t.bibId} is null then 0 else 1 end) +
      (case when ${t.learningResourceId} is null then 0 else 1 end)
    ) = 1`,
  ),
]);

export const understandingRatings = pgTable("understanding_rating", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
  bibId: uuid("bib_id").references(() => bibliographicRecords.id, { onDelete: "cascade" }),
  // Third polymorphic target (plan §34.4 9.5) — see `readingRecords` above.
  learningResourceId: uuid("learning_resource_id").references((): AnyPgColumn => learningResources.id, { onDelete: "cascade" }),
  // 0..100 with a derived label in the UI (plan §7). >= 60 = "working
  // understanding" → the roadmap deprioritizes it (personalization pass).
  score: integer("score").notNull(),
  // Sub-phase 22.9b (plan §3.2/§3.6): reuses `mastery_source` (declared
  // below, forward-referenced the same way `learningResources` is above) so
  // a chat-inferred rating is precedence-guarded exactly like
  // `concept_mastery.source` — a NOT NULL DEFAULT keeps this additive: every
  // pre-existing row is truthfully backfilled as `explicit` (every writer
  // that existed before this column was a real user action).
  source: masterySourceEnum("source").notNull().default("explicit"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("understanding_rating_user_idx").on(t.userId),
  index("understanding_rating_learning_resource_idx").on(t.learningResourceId),
  check(
    "understanding_rating_exactly_one_target",
    sql`(
      (case when ${t.workId} is null then 0 else 1 end) +
      (case when ${t.bibId} is null then 0 else 1 end) +
      (case when ${t.learningResourceId} is null then 0 else 1 end)
    ) = 1`,
  ),
]);

/**
 * Per-user, per-root-work manual adjustments applied on top of the
 * computed roadmap (plan §13 step 7): hide an item, pin it to a tier, or
 * reorder it. `manualTier`/`manualPosition` are null unless the user set
 * them. A row can also represent a manually *added* target that the auto
 * roadmap didn't surface (`addedManually`).
 */
export const roadmapOverrides = pgTable("roadmap_override", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rootWorkId: uuid("root_work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  bibId: uuid("bib_id")
    .notNull()
    .references(() => bibliographicRecords.id, { onDelete: "cascade" }),
  hidden: boolean("hidden").notNull().default(false),
  manualTier: priorityTierEnum("manual_tier"),
  manualPosition: integer("manual_position"),
  addedManually: boolean("added_manually").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("roadmap_override_root_idx").on(t.userId, t.rootWorkId)]);
