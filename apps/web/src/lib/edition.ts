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
  processingRuns,
  providerAttempts,
  researchResources,
  textBlocks,
} from "@ice/db";
import { and, asc, eq, inArray } from "drizzle-orm";

/**
 * Assemble the full published v2 edition for a document (plan §33 §3.3): the
 * published run + degradation/cost, pages/blocks, authorial notes, generated
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
  const [blocks, authorialNotes, notes, claims, resources, creds, relations, attempts, spans] = await Promise.all([
    pageIds.length ? db.select().from(textBlocks).where(inArray(textBlocks.pageId, pageIds)).orderBy(asc(textBlocks.blockOrder)) : Promise.resolve([]),
    db.select().from(docFootnotes).where(eq(docFootnotes.runId, run.id)).orderBy(asc(docFootnotes.createdAt)),
    db.select().from(generatedNotes).where(eq(generatedNotes.runId, run.id)).orderBy(asc(generatedNotes.createdAt)),
    db.select().from(generatedClaims).where(eq(generatedClaims.runId, run.id)),
    db.select().from(researchResources).where(eq(researchResources.runId, run.id)),
    db.select().from(credibilityAssessments),
    db.select().from(editionRelations).where(eq(editionRelations.runId, run.id)),
    db.select().from(providerAttempts).where(eq(providerAttempts.runId, run.id)).orderBy(asc(providerAttempts.provider)),
    db.select().from(evidenceSpans).where(eq(evidenceSpans.runId, run.id)),
  ]);

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
    cost: { aiCostUsd: run.aiCostUsd, degraded: run.degraded, saturationNote: run.saturationNote },
    pages: editionPages,
    blocks,
    authorialNotes,
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
