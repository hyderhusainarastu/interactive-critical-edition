import { citations, db, docMetadata, documents, pages, processingRuns, textBlocks, works } from "@ice/db";
import type { ExtractionBlock } from "@ice/claims";
import { and, asc, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Work extraction scope (extract_claims, uploaded-work path).
// ---------------------------------------------------------------------------

export interface BlockMeta {
  id: string;
  pageId: string;
  kind: string;
  text: string;
}

export interface WorkExtractionScope {
  userId: string;
  workId: string;
  documentId: string;
  workTitle: string;
  processingRunId: string;
  /** `@ice/claims`'s `planExtractionChunks` input — every block regardless
   *  of kind; the allowlist (`CLAIM_ELIGIBLE_BLOCK_KINDS`) does the
   *  apparatus exclusion, not this loader. */
  blocks: ExtractionBlock[];
  /** blockId -> full metadata, for locating the "named block" behind an
   *  accepted excerpt and for locus-harvest proximity lookups. */
  blockMeta: Map<string, BlockMeta>;
  /** pageId -> footnote/endnote block texts on that page (locus harvest, origin "footnote"). */
  footnoteTextsByPage: Map<string, string[]>;
  /** textBlockId -> citation raw texts anchored to that block (locus harvest, origin "citation"). */
  citationTextsByBlock: Map<string, string[]>;
}

/**
 * Loads everything `extractClaimsForWork` needs for one uploaded work: the
 * work's PUBLISHED run's body-eligible text blocks (in document order, with
 * a running section title derived the same way `extraction.ts` does at
 * insert time — `text_block` itself carries no `section_title` column, see
 * that file's own `bodyBlocks` construction), plus the footnote/citation
 * context the locus-harvest step reads. Returns null when the work has no
 * document, or the document has no published run — extraction cannot run
 * without a stable, reader-visible text to anchor to.
 */
export async function loadWorkExtractionScope(workId: string): Promise<WorkExtractionScope | null> {
  const [work] = await db.select({ id: works.id, userId: works.userId, title: works.title }).from(works).where(eq(works.id, workId)).limit(1);
  if (!work) return null;

  const [document] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, workId)).limit(1);
  if (!document) return null;

  const [run] = await db
    .select({ id: processingRuns.id })
    .from(processingRuns)
    .where(and(eq(processingRuns.documentId, document.id), eq(processingRuns.isPublished, true)))
    .limit(1);
  if (!run) return null;

  const [meta] = await db.select({ title: docMetadata.title }).from(docMetadata).where(eq(docMetadata.runId, run.id)).limit(1);
  const workTitle = meta?.title?.trim() || work.title;

  const rows = await db
    .select({
      id: textBlocks.id,
      pageId: textBlocks.pageId,
      kind: textBlocks.kind,
      text: textBlocks.text,
      blockOrder: textBlocks.blockOrder,
      pageIndex: pages.pageIndex,
    })
    .from(textBlocks)
    .innerJoin(pages, eq(textBlocks.pageId, pages.id))
    .where(eq(pages.runId, run.id))
    .orderBy(asc(pages.pageIndex), asc(textBlocks.blockOrder));

  const blocks: ExtractionBlock[] = [];
  const blockMeta = new Map<string, BlockMeta>();
  const footnoteTextsByPage = new Map<string, string[]>();
  // Same running-title derivation as `apps/worker/src/extraction.ts`'s
  // `bodyBlocks` construction: a `title`/`header` block updates the running
  // section title BEFORE it's read by whatever block (including itself)
  // reads it next.
  let currentSectionTitle = "";
  for (const row of rows) {
    if ((row.kind === "title" || row.kind === "header") && row.text.trim()) currentSectionTitle = row.text.trim();
    blocks.push({ id: row.id, kind: row.kind, sectionLabel: currentSectionTitle, text: row.text });
    blockMeta.set(row.id, { id: row.id, pageId: row.pageId, kind: row.kind, text: row.text });
    if (row.kind === "footnote" || row.kind === "endnote") {
      const existing = footnoteTextsByPage.get(row.pageId) ?? [];
      existing.push(row.text);
      footnoteTextsByPage.set(row.pageId, existing);
    }
  }

  const citationRows = await db
    .select({ textBlockId: citations.textBlockId, rawText: citations.rawText })
    .from(citations)
    .where(and(eq(citations.documentId, document.id), sql`${citations.textBlockId} is not null`));
  const citationTextsByBlock = new Map<string, string[]>();
  for (const row of citationRows) {
    if (!row.textBlockId) continue;
    const existing = citationTextsByBlock.get(row.textBlockId) ?? [];
    existing.push(row.rawText);
    citationTextsByBlock.set(row.textBlockId, existing);
  }

  return {
    userId: work.userId,
    workId: work.id,
    documentId: document.id,
    workTitle,
    processingRunId: run.id,
    blocks,
    blockMeta,
    footnoteTextsByPage,
    citationTextsByBlock,
  };
}
