import {
  db,
  learningResources,
  resourceRoles,
  workIdentities,
  works,
  writerCitations,
  writerDocumentRevisions,
  writerDocuments,
  writerProjects,
} from "@ice/db";
import { and, desc, eq, isNull, max, sql, type SQL } from "drizzle-orm";
import { citationKey, type CslJson, emptyWriterDocument, type ProseMirrorDocument } from "./writer";

/** Accepts either the top-level `db` or a `db.transaction()` callback's `tx`
 *  — lets a caller (e.g. `lib/research/writerEvidence.ts`'s evidence insert)
 *  compose this module's writes into its own transaction, while every
 *  existing call site keeps working unchanged via the default `db`. */
type DbOrTx = typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export async function getOwnedWriterProject(userId: string, projectId: string, includeArchived = false) {
  const conditions = [eq(writerProjects.id, projectId), eq(writerProjects.userId, userId)];
  if (!includeArchived) conditions.push(isNull(writerProjects.archivedAt));
  const [project] = await db.select().from(writerProjects).where(and(...conditions)).limit(1);
  return project ?? null;
}

export async function listWriterProjects(userId: string, includeArchived = false) {
  const rows = await db
    .select({
      id: writerProjects.id,
      title: writerProjects.title,
      sortOrder: writerProjects.sortOrder,
      archivedAt: writerProjects.archivedAt,
      updatedAt: writerProjects.updatedAt,
      documentCount: sql<number>`count(${writerDocuments.id})::int`,
    })
    .from(writerProjects)
    .leftJoin(writerDocuments, and(eq(writerDocuments.projectId, writerProjects.id), isNull(writerDocuments.archivedAt)))
    .where(includeArchived ? eq(writerProjects.userId, userId) : and(eq(writerProjects.userId, userId), isNull(writerProjects.archivedAt)))
    .groupBy(writerProjects.id)
    .orderBy(writerProjects.sortOrder, desc(writerProjects.updatedAt));
  return rows;
}

export async function getWriterProjectWorkspace(userId: string, projectId: string) {
  const project = await getOwnedWriterProject(userId, projectId);
  if (!project) return null;
  const [documents, citations] = await Promise.all([
    db.select().from(writerDocuments).where(and(eq(writerDocuments.projectId, project.id), isNull(writerDocuments.archivedAt))).orderBy(writerDocuments.sortOrder, writerDocuments.createdAt),
    db.select().from(writerCitations).where(eq(writerCitations.projectId, project.id)).orderBy(writerCitations.createdAt),
  ]);
  return { project, documents, citations };
}

export async function createWriterProject(userId: string, title: string) {
  const [order] = await db.select({ value: max(writerProjects.sortOrder) }).from(writerProjects).where(eq(writerProjects.userId, userId));
  const [project] = await db.insert(writerProjects).values({ userId, title, sortOrder: (order?.value ?? -1) + 1 }).returning();
  const [document] = await db.insert(writerDocuments).values({ projectId: project.id, title: "Untitled document", content: emptyWriterDocument(), sortOrder: 0 }).returning();
  await db.insert(writerDocumentRevisions).values({ documentId: document.id, revision: 1, content: document.content, reason: "created" });
  return { project, document };
}

/**
 * Home surface's fourth evidence card (stage4-read-spec.md §1.2 item 4,
 * §1.3): the most recently updated non-archived `writer_document` this user
 * owns. Ownership is a real join through `writer_project` — `writer_document`
 * itself carries no `user_id` (see the schema's own shape) — never inferred
 * from a caller-supplied id alone, matching the owner-scoping discipline
 * `lib/research/claims.ts` documents for its own domain. Both the document
 * and its owning project are excluded once either is archived, since an
 * archived project's documents aren't a "latest draft" worth resuming.
 */
export interface LatestWriterDraft {
  projectId: string;
  projectTitle: string;
  documentTitle: string;
  updatedAt: Date;
}

