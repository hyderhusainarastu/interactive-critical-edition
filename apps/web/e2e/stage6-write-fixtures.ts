import {
  bibliographicRecords,
  db,
  documents,
  pages,
  processingRuns,
  researchClaims,
  researchProjectMembers,
  researchProjects,
  textBlocks,
  users,
  works,
} from "@ice/db";
import { eq } from "drizzle-orm";
import { seedWorkWithLibraryItem } from "./helpers";

/**
 * Stage 6 VERIFICATION lane — a NEW e2e helper file (per this worktree's
 * file-ownership rule: `e2e/helpers.ts` itself may not be edited). Reuses
 * `seedWorkWithLibraryItem` from `./helpers` (import, not edit) for the
 * "Library source" the Sources/Evidence panel reads via
 * `listOwnedLibrarySources` (work -> work_identity -> resource_role ->
 * learning_resource), and adds a minimal, real research-evidence chain
 * (research_project -> work -> processing_run -> page -> text_block ->
 * research_claim) in the same shape `writer-evidence.spec.ts`'s own
 * `seedFixture` already uses — trimmed to exactly what journey 7's "link
 * evidence -> insert citation" step needs to exercise for real, not a
 * reduced/faked shape.
 *
 * The research project is deliberately left UNLINKED to the writer
 * project — linking it is one of the journey's own live UI steps
 * (`POST /api/writer/projects/:id/research-link`), not something to
 * pre-seed around.
 */

export async function markOnboarded(userId: string) {
  await db.update(users).set({ preferences: { onboardedAt: new Date().toISOString() } }).where(eq(users.id, userId));
}

export interface Stage6Fixture {
  librarySourceWorkId: string;
  librarySourceResourceId: string;
  librarySourceTitle: string;
  researchProjectId: string;
  researchProjectTitle: string;
  researchClaimExcerpt: string;
}

/**
 * Seeds everything journey 7 needs BEFORE the writer project itself is
 * created (that happens live, through the real "New project" UI, per the
 * journey's own "create project+document" first step):
 *
 * 1. A Library source (`seedWorkWithLibraryItem`) — real work + work_identity
 *    + learning_resource + resource_role, the exact join
 *    `listOwnedLibrarySources` performs.
 * 2. A research project with one owned work carrying one real, anchored
 *    claim (real page + text_block, quote drawn from the block's own text)
 *    — the shape the Evidence panel's `GET .../evidence` route reads, and
 *    what "Insert" turns into a real ProseMirror blockquote node.
 */
export async function seedStage6Fixture(userId: string): Promise<Stage6Fixture> {
  const suffix = Date.now();

  const { workId: librarySourceWorkId, resourceId: librarySourceResourceId } = await seedWorkWithLibraryItem(userId, {
    title: `Stage 6 Library Work ${suffix}`,
    resourceTitle: `Stage 6 Library Source ${suffix}`,
    relationship: "prerequisite",
  });

  const evidenceWorkTitle = `Stage 6 Evidence Work ${suffix}`;
  const [evidenceWork] = await db
    .insert(works)
    .values({ userId, title: evidenceWorkTitle, authorName: "Stage 6 Fixture Author" })
    .returning({ id: works.id });

  const bodyText = "The freed-space rule widens the central draft once both side panels are collapsed.";
  const [doc] = await db
    .insert(documents)
    .values({
      userId,
      workId: evidenceWork.id,
      storagePath: `${userId}/${evidenceWork.id}/edition.txt`,
      originalFilename: "edition.txt",
      mimeType: "text/plain",
      fileSize: bodyText.length,
      processingStatus: "ready",
      analysisStatus: "complete",
      extractedText: bodyText,
    })
    .returning({ id: documents.id });
  const [run] = await db
    .insert(processingRuns)
    .values({ documentId: doc.id, version: 1, pipelineVersion: "v2", status: "complete", stage: "publish", structureState: "full", isPublished: true, degraded: false })
    .returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0, isOcr: false, text: bodyText }).returning({ id: pages.id });
  const [block] = await db.insert(textBlocks).values({ pageId: page.id, blockOrder: 0, kind: "body", text: bodyText }).returning({ id: textBlocks.id });

  await db.insert(bibliographicRecords).values({ source: "test", title: evidenceWorkTitle, authors: "Stage 6 Fixture Author", year: 2026, doi: `10.9999/stage6-${suffix}` });

  const researchClaimExcerpt = "both side panels are collapsed";
  const [claim] = await db
    .insert(researchClaims)
    .values({
      userId,
      workId: evidenceWork.id,
      textBlockId: block.id,
      quote: "collapsed",
      prefix: "both side panels are ",
      suffix: ".",
      anchorState: "anchored",
      claimText: "The central draft widens once both side panels are collapsed.",
      claimNature: "interpretive",
      confidence: "high",
      section: "",
      sourceScope: "full_text",
      supportingExcerpt: researchClaimExcerpt,
      excerptVerified: true,
      contentHash: `stage6-verify-claim-${evidenceWork.id}`,
      promptVersion: "claim-extraction-v1",
      status: "active",
      verificationStatus: "unreviewed",
    })
    .returning({ id: researchClaims.id });

  const researchProjectTitle = `Stage 6 Evidence Project ${suffix}`;
  const [project] = await db.insert(researchProjects).values({ userId, title: researchProjectTitle }).returning({ id: researchProjects.id });
  await db.insert(researchProjectMembers).values({ projectId: project.id, memberType: "work", workId: evidenceWork.id, role: "central" });

  void claim;
  return {
    librarySourceWorkId,
    librarySourceResourceId,
    librarySourceTitle: `Stage 6 Library Source ${suffix}`,
    researchProjectId: project.id,
    researchProjectTitle,
    researchClaimExcerpt,
  };
}
