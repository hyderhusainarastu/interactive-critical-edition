import {
  claimEvidence,
  credibilityAssessments,
  db,
  docFootnotes,
  editionRelations,
  evidenceSpans,
  generatedClaims,
  generatedNotes,
  pages,
  passageAnnotations,
  processingRuns,
  providerAttempts,
  researchResources,
  textBlocks,
  documentApparatus,
  termOccurrences,
  termVariants,
} from "@ice/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { detectUntranscribableSpans } from "@ice/ingestion";

/**
 * Assemble the full published v2 edition for a document (plan §33 §3.3): the
 * published run + non-monetary analysis state, pages/blocks, authorial notes, generated
 * notes with claim-level evidence, resources with independent credibility
 * components + agreement, resource relations, and the per-provider reports.
 * Returns null when there is no published run (caller falls back to the legacy
 * reader). One batched query per table, assembled in memory (no N+1).
 */
export async function getPublishedEdition(documentId: string) {
  const [run] = await db
    .select()
    .from(processingRuns)
    .where(and(eq(processingRuns.documentId, documentId), eq(processingRuns.isPublished, true)))
    .limit(1);
  if (!run) return null;


  const editionPages = await db.select().from(pages).where(eq(pages.runId, run.id)).orderBy(asc(pages.pageIndex));
  const pageIds = editionPages.map((p) => p.id);
  const [blocks, authorialNotes, notes, claims, resources, creds, relations, attempts, spans, passageNotes, apparatus, termRows] = await Promise.all([
    pageIds.length ? db.select().from(textBlocks).where(inArray(textBlocks.pageId, pageIds)).orderBy(asc(textBlocks.blockOrder)) : Promise.resolve([]),
    db.select().from(docFootnotes).where(eq(docFootnotes.runId, run.id)).orderBy(asc(docFootnotes.createdAt)),
    db.select().from(generatedNotes).where(eq(generatedNotes.runId, run.id)).orderBy(asc(generatedNotes.createdAt)),
    db.select().from(generatedClaims).where(eq(generatedClaims.runId, run.id)),
    db.select().from(researchResources).where(eq(researchResources.runId, run.id)),
    db.select().from(credibilityAssessments),
    db.select().from(editionRelations).where(eq(editionRelations.runId, run.id)),
    db.select().from(providerAttempts).where(eq(providerAttempts.runId, run.id)).orderBy(asc(providerAttempts.provider)),
    db.select().from(evidenceSpans).where(eq(evidenceSpans.runId, run.id)),
    db.select().from(passageAnnotations).where(eq(passageAnnotations.runId, run.id)).orderBy(asc(passageAnnotations.createdAt)),
    db.select().from(documentApparatus).where(eq(documentApparatus.runId, run.id)).orderBy(asc(documentApparatus.createdAt)),
    db.select().from(termVariants).where(eq(termVariants.documentId, documentId)).orderBy(asc(termVariants.createdAt)),
  ]);

  const termVariantIds = termRows.map((term) => term.id);
  const termOccurrenceRows = termVariantIds.length
    ? await db.select().from(termOccurrences).where(inArray(termOccurrences.termVariantId, termVariantIds)).orderBy(asc(termOccurrences.startOffset))
    : [];

  const spanById = new Map(spans.map((s) => [s.id, s]));
  const resourceIds = new Set(resources.map((r) => r.id));
  const credByResource = new Map(creds.filter((c) => resourceIds.has(c.resourceId)).map((c) => [c.resourceId, c]));
  const claimIds = claims.map((c) => c.id);
  const claimEv = claimIds.length ? await db.select().from(claimEvidence).where(inArray(claimEvidence.claimId, claimIds)) : [];
  const evByClaim = new Map<string, typeof claimEv>();
  for (const ce of claimEv) {
    const list = evByClaim.get(ce.claimId) ?? [];
    list.push(ce);
    evByClaim.set(ce.claimId, list);
  }
  const claimsByNote = new Map<string, typeof claims>();
  for (const c of claims) {
    if (!c.noteId) continue;
    const list = claimsByNote.get(c.noteId) ?? [];
    list.push(c);
    claimsByNote.set(c.noteId, list);
  }

  const generated = notes.map((n) => ({
    id: n.id,
    noteType: n.noteType,
    body: n.body,
    confidence: n.confidence,
    evidence: n.evidenceSpanId ? { quote: spanById.get(n.evidenceSpanId)?.quote ?? null, resourceId: spanById.get(n.evidenceSpanId)?.resourceId ?? null } : null,
    claims: (claimsByNote.get(n.id) ?? []).map((c) => ({
      id: c.id,
      text: c.text,
      claimType: c.claimType,
      agreement: c.agreement,
      confidence: c.confidence,
      evidence: (evByClaim.get(c.id) ?? []).map((ce) => ({
        stance: ce.stance,
        quote: spanById.get(ce.evidenceSpanId)?.quote ?? null,
        resourceId: spanById.get(ce.evidenceSpanId)?.resourceId ?? null,
      })),
    })),
  }));

  const resourceOut = resources.map((r) => {
    const c = credByResource.get(r.id);
    return {
      id: r.id,
      title: r.title,
      url: r.url,
      provider: r.provider,
      resourceType: r.resourceType,
      doi: r.doi,
      isbn: r.isbn,
      year: r.year,
      authors: r.authors,
      inspectionDepth: r.inspectionDepth,
      bibRecordId: r.bibRecordId,
      // Canonical work identity (migration 0014). Null-safe: rows written
      // before 0014 have no work key and simply stand alone.
      work: r.workKey
        ? {
            key: r.workKey,
            role: r.workRole,
            canonicalTitle: r.workCanonicalTitle,
            authorSurname: r.workAuthorSurname,
            evidence: r.workEvidence,
          }
        : null,
      credibility: c
        ? {
            authority: c.authority,
            agreement: c.agreement,
            relevance: c.relevance,
            evidenceStrength: c.evidenceStrength,
            inspectionDepth: c.inspectionDepth,
            score: c.score,
            rationale: c.rationale,
          }
        : null,
    };
  });

  // Group records into WORKS for display. A cited book, a review of it and its
  // second edition are three correct records but one work, and a reader who
  // sees the same book five times cannot use the Library. The individual
  // records stay in `resources` — nothing is hidden — while `works` is what the
  // Library lists: the book, with its reviews and editions attached to it.
  const byWork = new Map<string, typeof resourceOut>();
  for (const r of resourceOut) {
    // A record with no work key (nothing usable to group on) stands alone
    // rather than being lumped into a shared bucket.
    const key = r.work?.key ?? `resource:${r.id}`;
    const bucket = byWork.get(key);
    if (bucket) bucket.push(r);
    else byWork.set(key, [r]);
  }
  const works = [...byWork.entries()].map(([key, members]) => {
    // The representative is chosen the same way the worker chose it: a primary
    // record beats a review, then richer metadata wins.
    const ranked = [...members].sort((a, b) => rankForDisplay(b) - rankForDisplay(a));
    const [primary, ...related] = ranked;
    return {
      key,
      title: primary.work?.canonicalTitle ?? primary.title,
      authorSurname: primary.work?.authorSurname ?? null,
      primary,
      related: related.map((r) => ({
        id: r.id,
        title: r.title,
        role: r.work?.role ?? "primary",
        evidence: r.work?.evidence ?? null,
        url: r.url,
        provider: r.provider,
      })),
    };
  });

  // Passage annotations (9.3): anchored ones are keyed by their real
  // text_block_id so the reader can render them inline at that exact block;
  // whole-work guidance (no single passage applies) is a separate list the
  // reader must label "Whole-work guidance", never mixed into the per-block
  // ones — the two have different display rules, not just different data.
  const passageAnnotationsOut = passageNotes.map((p) => ({
    id: p.id,
    textBlockId: p.textBlockId,
    isWholeWork: p.isWholeWork,
    quote: p.quote,
    summary: p.summary,
    explanation: p.explanation,
    helpfulFor: "helpfulFor" in p ? p.helpfulFor : null,
    scope: "scope" in p ? p.scope : null,
    annotationType: p.annotationType,
    relationship: p.relationship,
    relatedResourceId: p.relatedResourceId,
    readerLevel: p.readerLevel,
    confidence: p.confidence,
    createdBy: p.createdBy,
    // Reader-correction state (D-22-1) — at parity with the legacy annotation
    // table. Present on every element so the sidebar can render verify/hide/
    // edit affordances and persist them.
    verificationStatus: "verificationStatus" in p ? p.verificationStatus : "unreviewed",
    hidden: "hidden" in p ? p.hidden : false,
  }));

  const pageIndexById = new Map(editionPages.map((page) => [page.id, page.pageIndex]));
  const occurrencesByVariant = new Map<string, typeof termOccurrenceRows>();
  for (const occurrence of termOccurrenceRows) {
    const list = occurrencesByVariant.get(occurrence.termVariantId) ?? [];
    list.push(occurrence);
    occurrencesByVariant.set(occurrence.termVariantId, list);
  }

  // `doc_footnote` predates the block-anchored apparatus table. A v4 run
  // writes both for compatibility with older readers, but the modern reader
  // must not show the same authorial note twice. Retain only legacy notes that
  // have no equivalent, linked apparatus record.
  const apparatusFootprint = new Set(
    apparatus
      .filter((entry) => entry.kind === "footnote" || entry.kind === "endnote")
      .map((entry) => `${entry.marker ?? ""}\u0000${entry.text.trim()}`),
  );
  const legacyAuthorialNotes = authorialNotes.filter(
    (note) => !apparatusFootprint.has(`${note.marker}\u0000${note.text.trim()}`),
  );

  return {
    run: {
      id: run.id,
      version: run.version,
      status: run.status,
      stage: run.stage,
      structureState: run.structureState,
      isPublished: run.isPublished,
      note: run.note,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    },
    // Monetary totals and ledger detail remain available to admin reporting;
    // reader payloads expose only this useful quality signal.
    analysis: { degraded: run.degraded },
    pages: editionPages,
    // D-23-9: untranscribable spans are recomputed deterministically on read
    // (same precedent as `matchNoteToBlock`) — the stored block text is never
    // altered, and no fabricated marker is persisted. The garbled bytes were
    // proven to originate in the source PDF's corrupted font encoding, so the
    // reader labels them honestly instead of rendering them as prose.
    blocks: blocks.map((block) => ({
      ...block,
      pageIndex: pageIndexById.get(block.pageId) ?? 0,
      untranscribableSpans: detectUntranscribableSpans(block.text),
    })),
    authorialNotes: legacyAuthorialNotes.map((note) => ({
      id: note.id,
      marker: note.marker,
      text: note.text,
      pageAnchor: note.pageAnchor,
    })),
    authorApparatus: apparatus.map((entry) => ({
      id: entry.id,
      textBlockId: entry.textBlockId,
      kind: entry.kind,
      marker: entry.marker,
      text: entry.text,
      scope: entry.scope,
    })),
    terms: termRows.map((term) => ({
      id: term.id,
      originalScript: term.originalScript,
      transliteration: term.transliteration,
      language: term.language,
      direction: term.direction,
      verificationStatus: term.verificationStatus,
      source: term.source,
      occurrences: (occurrencesByVariant.get(term.id) ?? []).map((occurrence) => ({
        id: occurrence.id,
        textBlockId: occurrence.textBlockId,
        startOffset: occurrence.startOffset,
        endOffset: occurrence.endOffset,
      })),
    })),
    // Hidden (reader-dismissed) annotations are withheld from the default
    // anchored/whole-work arrays the reader renders markers and margin cards
    // from — so dismissing one removes its in-text marker on the next load —
    // and surfaced separately for the sidebar's "Show dismissed" view.
    passageAnnotations: passageAnnotationsOut.filter((p) => !p.isWholeWork && !p.hidden),
    wholeWorkGuidance: passageAnnotationsOut.filter((p) => p.isWholeWork && !p.hidden),
    hiddenPassageAnnotations: passageAnnotationsOut.filter((p) => p.hidden),
    generatedNotes: generated,
    resources: resourceOut,
    works,
    relations: relations.map((rel) => ({
      id: rel.id,
      resourceId: rel.resourceId,
      relatedResourceId: rel.relatedResourceId,
      relationType: rel.relationType,
      depth: rel.depth,
      importance: rel.importance,
      confidence: rel.confidence,
    })),
    providerReports: attempts.map((a) => ({
      provider: a.provider,
      status: a.status,
      resultCount: a.resultCount,
      queries: a.queries,
      inspectionDepth: a.inspectionDepth,
      latencyMs: a.latencyMs,
      error: a.error,
    })),
  };
}

export type PublishedEdition = NonNullable<Awaited<ReturnType<typeof getPublishedEdition>>>;

/** Display ranking for choosing which record represents a work: a primary
 *  record always beats a review, then richer metadata wins. Mirrors the
 *  worker's own choice so the reader and the pipeline agree. */
function rankForDisplay(r: {
  work: { role: string | null } | null;
  doi: string | null;
  isbn: string | null;
  year: number | null;
}): number {
  const role = r.work?.role ?? "primary";
  return (role === "primary" ? 100 : role === "edition" ? 50 : 0) + (r.doi ? 4 : 0) + (r.isbn ? 3 : 0) + (r.year ? 2 : 0);
}