export async function getLatestWriterDraft(userId: string): Promise<LatestWriterDraft | null> {
  const [row] = await db
    .select({
      projectId: writerProjects.id,
      projectTitle: writerProjects.title,
      documentTitle: writerDocuments.title,
      updatedAt: writerDocuments.updatedAt,
    })
    .from(writerDocuments)
    .innerJoin(writerProjects, eq(writerProjects.id, writerDocuments.projectId))
    .where(and(eq(writerProjects.userId, userId), isNull(writerProjects.archivedAt), isNull(writerDocuments.archivedAt)))
    .orderBy(desc(writerDocuments.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function createWriterDocument(projectId: string, title: string) {
  const [order] = await db.select({ value: max(writerDocuments.sortOrder) }).from(writerDocuments).where(eq(writerDocuments.projectId, projectId));
  const [document] = await db.insert(writerDocuments).values({ projectId, title, content: emptyWriterDocument(), sortOrder: (order?.value ?? -1) + 1 }).returning();
  await db.insert(writerDocumentRevisions).values({ documentId: document.id, revision: 1, content: document.content, reason: "created" });
  return document;
}

export async function getOwnedWriterDocument(userId: string, projectId: string, documentId: string) {
  const [document] = await db
    .select({ document: writerDocuments, project: writerProjects })
    .from(writerDocuments)
    .innerJoin(writerProjects, eq(writerDocuments.projectId, writerProjects.id))
    .where(and(eq(writerDocuments.id, documentId), eq(writerDocuments.projectId, projectId), eq(writerProjects.userId, userId), isNull(writerProjects.archivedAt), isNull(writerDocuments.archivedAt)))
    .limit(1);
  return document ?? null;
}

/** Shared write body for `saveWriterDocument`/`saveWriterDocumentIfCurrent`
 *  below — takes the already-fetched `current` row (needed for the
 *  content-changed comparison) and the caller's own `updateWhere` so the
 *  revision-insert/pruning logic lives in exactly one place. */
async function writeWriterDocument(
  documentId: string,
  patch: { title?: string; content?: ProseMirrorDocument; sortOrder?: number },
  reason: string,
  dbClient: DbOrTx,
  current: { content: unknown; updatedAt: Date },
  updateWhere: SQL,
) {
  const contentChanged = patch.content !== undefined && JSON.stringify(current.content) !== JSON.stringify(patch.content);
  // PostgreSQL's `timestamp` retains microseconds while JavaScript `Date`
  // (and therefore the HTTP version token) only retains milliseconds. Keep
  // every post-save token both representable by the client and strictly
  // newer than the prior one, even when two writes land in one millisecond.
  const updatedAt = new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1));
  const [updated] = await dbClient.update(writerDocuments).set({ ...patch, updatedAt }).where(updateWhere).returning();
  if (updated && contentChanged) {
    const [last] = await dbClient.select({ revision: writerDocumentRevisions.revision }).from(writerDocumentRevisions).where(eq(writerDocumentRevisions.documentId, documentId)).orderBy(desc(writerDocumentRevisions.revision)).limit(1);
    await dbClient.insert(writerDocumentRevisions).values({ documentId, revision: (last?.revision ?? 0) + 1, content: patch.content!, reason });
    // Keep recovery intentionally bounded without deleting the initial snapshot.
    const old = await dbClient.select({ id: writerDocumentRevisions.id }).from(writerDocumentRevisions).where(eq(writerDocumentRevisions.documentId, documentId)).orderBy(desc(writerDocumentRevisions.revision)).offset(50);
    if (old.length) await dbClient.delete(writerDocumentRevisions).where(sql`${writerDocumentRevisions.id} in (${sql.join(old.map((row) => sql`${row.id}`), sql`, `)})`);
  }
  return updated;
}

export async function saveWriterDocument(
  documentId: string,
  patch: { title?: string; content?: ProseMirrorDocument; sortOrder?: number },
  reason = "autosave",
  dbClient: DbOrTx = db,
) {
  // All mutations share this lock, including revision restore and evidence
  // insertion. Without it, an unconditional mutation could land in the same
  // millisecond as an optimistic one and reuse its client-visible token.
  return dbClient.transaction(async (tx) => {
    const [current] = await tx.select().from(writerDocuments).where(eq(writerDocuments.id, documentId)).limit(1).for("update");
    if (!current) return null;
    return writeWriterDocument(documentId, patch, reason, tx, current, eq(writerDocuments.id, documentId));
  });
}

export type SaveWriterDocumentIfCurrentResult =
  | { status: "not_found" }
  | { status: "conflict"; latest: Awaited<ReturnType<typeof saveWriterDocument>> }
  | { status: "ok"; document: NonNullable<Awaited<ReturnType<typeof saveWriterDocument>>> };

/**
 * Stage 6 spec §4.3's flagged follow-up, now implemented: an additive
 * optimistic-concurrency wrapper, kept entirely separate from
 * `saveWriterDocument` above rather than folding a conflict branch into it,
 * so that function's two other, unrelated callers
 * (`restoreWriterDocumentRevision`, `writerEvidence.ts`'s evidence insert)
 * keep their exact existing `WriterDocument | null` return shape — neither
 * passes `expectedUpdatedAt`, so widening `saveWriterDocument`'s own return
 * type to include a conflict branch would have made both type-check against
 * a shape they never actually produce.
 *
 * When `expectedUpdatedAt` is `undefined` (no caller today omits it, since
 * the one call site — the PATCH route — always forwards whatever the client
 * sent, including `undefined` for an older/non-conflict-aware client), this
 * behaves byte-for-byte like calling `saveWriterDocument` directly: no
 * extra query, no possibility of a `"conflict"` result. When it IS provided,
 * the current row is locked in a transaction before the version comparison
 * and write. This closes the TOCTOU window without comparing a JavaScript
 * millisecond value to PostgreSQL's potentially-microsecond `timestamp`.
 * The write also advances `updatedAt` monotonically at millisecond precision,
 * so every server-visible revision has a distinct client-safe token.
 */
export async function saveWriterDocumentIfCurrent(
  documentId: string,
  patch: { title?: string; content?: ProseMirrorDocument; sortOrder?: number },
  reason: string,
  expectedUpdatedAt: string | undefined,
  dbClient: DbOrTx = db,
): Promise<SaveWriterDocumentIfCurrentResult> {
  if (expectedUpdatedAt === undefined) {
    const updated = await saveWriterDocument(documentId, patch, reason, dbClient);
    return updated ? { status: "ok", document: updated } : { status: "not_found" };
  }

  return dbClient.transaction(async (tx) => {
    // The lock is held through both the token comparison and UPDATE. A second
    // writer waits here, then sees the first writer's new token and receives a
    // genuine 409 instead of silently overwriting it.
    const [current] = await tx.select().from(writerDocuments).where(eq(writerDocuments.id, documentId)).limit(1).for("update");
    if (!current) return { status: "not_found" } as const;
    if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
      return { status: "conflict", latest: current } as const;
    }
    const updated = await writeWriterDocument(documentId, patch, reason, tx, current, eq(writerDocuments.id, documentId));
    // A locked row cannot disappear or miss its id-only update; retain this
    // defensive fallback in case the database adapter reports otherwise.
    if (updated) return { status: "ok", document: updated } as const;
    const [latest] = await tx.select().from(writerDocuments).where(eq(writerDocuments.id, documentId)).limit(1);
    return latest ? { status: "conflict", latest } as const : { status: "not_found" } as const;
  });
}

