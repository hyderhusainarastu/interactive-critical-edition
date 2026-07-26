import {
  db,
  ragConversations,
  researchProjectMembers,
  researchProjectQuestions,
  researchProjects,
  works,
  writerProjects,
} from "@ice/db";
import { and, asc, desc, eq, isNull, max, sql } from "drizzle-orm";

/**
 * Research-workspace project CRUD (Phase 28.1). Every read/write here is
 * owner-scoped by `userId` as a SQL predicate — never trusted from the
 * caller — matching the rest of the app's IDOR posture: a project that
 * exists but isn't the caller's own resolves to `null`/no rows, so the
 * calling route can always answer 404 rather than a distinguishable 403.
 */

export async function getOwnedResearchProject(userId: string, projectId: string, includeArchived = false) {
  const conditions = [eq(researchProjects.id, projectId), eq(researchProjects.userId, userId)];
  if (!includeArchived) conditions.push(isNull(researchProjects.archivedAt));
  const [project] = await db.select().from(researchProjects).where(and(...conditions)).limit(1);
  return project ?? null;
}

/** The project workspace's overview payload: the project itself plus its
 *  questions (in the user's own order) and members (joined for display) —
 *  the writer-workspace `getWriterProjectWorkspace()` precedent. */
export async function getResearchProjectDetail(userId: string, projectId: string) {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return null;
  const [questions, members] = await Promise.all([
    db.select().from(researchProjectQuestions).where(eq(researchProjectQuestions.projectId, project.id)).orderBy(asc(researchProjectQuestions.sortOrder)),
    listResearchProjectMembers(project.id),
  ]);
  return { project, questions, members };
}

export async function listResearchProjects(userId: string, includeArchived = false) {
  const rows = await db
    .select({
      id: researchProjects.id,
      title: researchProjects.title,
      summary: researchProjects.summary,
      sortOrder: researchProjects.sortOrder,
      archivedAt: researchProjects.archivedAt,
      createdAt: researchProjects.createdAt,
      updatedAt: researchProjects.updatedAt,
      memberCount: sql<number>`count(distinct ${researchProjectMembers.id})::int`,
      questionCount: sql<number>`count(distinct ${researchProjectQuestions.id})::int`,
    })
    .from(researchProjects)
    .leftJoin(researchProjectMembers, eq(researchProjectMembers.projectId, researchProjects.id))
    .leftJoin(researchProjectQuestions, eq(researchProjectQuestions.projectId, researchProjects.id))
    .where(includeArchived ? eq(researchProjects.userId, userId) : and(eq(researchProjects.userId, userId), isNull(researchProjects.archivedAt)))
    .groupBy(researchProjects.id)
    .orderBy(researchProjects.sortOrder, desc(researchProjects.updatedAt));
  return rows;
}

export async function createResearchProject(userId: string, title: string, summary?: string | null) {
  const [order] = await db.select({ value: max(researchProjects.sortOrder) }).from(researchProjects).where(eq(researchProjects.userId, userId));
  const [project] = await db
    .insert(researchProjects)
    .values({ userId, title, summary: summary ?? null, sortOrder: (order?.value ?? -1) + 1 })
    .returning();
  return project;
}

