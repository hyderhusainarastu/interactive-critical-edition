import {
  db,
  researchClaims,
  researchCorpusItems,
  researchProjectMembers,
  researchProjects,
  works,
  writerCitations,
} from "@ice/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  buildCslFromCorpusItemFields,
  buildCslFromWorkBibliographicFields,
  buildEvidenceBlockquote,
  buildEvidenceMarker,
  type CslJson,
  type ProseMirrorBlock,
  type ProseMirrorDocument,
} from "@/lib/writer";
import { addWriterCitation, getOwnedWriterDocument, getOwnedWriterProject, saveWriterDocument } from "@/lib/writerData";
import { listDebateClustersForProject, type DebateClusterListRow } from "./debates";
import { listEvidenceChambersForProject, type EvidenceChamberSummaryRow } from "./chambers";
import { listResearchClaims, type ResearchClaimListRow } from "./claims";
import { getOwnedResearchProject } from "./projects";

/**
 * Phase 28.5 (Writer evidence insertion): the DB orchestration layer over
 * the pure helpers in `lib/writer.ts` — matching this codebase's standing
 * "pure logic split from DB traversal" precedent (`@ice/roadmap` vs
 * `lib/roadmap.ts`, `docs/PROJECT-LOG.md` Design Decisions). Everything here
 * is owner-scoped by `userId` as a SQL predicate, the `lib/research/*` house
 * rule.
 */

export interface LinkedResearchProject {
  id: string;
  title: string;
}

/** `regexp_replace(lower(x), '[^a-z0-9]', '', 'g')` — the exact `NORM`
 *  precedent `lib/research/chambers.ts`'s `loadPositionSourceCredibility`
 *  already uses for the identical "does this owned work also turn up as a
 *  researched bibliographic record" self-match. */
const NORM = (column: string) => sql.raw(`regexp_replace(lower(${column}), '[^a-z0-9]', '', 'g')`);

// ---------------------------------------------------------------------------
// Project linking (Writer <-> Research). A writer project may technically be
// linked to more than one research project over time (the schema allows it,
// same as a work can belong to several); the Evidence panel only ever shows
// ONE, the most recently linked, matching the single "Link to research
// project" affordance the Writer UI exposes.
// ---------------------------------------------------------------------------

export async function getLinkedResearchProject(userId: string, writerProjectId: string): Promise<LinkedResearchProject | null> {
  const [row] = await db
    .select({ id: researchProjects.id, title: researchProjects.title })
    .from(researchProjectMembers)
    .innerJoin(researchProjects, eq(researchProjects.id, researchProjectMembers.projectId))
    .where(
      and(
        eq(researchProjectMembers.writerProjectId, writerProjectId),
        eq(researchProjectMembers.memberType, "writer_project"),
        eq(researchProjects.userId, userId),
      ),
    )
    .orderBy(desc(researchProjectMembers.createdAt))
    .limit(1);
  return row ?? null;
}

/** Both sides owner-checked before the link is written — a research project
 *  or writer project that exists but isn't the caller's own resolves to
 *  `"not_found"`, never a distinguishable 403 (the standing IDOR posture). */
export async function linkWriterProjectToResearchProject(
  userId: string,
  writerProjectId: string,
  researchProjectId: string,
): Promise<LinkedResearchProject | "not_found"> {
  const writerProject = await getOwnedWriterProject(userId, writerProjectId, true);
  if (!writerProject) return "not_found";
  const researchProject = await getOwnedResearchProject(userId, researchProjectId, true);
  if (!researchProject) return "not_found";
  await db
    .insert(researchProjectMembers)
    .values({ projectId: researchProjectId, memberType: "writer_project", writerProjectId, role: "supporting" })
    .onConflictDoNothing({ target: [researchProjectMembers.projectId, researchProjectMembers.writerProjectId] });
  return { id: researchProject.id, title: researchProject.title };
}

/** Removes every `writer_project` membership row for this writer project —
 *  i.e. "unlink the current link" in the panel's single-link model, not a
 *  per-research-project toggle. */
export async function unlinkWriterProjectFromResearchProject(userId: string, writerProjectId: string): Promise<boolean> {
  const writerProject = await getOwnedWriterProject(userId, writerProjectId, true);
  if (!writerProject) return false;
  const deleted = await db
    .delete(researchProjectMembers)
    .where(and(eq(researchProjectMembers.writerProjectId, writerProjectId), eq(researchProjectMembers.memberType, "writer_project")))
    .returning({ id: researchProjectMembers.id });
  return deleted.length > 0;
}

// ---------------------------------------------------------------------------
// Evidence panel reads
// ---------------------------------------------------------------------------