export async function listWriterDocumentRevisions(documentId: string) {
  return db.select({ id: writerDocumentRevisions.id, revision: writerDocumentRevisions.revision, reason: writerDocumentRevisions.reason, createdAt: writerDocumentRevisions.createdAt }).from(writerDocumentRevisions).where(eq(writerDocumentRevisions.documentId, documentId)).orderBy(desc(writerDocumentRevisions.revision));
}

export async function restoreWriterDocumentRevision(documentId: string, revisionId: string) {
  const [revision] = await db.select().from(writerDocumentRevisions).where(and(eq(writerDocumentRevisions.id, revisionId), eq(writerDocumentRevisions.documentId, documentId))).limit(1);
  if (!revision) return null;
  return saveWriterDocument(documentId, { content: revision.content as ProseMirrorDocument }, "revision_restore");
}

export async function addWriterCitation(projectId: string, citation: CslJson, source: string, dbClient: DbOrTx = db) {
  const normalizedKey = citationKey(citation);
  const [created] = await dbClient
    .insert(writerCitations)
    .values({ projectId, normalizedKey, cslJson: citation, source })
    .onConflictDoNothing({ target: [writerCitations.projectId, writerCitations.normalizedKey] })
    .returning();
  if (created) return created;
  const [existing] = await dbClient.select().from(writerCitations).where(and(eq(writerCitations.projectId, projectId), eq(writerCitations.normalizedKey, normalizedKey))).limit(1);
  return existing ?? null;
}

/** Library sources are scoped through the caller's untrashed works. */
export async function listOwnedLibrarySources(userId: string) {
  const rows = await db
    .selectDistinct({
      id: learningResources.id,
      title: learningResources.title,
      url: learningResources.url,
      doi: learningResources.doi,
      isbn: learningResources.isbn,
      year: learningResources.year,
      authors: learningResources.authors,
      venue: learningResources.venue,
      publisher: learningResources.provider,
      workId: works.id,
      workTitle: works.title,
    })
    .from(works)
    .innerJoin(workIdentities, eq(works.workIdentityId, workIdentities.id))
    .innerJoin(resourceRoles, eq(resourceRoles.workIdentityId, workIdentities.id))
    .innerJoin(learningResources, eq(learningResources.id, resourceRoles.learningResourceId))
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(learningResources.title);
  return rows;
}

export async function getOwnedLibraryCitation(userId: string, resourceId: string): Promise<CslJson | null> {
  const source = (await listOwnedLibrarySources(userId)).find((row) => row.id === resourceId);
  if (!source) return null;
  return {
    type: "webpage",
    title: source.title,
    ...(Array.isArray(source.authors) ? { author: source.authors as CslJson["author"] } : {}),
    ...(source.year ? { issued: { "date-parts": [[source.year]] } } : {}),
    ...(source.doi ? { DOI: source.doi } : {}),
    ...(source.isbn ? { ISBN: source.isbn } : {}),
    ...(source.url ? { URL: source.url } : {}),
    ...(source.venue ? { "container-title": source.venue } : {}),
  };
}
