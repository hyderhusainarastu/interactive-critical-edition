import { db, researchProjectMembers, researchProjects } from "@ice/db";
import { and, eq } from "drizzle-orm";

/** Ownership check for the optional `projectId` scope field — a research
 *  project is user-scoped, so importing into someone else's project must
 *  fail loudly rather than silently succeed against the wrong project. */
export async function userOwnsResearchProject(userId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: researchProjects.id })
    .from(researchProjects)
    .where(and(eq(researchProjects.id, projectId), eq(researchProjects.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** Links a corpus item into a project as a `corpus_item` member, respecting
 *  the `(project_id, corpus_item_id)` unique index. Returns whether a new
 *  membership row was actually created (false = already a member — an
 *  honest "already linked" outcome, not an error). */
export async function linkCorpusItemToProject(projectId: string, corpusItemId: string): Promise<boolean> {
  const [inserted] = await db
    .insert(researchProjectMembers)
    .values({ projectId, memberType: "corpus_item", corpusItemId })
    .onConflictDoNothing({ target: [researchProjectMembers.projectId, researchProjectMembers.corpusItemId] })
    .returning({ id: researchProjectMembers.id });
  return Boolean(inserted);
}

// ---------------------------------------------------------------------------
// detect_relationships scope (Phase 26.2a).
// ---------------------------------------------------------------------------

export interface ResearchProjectRow {
  id: string;
  userId: string;
}

/** Owner-scoped project lookup — the predicate that keeps every read below
 *  it (work members, claims) inside the requesting user's own data. */
export async function loadResearchProjectForUser(projectId: string, userId: string): Promise<ResearchProjectRow | null> {
  const [row] = await db
    .select({ id: researchProjects.id, userId: researchProjects.userId })
    .from(researchProjects)
    .where(and(eq(researchProjects.id, projectId), eq(researchProjects.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Every `work`-typed member of a project, regardless of role
 *  (central/supporting/background) — unlike extraction's role-gated
 *  trigger, relationship detection scopes over every claim already
 *  extracted for any member work. See `loadProjectCorpusItemIds` below for
 *  the corpus-item-member sibling this is always called alongside now
 *  (Phase 30 fix lane, D-25-13). */
export async function loadProjectWorkIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ workId: researchProjectMembers.workId })
    .from(researchProjectMembers)
    .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.memberType, "work")));
  return rows.map((r) => r.workId).filter((id): id is string => id !== null);
}

/** Every `corpus_item`-typed member of a project — the corpus-item half of
 *  `detectRelationships.ts`'s retrieval/engagement scope, alongside
 *  `loadProjectWorkIds` above. */
export async function loadProjectCorpusItemIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ corpusItemId: researchProjectMembers.corpusItemId })
    .from(researchProjectMembers)
    .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.memberType, "corpus_item")));
  return rows.map((r) => r.corpusItemId).filter((id): id is string => id !== null);
}
