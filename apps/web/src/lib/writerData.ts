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
import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
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

export async function saveWriterDocument(
  documentId: string,
  patch: { title?: string; content?: ProseMirrorDocument; sortOrder?: number },
  reason = "autosave",
  dbClient: DbOrTx = db,
) {
  const [current] = await dbClient.select().from(writerDocuments).where(eq(writerDocuments.id, documentId)).limit(1);
  if (!current) return null;
  const contentChanged = patch.content !== undefined && JSON.stringify(current.content) !== JSON.stringify(patch.content);
  const [updated] = await dbClient.update(writerDocuments).set({ ...patch, updatedAt: new Date() }).where(eq(writerDocuments.id, documentId)).returning();
  if (contentChanged) {
    const [last] = await dbClient.select({ revision: writerDocumentRevisions.revision }).from(writerDocumentRevisions).where(eq(writerDocumentRevisions.documentId, documentId)).orderBy(desc(writerDocumentRevisions.revision)).limit(1);
    await dbClient.insert(writerDocumentRevisions).values({ documentId, revision: (last?.revision ?? 0) + 1, content: patch.content!, reason });
    // Keep recovery intentionally bounded without deleting the initial snapshot.
    const old = await dbClient.select({ id: writerDocumentRevisions.id }).from(writerDocumentRevisions).where(eq(writerDocumentRevisions.documentId, documentId)).orderBy(desc(writerDocumentRevisions.revision)).offset(50);
    if (old.length) await dbClient.delete(writerDocumentRevisions).where(sql`${writerDocumentRevisions.id} in (${sql.join(old.map((row) => sql`${row.id}`), sql`, `)})`);
  }
  return updated;
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