export interface WriterEvidenceView {
  researchProject: LinkedResearchProject;
  claims: ResearchClaimListRow[];
  debateClusters: DebateClusterListRow[];
  chambers: EvidenceChamberSummaryRow[];
}

/** The Evidence panel's full read: the linked project's non-rejected,
 *  non-hidden claims (filterable by work/nature), debate clusters, and
 *  chambers. Returns `"not_found"` when the writer project isn't the
 *  caller's own (the standing no-distinguishable-403 IDOR posture — the
 *  route answers 404) and `null` when it IS the caller's own but has no
 *  linked research project yet — an ordinary empty state, not an error, so
 *  the panel can render its own "Link a research project" prompt. */
export async function getWriterEvidenceView(
  userId: string,
  writerProjectId: string,
  filters: { workId?: string; claimNature?: string } = {},
): Promise<WriterEvidenceView | null | "not_found"> {
  const writerProject = await getOwnedWriterProject(userId, writerProjectId, true);
  if (!writerProject) return "not_found";
  const linked = await getLinkedResearchProject(userId, writerProjectId);
  if (!linked) return null;

  const [{ claims: allClaims }, clusters, chambers] = await Promise.all([
    listResearchClaims(userId, linked.id, filters, { pageSize: 100 }),
    listDebateClustersForProject(userId, linked.id),
    listEvidenceChambersForProject(userId, linked.id),
  ]);

  return {
    researchProject: linked,
    claims: allClaims.filter((claim) => !claim.hidden && claim.verificationStatus !== "rejected"),
    debateClusters: clusters.filter((cluster) => cluster.verificationStatus !== "rejected"),
    chambers: chambers.filter((chamber) => !chamber.hidden && chamber.verificationStatus !== "rejected"),
  };
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export interface ClaimEvidenceSource {
  id: string;
  workId: string | null;
  corpusItemId: string | null;
  workTitle: string | null;
  claimText: string;
  supportingExcerpt: string;
  anchorState: string;
}

/** A claim is only usable by the Evidence panel when it is (a) the caller's
 *  own, (b) still active/visible (not hidden, not rejected), and (c) a real
 *  member of the writer project's LINKED research project — proven via
 *  `research_project_member`, never trusted from a bare `claimId`. Returns
 *  `null` for anything else, matching `getResearchClaimDetail`'s "no
 *  distinguishable 403" posture. */
export async function getClaimForWriterEvidence(userId: string, writerProjectId: string, claimId: string): Promise<ClaimEvidenceSource | null> {
  const linked = await getLinkedResearchProject(userId, writerProjectId);
  if (!linked) return null;

  const [row] = await db
    .select({
      id: researchClaims.id,
      workId: researchClaims.workId,
      workTitle: works.title,
      corpusItemId: researchClaims.corpusItemId,
      corpusItemTitle: researchCorpusItems.title,
      claimText: researchClaims.claimText,
      supportingExcerpt: researchClaims.supportingExcerpt,
      anchorState: researchClaims.anchorState,
      hidden: researchClaims.hidden,
      verificationStatus: researchClaims.verificationStatus,
    })
    .from(researchClaims)
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .leftJoin(researchCorpusItems, eq(researchCorpusItems.id, researchClaims.corpusItemId))
    .innerJoin(
      researchProjectMembers,
      or(
        and(eq(researchProjectMembers.memberType, "work"), eq(researchProjectMembers.workId, researchClaims.workId)),
        and(eq(researchProjectMembers.memberType, "corpus_item"), eq(researchProjectMembers.corpusItemId, researchClaims.corpusItemId)),
      ),
    )
    .where(
      and(
        eq(researchClaims.id, claimId),
        eq(researchClaims.userId, userId),
        eq(researchClaims.status, "active"),
        eq(researchProjectMembers.projectId, linked.id),
      ),
    )
    .limit(1);

  if (!row || row.hidden || row.verificationStatus === "rejected") return null;
  return {
    id: row.id,
    workId: row.workId,
    corpusItemId: row.corpusItemId,
    workTitle: row.workTitle ?? row.corpusItemTitle ?? null,
    claimText: row.claimText,
    supportingExcerpt: row.supportingExcerpt,
    anchorState: row.anchorState,
  };
}

/** The work's real bibliographic identity: a `bibliographic_record` whose
 *  normalized title matches the owned work's normalized title — the same
 *  self-match `lib/research/chambers.ts`'s `loadPositionSourceCredibility`
 *  already performs, applied here to build a citation instead of a
 *  credibility read. When several records match, the one carrying the most
 *  real fields wins (DOI first, then year, then most recent) — never an
 *  arbitrary pick. */
async function findWorkBibliographicFields(userId: string, workId: string) {
  const rows = (await db.execute(sql`
    SELECT br.title, br.authors, br.year, br.doi, br.url
    FROM bibliographic_record br
    JOIN work w ON ${NORM("w.title")} = ${NORM("br.title")}
    WHERE w.id = ${workId} AND w.user_id = ${userId}
    ORDER BY (br.doi IS NOT NULL) DESC, (br.year IS NOT NULL) DESC, br.created_at DESC
    LIMIT 1
  `)) as unknown as { title: string; authors: string | null; year: number | null; doi: string | null; url: string | null }[];
  return rows[0] ?? null;
}

/** Builds a claim's source citation ONLY from real, already-stored
 *  bibliographic data — never model-generated (plan §Web surfaces "writer_citation
 *  rows built only from real bibliographic records"). Returns `null` when no
 *  such identity is resolvable, the caller's cue to insert the honest
 *  "citation unresolved" marker instead of a citation row. */
export async function buildClaimSourceCitation(userId: string, claim: Pick<ClaimEvidenceSource, "workId" | "corpusItemId">): Promise<CslJson | null> {
  if (claim.workId) {
    const fields = await findWorkBibliographicFields(userId, claim.workId);
    return fields ? buildCslFromWorkBibliographicFields(fields) : null;
  }
  if (claim.corpusItemId) {
    const [item] = await db
      .select({
        title: researchCorpusItems.title,
        authors: researchCorpusItems.authors,
        year: researchCorpusItems.year,
        doi: researchCorpusItems.doi,
        url: researchCorpusItems.url,
        venue: researchCorpusItems.venue,
      })
      .from(researchCorpusItems)
      .where(and(eq(researchCorpusItems.id, claim.corpusItemId), eq(researchCorpusItems.userId, userId)))
      .limit(1);
    return item ? buildCslFromCorpusItemFields(item) : null;
  }
  return null;
}

async function linkCitationToClaim(projectId: string, claim: ClaimEvidenceSource, csl: CslJson): Promise<{ id: string } | null> {
  const citation = await addWriterCitation(projectId, csl, "research_claim");
  if (!citation) return null;
  if (!citation.researchClaimId) {
    await db.update(writerCitations).set({ researchClaimId: claim.id, updatedAt: new Date() }).where(eq(writerCitations.id, citation.id));
  }
  return { id: citation.id };
}

export interface EvidenceInsertResult {
  document: { id: string; content: unknown };
  citationId: string | null;
  unresolvedCitation: boolean;
  unanchored: boolean;
}

/**
 * The Evidence panel's "Insert" action (plan §Web surfaces): appends a real
 * ProseMirror `blockquote` node (never plain text) to the document's
 * CURRENT, authoritative DB content — not whatever the client's local draft
 * state happens to hold, so an insert can never race or clobber a
 * still-in-flight autosave. Builds a `writer_citation` row ONLY when a real
 * bibliographic identity resolves; an unresolved citation and an unanchored
 * claim each get their own honest, visible marker paragraph (both can fire
 * together — they are independent facts about the claim).
 */
export async function insertClaimEvidenceIntoDocument(
  userId: string,
  writerProjectId: string,
  documentId: string,
  claimId: string,
): Promise<EvidenceInsertResult | "not_found"> {
  const owned = await getOwnedWriterDocument(userId, writerProjectId, documentId);
  if (!owned) return "not_found";
  const claim = await getClaimForWriterEvidence(userId, writerProjectId, claimId);
  if (!claim) return "not_found";

  const csl = await buildClaimSourceCitation(userId, claim);
  const citation = csl ? await linkCitationToClaim(writerProjectId, claim, csl) : null;

  const blocks: ProseMirrorBlock[] = [buildEvidenceBlockquote({ researchClaimId: claim.id, excerpt: claim.supportingExcerpt, workTitle: claim.workTitle })];
  if (!citation) blocks.push(buildEvidenceMarker("[Citation unresolved — no verified bibliographic identity is available for this source.]"));
  if (claim.anchorState === "unanchored") blocks.push(buildEvidenceMarker("[Passage not currently locatable in the source text.]"));

  const currentContent = owned.document.content as ProseMirrorDocument;
  const nextContent: ProseMirrorDocument = { type: "doc", content: [...currentContent.content, ...blocks] };
  const updated = await saveWriterDocument(documentId, { content: nextContent }, "evidence_insert");
  if (!updated) return "not_found";

  return {
    document: { id: updated.id, content: updated.content },
    citationId: citation?.id ?? null,
    unresolvedCitation: !citation,
    unanchored: claim.anchorState === "unanchored",
  };
}
