import {
  aiUsageLogs,
  annotations,
  bibliographicRecords,
  citations,
  claimEvidence,
  db,
  documents,
  editionRelations,
  evidenceSpans,
  generatedClaims,
  generatedNotes,
  graphEdges,
  processingRuns,
  providerAttempts,
  researchCache,
  researchResources,
  researchCandidates,
  credibilityAssessments,
  works,
} from "@ice/db";
import {
  classifyRelationship,
  CLASSIFY_PROMPT_VERSION,
  estimateCostUsd,
  OpenAIResponsesClient,
  safetyIdentifierFor,
  type RelationshipCategory,
} from "@ice/ai-adapters";
import { resolveCitation, type ResolvedRecord } from "@ice/bibliographic";
import { extractCitations, type RawCitation } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import {
  allAdapters,
  buildCredibility,
  canAfford,
  canonicalizeDoi,
  canonicalizeIsbn,
  canonicalizeUrl,
  charge,
  classifyAuthority,
  computeAgreement,
  generateLaneQueries,
  heuristicNote,
  makeBudget,
  meetsFactualBar,
  normalizedKey,
  overSoftCap,
  RESEARCH_LIMITS,
  runDiscovery,
  assessCandidate,
  buildTopicSignature,
  laneForResource,
  citedSurnamesFrom,
  type WorkIdentity,
  synthesizeNote,
  withCache,
  type CacheStore,
  type RawResource,
  type SourceAuthority,
} from "@ice/research";
import { and, eq } from "drizzle-orm";

/**
 * Scholarly-analysis pipeline (plan §10–§12), the two-stage design:
 *   Stage 1 (cheap, deterministic, no AI): extract candidate citations
 *     from the text and resolve each against real bibliographic sources.
 *   Stage 2 (expensive): classify each candidate's relationship to the
 *     primary work into one of the 10 categories, with a real model when
 *     a key is configured, else the deterministic heuristic fallback.
 *
 * Every annotation is written with full provenance (model, prompt
 * version, extracted source text, confidence) and starts `unreviewed` so
 * the user can approve/reject/edit/hide it (plan §12). Re-running is
 * idempotent: prior *system* annotations/citations/edges for the
 * document are cleared first, but user-created annotations are preserved.
 */

// relationship_category → graph edge_type (plan §9 vocabulary). Only
// resolved candidates (with a real target record) get a graph edge, so
// Phase 5's roadmap traversal never points at a phantom node.
const CATEGORY_TO_EDGE: Record<RelationshipCategory, Parameters<typeof edgeValue>[0]> = {
  explicit_reference: "cites",
  secondary_scholarly_recommendation: "is_recommended_by",
  historical_context: "provides_context_for",
  prerequisite: "is_prerequisite_for",
  conceptual_influence: "influences",
  disagreement_polemical_target: "disagrees_with",
  interpretive_aid: "interprets",
  parallel_comparison: "is_comparable_to",
  optional_extension: "is_recommended_by",
  ai_inferred: "provides_context_for",
};

function edgeValue(
  t:
    | "cites"
    | "quotes"
    | "influences"
    | "criticizes"
    | "responds_to"
    | "presupposes"
    | "provides_context_for"
    | "interprets"
    | "disagrees_with"
    | "translates"
    | "is_edition_of"
    | "is_prerequisite_for"
    | "is_comparable_to"
    | "is_recommended_by",
) {
  return t;
}

interface TextAnchor {
  kind: "text";
  paragraphIndex: number;
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 40;

/**
 * How many citations to process at once. Each citation is one live
 * bibliographic lookup (I/O-bound, up to an 8s timeout) plus one
 * classification call plus a few inserts — so processing them
 * concurrently cuts wall-clock time dramatically for a large reference
 * list. Kept modest (6) to stay polite with the free bibliographic APIs'
 * rate limits and comfortably under the postgres.js connection pool
 * (default 10), which the inserts share.
 */
const ANALYSIS_CONCURRENCY = 6;

/**
 * Runs `fn` over `items` with at most `limit` in flight at once, using a
 * fixed pool of workers pulling from a shared cursor. Preserves the
 * simple "process each candidate" shape while bounding concurrency — no
 * external dependency needed.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

/**
 * Locate a needle (typically the candidate's author surname) in the
 * body and build a highlight-shaped anchor so the reader can render an
 * inline marker. Paragraph splitting mirrors TextReader exactly
 * (split on blank lines) so paragraphIndex aligns. Text/Markdown only —
 * PDF page anchoring needs positional data the merged-text extraction
 * doesn't carry, so PDF annotations are created work-level (anchor null)
 * and shown in the sidebar, not as inline markers (documented limitation).
 */
function buildTextAnchor(
  paragraphs: string[],
  needle: string,
): { anchor: TextAnchor; sourceText: string } | null {
  if (!needle) return null;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const idx = p.indexOf(needle);
    if (idx === -1) continue;
    const quote = p.slice(idx, idx + needle.length);
    const prefix = p.slice(Math.max(0, idx - CONTEXT), idx);
    const suffix = p.slice(idx + needle.length, idx + needle.length + CONTEXT);
    return {
      anchor: { kind: "text", paragraphIndex: i, quote, prefix, suffix },
      sourceText: p.trim().slice(0, 600),
    };
  }
  return null;
}

