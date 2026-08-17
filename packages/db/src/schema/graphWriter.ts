import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { researchClaims } from "./researchClaims";
import { works } from "./works";

export const graphExpansionStatusEnum = pgEnum("graph_expansion_status", [
  "planned",
  "queued",
  "running",
  "complete",
  "failed",
]);

/**
 * An auditable, idempotent graph-expansion request. Automatic upload work
 * creates a <=$0.25 request; manual work records the shown estimate and the
 * required explicit confirmation once it is above $1. The worker never
 * trusts client-supplied candidate counts or budget values.
 */
export const graphExpansionRequests = pgTable(
  "graph_expansion_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceWorkId: uuid("source_work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(), // automatic | manual
    requestedCandidates: integer("requested_candidates").notNull(),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    hardCapUsd: real("hard_cap_usd").notNull().default(5),
    confirmedAt: timestamp("confirmed_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: graphExpansionStatusEnum("status").notNull().default("planned"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("graph_expansion_request_user_idx").on(t.userId, t.createdAt),
    index("graph_expansion_request_source_idx").on(t.sourceWorkId),
    uniqueIndex("graph_expansion_request_idempotency_unique").on(t.userId, t.idempotencyKey),
    check("graph_expansion_request_count_valid", sql`${t.requestedCandidates} > 0 AND ${t.requestedCandidates} <= 100`),
    check("graph_expansion_request_cap_valid", sql`${t.estimatedCostUsd} >= 0 AND ${t.hardCapUsd} > 0 AND ${t.hardCapUsd} <= 5`),
  ],
);

/**
 * Private writing workspaces (Phase 12.6). A project is owned directly by a
 * user; documents, revision snapshots and citations are deliberately nested
 * beneath it so no writer API can ever grant access by a document UUID alone.
 * The content column holds canonical ProseMirror JSON, not rendered HTML.
 */
export const writerProjects = pgTable(
  "writer_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_project_user_archived_idx").on(t.userId, t.archivedAt, t.sortOrder),
  ],
);

export const writerDocuments = pgTable(
  "writer_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => writerProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Canonical, portable ProseMirror `doc` JSON. */
    content: jsonb("content").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_document_project_archived_idx").on(t.projectId, t.archivedAt, t.sortOrder),
  ],
);

/** Immutable snapshots used for local autosave recovery and deliberate restore. */
export const writerDocumentRevisions = pgTable(
  "writer_document_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => writerDocuments.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    content: jsonb("content").notNull(),
    reason: text("reason").notNull().default("autosave"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_document_revision_document_idx").on(t.documentId, t.revision),
    uniqueIndex("writer_document_revision_unique").on(t.documentId, t.revision),
  ],
);

/** A project-scoped CSL-JSON source; key normalizes duplicates without losing provenance. */
export const writerCitations = pgTable(
  "writer_citation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => writerProjects.id, { onDelete: "cascade" }),
    normalizedKey: text("normalized_key").notNull(),
    cslJson: jsonb("csl_json").notNull(),
    source: text("source").notNull(),
    /** Phase 28.6 (migration 0044, for the sibling Phase 28.5 Writer-evidence
     *  lane): optional link back to the `research_claim` this citation's
     *  evidence-panel insertion came from. `SET NULL` on delete — a claim
     *  can be removed/superseded without invalidating the writer's own
     *  citation record, matching `passage_annotation.related_resource_id`'s
     *  "the citation survives; only its extra provenance link is cleared"
     *  precedent. Nothing in THIS lane writes to this column. */
    researchClaimId: uuid("research_claim_id").references(() => researchClaims.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_citation_project_idx").on(t.projectId),
    uniqueIndex("writer_citation_project_key_unique").on(t.projectId, t.normalizedKey),
    index("writer_citation_research_claim_idx").on(t.researchClaimId),
  ],
);