export async function updateResearchProject(
  userId: string,
  projectId: string,
  patch: { title?: string; summary?: string | null; sortOrder?: number; archived?: boolean },
) {
  const existing = await getOwnedResearchProject(userId, projectId, true);
  if (!existing) return null;
  const [updated] = await db
    .update(researchProjects)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      ...(patch.archived !== undefined ? { archivedAt: patch.archived ? new Date() : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(researchProjects.id, projectId))
    .returning();
  return updated;
}

/** Soft-archive only — a research project's claims/jobs/revisions are real
 *  paid work product, so this never hard-deletes (the `work.deleted_at`
 *  trash precedent, not a cascading delete). */
export async function archiveResearchProject(userId: string, projectId: string) {
  return updateResearchProject(userId, projectId, { archived: true });
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function addResearchProjectQuestion(userId: string, projectId: string, question: string) {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return null;
  const [order] = await db.select({ value: max(researchProjectQuestions.sortOrder) }).from(researchProjectQuestions).where(eq(researchProjectQuestions.projectId, projectId));
  const [created] = await db
    .insert(researchProjectQuestions)
    .values({ projectId, question, sortOrder: (order?.value ?? -1) + 1 })
    .returning();
  return created;
}

export async function updateResearchProjectQuestion(
  userId: string,
  projectId: string,
  questionId: string,
  patch: { question?: string; sortOrder?: number },
) {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return null;
  const [updated] = await db
    .update(researchProjectQuestions)
    .set({
      ...(patch.question !== undefined ? { question: patch.question } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(researchProjectQuestions.id, questionId), eq(researchProjectQuestions.projectId, projectId)))
    .returning();
  return updated ?? null;
}

export async function deleteResearchProjectQuestion(userId: string, projectId: string, questionId: string) {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return false;
  const deleted = await db
    .delete(researchProjectQuestions)
    .where(and(eq(researchProjectQuestions.id, questionId), eq(researchProjectQuestions.projectId, projectId)))
    .returning({ id: researchProjectQuestions.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Members. Scoped to `memberType = "work"` for this lane (28.1) — corpus
// import (28.2), Writer evidence (28.5), and Ask Library conversation
// members (28.6) each add their own member type once THAT surface ships;
// the schema/DB layer already supports all four (`research_project_member`),
// this lane's UI/API surface is deliberately just the work-add flow the
// plan's route map describes ("an add-work selector from the user's
// library").
// ---------------------------------------------------------------------------

export interface ResearchProjectMemberRow {
  id: string;
  memberType: string;
  role: string;
  workId: string | null;
  workTitle: string | null;
  workAuthorName: string | null;
  corpusItemId: string | null;
  writerProjectId: string | null;
  writerProjectTitle: string | null;
  ragConversationId: string | null;
  ragConversationTitle: string | null;
  createdAt: Date;
}

export async function listResearchProjectMembers(projectId: string): Promise<ResearchProjectMemberRow[]> {
  const rows = await db
    .select({
      id: researchProjectMembers.id,
      memberType: researchProjectMembers.memberType,
      role: researchProjectMembers.role,
      workId: researchProjectMembers.workId,
      workTitle: works.title,
      workAuthorName: works.authorName,
      corpusItemId: researchProjectMembers.corpusItemId,
      writerProjectId: researchProjectMembers.writerProjectId,
      writerProjectTitle: writerProjects.title,
      ragConversationId: researchProjectMembers.ragConversationId,
      ragConversationTitle: ragConversations.title,
      createdAt: researchProjectMembers.createdAt,
    })
    .from(researchProjectMembers)
    .leftJoin(works, eq(works.id, researchProjectMembers.workId))
    .leftJoin(writerProjects, eq(writerProjects.id, researchProjectMembers.writerProjectId))
    .leftJoin(ragConversations, eq(ragConversations.id, researchProjectMembers.ragConversationId))
    .where(eq(researchProjectMembers.projectId, projectId))
    .orderBy(asc(researchProjectMembers.createdAt));
  return rows;
}

/** Adds an owned work as a project member. `workId` is checked against the
 *  caller's own untrashed works (not just any uuid) before insert — the
 *  same ownership discipline as every other cross-table write in this
 *  package. Returns `"not_found"` when the project or work isn't the
 *  caller's own, or the created row. */
export async function addResearchProjectWorkMember(
  userId: string,
  projectId: string,
  workId: string,
  role: "central" | "supporting" | "background" = "supporting",
): Promise<ResearchProjectMemberRow | "not_found"> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return "not_found";
  const [work] = await db.select({ id: works.id }).from(works).where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt))).limit(1);
  if (!work) return "not_found";
  const [created] = await db
    .insert(researchProjectMembers)
    .values({ projectId, memberType: "work", workId, role })
    .onConflictDoNothing({ target: [researchProjectMembers.projectId, researchProjectMembers.workId] })
    .returning({ id: researchProjectMembers.id });
  const members = await listResearchProjectMembers(projectId);
  if (!created?.id) {
    // Already a member (onConflictDoNothing fired) — return the existing
    // row rather than erroring, so a repeat "Add" click is idempotent from
    // the caller's point of view.
    return members.find((m) => m.workId === workId) ?? "not_found";
  }
  return members.find((m) => m.id === created.id) ?? "not_found";
}

export async function removeResearchProjectMember(userId: string, projectId: string, memberId: string): Promise<boolean> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return false;
  const deleted = await db
    .delete(researchProjectMembers)
    .where(and(eq(researchProjectMembers.id, memberId), eq(researchProjectMembers.projectId, projectId)))
    .returning({ id: researchProjectMembers.id });
  return deleted.length > 0;
}

/** For the project-detail "add work" selector: the caller's own untrashed
 *  works, title/author only — the same minimal shape Writer's Library-source
 *  picker uses. */
export async function listOwnedWorksForResearch(userId: string) {
  return db
    .select({ id: works.id, title: works.title, authorName: works.authorName })
    .from(works)
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)))
    .orderBy(asc(works.title));
}