/** First capitalized word of a citation — a usable anchoring needle
 *  (author surname) and target label seed. */
function leadingSurname(query: string): string {
  const m = query.match(/^([A-Z][A-Za-zÀ-ÿ'’-]{2,})/);
  return m ? m[1] : "";
}

/** A concise human-readable target label for the annotation, even when
 *  unresolved (plan §12: never drop the citation). */
function targetLabel(candidate: RawCitation, record: ResolvedRecord | null): string {
  if (record) {
    return record.authors ? `${record.title} — ${record.authors}` : record.title;
  }
  return candidate.text.slice(0, 200);
}

async function findOrCreateBibRecord(record: ResolvedRecord): Promise<string> {
  // Reuse an existing catalog entry by DOI or external id (plan §9
  // shared-catalog direction) so re-analysis doesn't duplicate records.
  if (record.doi) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.doi, record.doi))
      .limit(1);
    if (existing) return existing.id;
  } else if (record.externalId) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.externalId, record.externalId))
      .limit(1);
    if (existing) return existing.id;
  }

  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: record.source,
      externalId: record.externalId,
      title: record.title,
      authors: record.authors,
      year: record.year,
      doi: record.doi,
      url: record.url,
      accessStatus: record.accessStatus,
      raw: record.raw,
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

export async function analyzeWork(documentId: string): Promise<void> {
  const [doc] = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      workId: documents.workId,
      mimeType: documents.mimeType,
      extractedText: documents.extractedText,
      title: works.title,
      authorName: works.authorName,
    })
    .from(documents)
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) throw new Error(`Document ${documentId} not found for analysis`);
  if (!doc.extractedText?.trim()) throw new Error("No extracted text to analyze");

  await db
    .update(documents)
    .set({ analysisStatus: "analyzing", analysisError: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    // Idempotent re-run: clear prior *system* output, keep user edits.
    await db
      .delete(annotations)
      .where(and(eq(annotations.documentId, documentId), eq(annotations.createdBy, "system")));
    await db.delete(citations).where(eq(citations.documentId, documentId));
    await db
      .delete(graphEdges)
      .where(
        and(
          eq(graphEdges.sourceType, "work"),
          eq(graphEdges.sourceId, doc.workId),
          eq(graphEdges.createdBy, "system"),
        ),
      );

    // Cap on citations classified per document (bounds AI spend and worker
    // time). 300 comfortably covers a full book's reference list; at the
    // cheap-tier model that's ~4-5 cents max per analysis. Candidates are
    // processed with bounded concurrency (see ANALYSIS_CONCURRENCY) so a
    // large reference list finishes in a fraction of the sequential time.
    const candidates = extractCitations(doc.extractedText, 300);
    const isText = doc.mimeType === "text/plain" || doc.mimeType === "text/markdown";
    const paragraphs = isText
      ? doc.extractedText.split(/\n{2,}/).filter((p) => p.trim().length > 0)
      : [];

    // Dedup bibliographic records within this run: concurrent candidates
    // resolving to the SAME work (same DOI/external id) would otherwise
    // race on find-or-create and insert duplicates. Caching the *promise*
    // by key means the first request creates the record and the rest await
    // the same result. (findOrCreateBibRecord still reads existing rows
    // first, so cross-run dedup is unaffected.)
    const bibCache = new Map<string, Promise<string>>();
    const getBibId = (record: ResolvedRecord): Promise<string> => {
      const key = record.doi
        ? `doi:${record.doi}`
        : record.externalId
          ? `ext:${record.externalId}`
          : `title:${record.title.toLowerCase()}`;
      let p = bibCache.get(key);
      if (!p) {
        p = findOrCreateBibRecord(record);
        bibCache.set(key, p);
      }
      return p;
    };

    await mapWithConcurrency(candidates, ANALYSIS_CONCURRENCY, async (candidate) => {
      // --- Stage 1: resolve against real bibliographic sources ---
      const record = await resolveCitation(candidate.query);
      const bibId = record ? await getBibId(record) : null;

      await db.insert(citations).values({
        documentId,
        rawText: candidate.text,
        resolvedBibId: bibId,
        resolutionSource: record?.source ?? "unresolved",
      });

      // --- Anchoring (text docs only) ---
      const located = isText ? buildTextAnchor(paragraphs, leadingSurname(candidate.query)) : null;
      const sourceText = located?.sourceText ?? candidate.text;

      // --- Stage 2: classify the relationship ---
      const classification = await classifyRelationship({
        primaryTitle: doc.title,
        primaryAuthor: doc.authorName,
        candidateTitle: record?.title ?? candidate.text.slice(0, 160),
        candidateAuthor: record?.authors ?? null,
        sourceText,
        resolved: Boolean(record),
      });

      await db.insert(aiUsageLogs).values({
        documentId,
        task: "relationship_classification",
        provider: classification.provider,
        model: classification.model,
        promptTokens: classification.promptTokens,
        completionTokens: classification.completionTokens,
        estimatedCostUsd: classification.heuristic
          ? 0
          : estimateCostUsd(classification.model, classification.promptTokens, classification.completionTokens),
      });

      await db.insert(annotations).values({
        userId: doc.userId,
        documentId,
        relationshipCategory: classification.category,
        targetBibId: bibId,
        targetLabel: targetLabel(candidate, record),
        anchor: located?.anchor ?? null,
        extractedSourceText: sourceText,
        explanation: classification.explanation,
        confidence: classification.confidence,
        modelUsed: classification.model,
        promptVersion: classification.heuristic ? "heuristic" : CLASSIFY_PROMPT_VERSION,
        createdBy: "system",
        verificationStatus: "unreviewed",
      });

      // Graph edge only for resolved targets (real node on both ends).
      if (bibId) {
        await db.insert(graphEdges).values({
          userId: doc.userId,
          sourceType: "work",
          sourceId: doc.workId,
          targetType: "bibliographic_record",
          targetId: bibId,
          edgeType: edgeValue(CATEGORY_TO_EDGE[classification.category]),
          weight: 1,
          confidence: classification.confidence,
          evidence: { extractedSourceText: sourceText, category: classification.category },
          createdBy: "system",
        });
      }
    });

    await db
      .update(documents)
      .set({ analysisStatus: "complete", updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    console.log(`[worker] analysis complete for document ${documentId}: ${candidates.length} annotation(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError(err, { scope: "worker.analyzeWork", documentId });
    await db
      .update(documents)
      .set({ analysisStatus: "failed", analysisError: message, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    throw err;
  }
}

// A-first ordering so the highest-authority resources are inspected within the
// full-inspection budget.
const AUTHORITY_ORDER: Record<SourceAuthority, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

/** Persistent provider-result cache over the `research_cache` table (plan §33
 *  TTLs). A read/write failure never breaks discovery (withCache degrades to a
 *  live call), so the store can throw freely. */
const dbCacheStore: CacheStore = {
  async get(provider, key) {
    const [row] = await db
      .select({ results: researchCache.results, expiresAt: researchCache.expiresAt })
      .from(researchCache)
      .where(and(eq(researchCache.provider, provider), eq(researchCache.cacheKey, key)))
      .limit(1);
    if (!row) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) return null;
    return row.results as RawResource[];
  },
  async set(provider, key, resources, ttlMs) {
    const expiresAt = new Date(Date.now() + ttlMs);
    await db
      .insert(researchCache)
      .values({ provider, cacheKey: key, results: resources, expiresAt })
      .onConflictDoUpdate({
        target: [researchCache.provider, researchCache.cacheKey],
        set: { results: resources, expiresAt, createdAt: new Date() },
      });
  },
};

/** Project a scholarly book/article resource into the shared bibliographic
 *  catalogue, deduped by DOI/ISBN/normalized title (returns the record id). */
async function findOrCreateBibFromResource(r: RawResource): Promise<string | null> {
  const doi = canonicalizeDoi(r.doi);
  const isbn = canonicalizeIsbn(r.isbn);
  if (doi) {
    const [ex] = await db.select({ id: bibliographicRecords.id }).from(bibliographicRecords).where(eq(bibliographicRecords.doi, doi)).limit(1);
    if (ex) return ex.id;
  }
  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: r.provider,
      externalId: isbn ?? null,
      title: r.title,
      authors: r.authors.join(", ") || null,
      year: r.year,
      doi,
      url: r.url,
      accessStatus: "metadata_only",
      raw: r.raw,
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

/**
 * Run-scoped, evidence-first research for the v2 edition (plan §33). Generates
 * search queries (LLM cheap-tier or heuristic), discovers across every enabled
 * source adapter under the cost/saturation/dedup budget, then for each resource
 * records provenance, independent credibility components (authority A–E, never
 * popularity), a source-grounded generated note + claim, and — for scholarly
 * works — a catalogue + graph projection. Never deletes legacy reader records;
 * published atomically by the caller only on success. Every generated note is a
 * grounded floor (no invented facts); LLM prose synthesis is a later add-on
 * gated by the soft cost cap.
 */
export async function analyzeEditionRun(input: {
  runId: string;
  documentId: string;
  text: string;
}): Promise<void> {
  const [doc] = await db
    .select({ userId: documents.userId, workId: documents.workId, title: works.title, authorName: works.authorName })
    .from(documents)
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!doc) throw new Error(`Document ${input.documentId} not found for edition research`);

  const budget = makeBudget();
  const responses = new OpenAIResponsesClient();
  const safetyIdentifier = safetyIdentifierFor(doc.userId);
  const cheapModel = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const researchModel = process.env.OPENAI_MODEL_RESEARCH ?? "gpt-5.4-mini";
  // Conservative upper bound on one mini-model note (~700 in + ~400 out) — used
  // only for the hard-cap affordability gate before starting a synthesis call.
  const NOTE_COST_ESTIMATE = 0.01;
  const usageLogs: (typeof aiUsageLogs.$inferInsert)[] = [];
  const logUsage = (task: string, stage: string, model: string, pTok: number, cTok: number) => {
    const cost = estimateCostUsd(model, pTok, cTok);
    charge(budget, cost);
    usageLogs.push({
      documentId: input.documentId,
      runId: input.runId,
      stage,
      task,
      provider: "openai",
      model,
      promptTokens: pTok,
      completionTokens: cTok,
      estimatedCostUsd: cost,
    });
  };

  await db.update(processingRuns).set({ stage: "research-discovery", updatedAt: new Date() }).where(eq(processingRuns.id, input.runId));

  // Stage 1 (cheap, deterministic): candidate citations seed the query set.
  const citationCandidates = extractCitations(input.text, RESEARCH_LIMITS.maxCitationCandidates);
  const citationTexts = citationCandidates.map((c) => c.text);

  // Lane-specific query generation (LLM cheap-tier or heuristic fallback).
  // Running discovery per lane means a candidate is judged against the question
  // that surfaced it, and each lane only queries providers that can serve it.
  const qg = await generateLaneQueries(responses, {
    primary: { title: doc.title, author: doc.authorName },
    citationTexts,
    model: cheapModel,
    safetyIdentifier,
  });
  if (qg.usedModel) logUsage("query_generation", "research-discovery", cheapModel, qg.promptTokens, qg.completionTokens);

  // Discovery across every adapter (those never consulted still record an
  // honest attempt), each wrapped with the persistent result cache.
  const adapters = allAdapters().map((a) => withCache(a, dbCacheStore));
  const discovery = await runDiscovery({ adapters, rounds: qg.lanes, timeoutMs: 10_000 });

  if (discovery.attempts.length) {
    await db.insert(providerAttempts).values(
      discovery.attempts.map((a) => ({
        runId: input.runId,
        provider: a.provider,
        status: a.status,
        queries: a.queries,
        resultCount: a.resultCount,
        inspectionDepth: a.inspectionDepth,
        latencyMs: a.latencyMs,
        error: a.error ?? null,
      })),
    );
  }

  // ---- Relevance gate: runs BEFORE any authority scoring -----------------
  // Authority answers "how trustworthy is this source?", which is meaningless
  // until "is this source about the right thing?" is settled. Discovery returns
  // real false positives (a marketing paper has ranked first for a scholarly
  // seed query); scoring their authority first would dress them up rather than
  // filter them out.
  await db.update(processingRuns).set({ stage: "relevance-gate", updatedAt: new Date() }).where(eq(processingRuns.id, input.runId));

  const identity: WorkIdentity = {
    title: doc.title,
    authors: doc.authorName ? [doc.authorName] : [],
    year: null,
    doi: null,
    ...buildTopicSignature({
      title: doc.title,
      bodyText: input.text,
      concepts: [doc.title],
    }),
    explicitCitationKeys: new Set(),
    explicitCitationTexts: citationTexts,
    citedAuthorSurnames: citedSurnamesFrom(citationTexts),
    citationGraphKeys: new Set(),
  };

  const assessed = discovery.resources.map((r) => {
    // Prefer the lane that actually surfaced the resource. `laneForResource` is
    // the fallback for anything discovery could not attribute (cached hits,
    // resources with no usable identity key).
    const key = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year });
    const discovered = key ? discovery.laneByKey.get(key) : undefined;
    const provisional = assessCandidate(r, identity, discovered ?? "scholarly_debate");
    // An explicit citation outranks whatever lane found it.
    const lane = provisional.signals.isExplicitCitation
      ? "explicit_citation"
      : discovered ?? laneForResource(r, false);
    return { r, lane, assessment: assessCandidate(r, identity, lane) };
  });

  // Persist EVERY candidate, including rejects. Deleting them would make the
  // pipeline unfalsifiable: the precision/recall gates are measured against
  // exactly these rows.
  if (assessed.length) {
    await db
      .insert(researchCandidates)
      .values(
        assessed.map(({ r, lane, assessment }) => ({
          runId: input.runId,
          lane,
          provider: r.provider,
          title: r.title,
          authors: r.authors,
          year: r.year,
          doi: canonicalizeDoi(r.doi),
          isbn: canonicalizeIsbn(r.isbn),
          canonicalUrl: canonicalizeUrl(r.url),
          venue: r.venue,
          normalizedKey: assessment.normalizedKey,
          verdict: assessment.verdict,
          confidence: assessment.confidence,
          reasons: assessment.reasons,
          signals: assessment.signals,
          venueReliable: assessment.venueReliable,
        })),
      )
      // A lane re-run must update rather than duplicate, or the precision
      // numbers stop meaning anything.
      .onConflictDoNothing();
  }

  const acceptedResources = assessed.filter((a) => a.assessment.verdict === "accepted");
  const gateSummary = {
    accepted: acceptedResources.length,
    quarantined: assessed.filter((a) => a.assessment.verdict === "quarantined").length,
    rejected: assessed.filter((a) => a.assessment.verdict === "rejected").length,
  };
  console.log(
    `[analyze] relevance gate: ${gateSummary.accepted} accepted, ` +
      `${gateSummary.quarantined} quarantined, ${gateSummary.rejected} rejected ` +
      `(of ${assessed.length} discovered)`,
  );

  await db.update(processingRuns).set({ stage: "classification", updatedAt: new Date() }).where(eq(processingRuns.id, input.runId));

  // Highest-authority first, capped by the full-inspection budget. Only
  // ACCEPTED candidates get here — nothing quarantined or rejected is ever
  // scored, projected, or shown.
  const ranked = acceptedResources
    .map(({ r }) => ({ r, authority: classifyAuthority(r) }))
    .sort((a, b) => AUTHORITY_ORDER[a.authority] - AUTHORITY_ORDER[b.authority])
    .slice(0, RESEARCH_LIMITS.maxFullInspections);

  for (const { r, authority } of ranked) {
    const classification = await classifyRelationship({
      primaryTitle: doc.title,
      primaryAuthor: doc.authorName,
      candidateTitle: r.title,
      candidateAuthor: r.authors.join(", ") || null,
      sourceText: r.snippet ?? r.title,
      resolved: Boolean(r.doi || r.isbn),
    });
    if (!classification.heuristic) {
      logUsage("relationship_classification", "classification", classification.model, classification.promptTokens, classification.completionTokens);
    }

    const isScholarly = r.resourceType === "book" || r.resourceType === "article";
    const bibId = isScholarly ? await findOrCreateBibFromResource(r) : null;

    const [resourceRow] = await db
      .insert(researchResources)
      .values({
        runId: input.runId,
        title: r.title,
        url: r.url,
        resourceType: r.resourceType,
        provider: r.provider,
        accessStatus: "metadata_only",
        inspectionDepth: r.snippet ? 1 : 0,
        doi: canonicalizeDoi(r.doi),
        isbn: canonicalizeIsbn(r.isbn),
        canonicalUrl: canonicalizeUrl(r.url),
        normalizedKey: normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year }),
        year: r.year,
        authors: r.authors,
        bibRecordId: bibId,
        raw: r.raw,
      })
      .returning({ id: researchResources.id });

    const cred = buildCredibility(r, {
      relevance: Math.max(0, Math.min(1, classification.confidence)),
      inspectionDepth: r.snippet ? 1 : 0,
      evidenceStrength: r.snippet ? 0.6 : 0.3,
    });
    // Single independent source at this stage → agreement is honestly insufficient.
    const agreement = computeAgreement(1, 0);
    await db.insert(credibilityAssessments).values({
      resourceId: resourceRow.id,
      score: cred.score,
      authority: cred.authority,
      relevance: cred.relevance,
      inspectionDepth: cred.inspectionDepth,
      evidenceStrength: cred.evidenceStrength,
      agreement,
      components: cred,
      rationale: cred.rationale,
    });

    const evidenceText = (r.snippet ?? r.title).slice(0, 1000);
    const [evidence] = await db
      .insert(evidenceSpans)
      .values({ runId: input.runId, resourceId: resourceRow.id, quote: evidenceText })
      .returning({ id: evidenceSpans.id });

    await db.insert(editionRelations).values({
      runId: input.runId,
      resourceId: resourceRow.id,
      relationType: classification.category,
      depth: r.resourceType === "unresolved-citation" ? 0 : 1,
      importance: cred.score,
      evidence: { category: classification.category, sourceText: evidenceText.slice(0, 300) },
      confidence: classification.confidence,
    });

    // Critical note: LLM prose synthesis while under the soft cap and within the
    // hard cap, else the deterministic grounded floor. Claims are graded so a
    // factual claim survives only if its quote is grounded in evidence AND the
    // authority bar is met (plan §33) — the model can neither invent a quotation
    // nor over-assert.
    const authorityOk = meetsFactualBar([authority]);
    const evidenceTexts = [evidenceText, r.snippet ?? ""].filter((t) => t.length > 0);
    let noteBody = heuristicNote(r, classification.category);
    let gradedClaims: { text: string; claimType: "factual" | "interpretive" | "inferred"; grounded: boolean }[] = [];
    if (responses.available && !overSoftCap(budget) && canAfford(budget, NOTE_COST_ESTIMATE)) {
      const syn = await synthesizeNote(responses, {
        primary: { title: doc.title, author: doc.authorName },
        resource: r,
        relation: classification.category,
        evidenceTexts,
        authorityOk,
        model: researchModel,
        safetyIdentifier,
      });
      if (syn.usedModel) {
        noteBody = syn.body;
        gradedClaims = syn.claims;
        logUsage("note_synthesis", "note-synthesis", researchModel, syn.promptTokens, syn.completionTokens);
      }
    }
    const [note] = await db
      .insert(generatedNotes)
      .values({ runId: input.runId, evidenceSpanId: evidence.id, noteType: classification.category, body: noteBody, confidence: classification.confidence })
      .returning({ id: generatedNotes.id });
    const claimsToInsert = gradedClaims.length > 0 ? gradedClaims : [{ text: noteBody, claimType: "interpretive" as const, grounded: false }];
    for (const gc of claimsToInsert) {
      const [claim] = await db
        .insert(generatedClaims)
        .values({ runId: input.runId, noteId: note.id, text: gc.text, claimType: gc.claimType, agreement, confidence: classification.confidence })
        .returning({ id: generatedClaims.id });
      await db.insert(claimEvidence).values({ claimId: claim.id, evidenceSpanId: evidence.id, stance: "supports" });
    }

    // Catalogue/graph projection for scholarly targets (roadmap + graph reuse).
    if (bibId) {
      await db.insert(graphEdges).values({
        userId: doc.userId,
        sourceType: "work",
        sourceId: doc.workId,
        targetType: "bibliographic_record",
        targetId: bibId,
        edgeType: edgeValue(CATEGORY_TO_EDGE[classification.category]),
        weight: 1,
        confidence: classification.confidence,
        evidence: { category: classification.category, provider: r.provider },
        createdBy: "system",
      });
    }
  }

  if (usageLogs.length) await db.insert(aiUsageLogs).values(usageLogs);

  const degraded = Boolean(discovery.saturationNote) || overSoftCap(budget);
  await db
    .update(processingRuns)
    .set({ stage: "validation", aiCostUsd: budget.spentUsd, degraded, saturationNote: discovery.saturationNote, updatedAt: new Date() })
    .where(eq(processingRuns.id, input.runId));
}
