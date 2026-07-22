import {
  aiUsageLogs,
  annotations,
  bibliographicRecords,
  citations,
  citationLibraryLinks,
  claimEvidence,
  concepts as conceptsTable,
  db,
  documents,
  documentApparatus,
  docMetadata,
  editionRelations,
  evidenceSpans,
  generatedClaims,
  generatedNotes,
  graphEdges,
  passageAnnotations,
  processingRuns,
  providerAttempts,
  researchCache,
  researchResources,
  researchResourceContents,
  researchCandidates,
  credibilityAssessments,
  resourceProvenance,
  works,
  workClaims,
  workIdentities,
  learningResources,
  resourceRoles,
  enqueueCitationMetadataResolution,
} from "@ice/db";
import {
  classifyRelationship,
  CLASSIFY_PROMPT_VERSION,
  estimateCostUsd,
  OpenAIResponsesClient,
  RELATIONSHIP_CATEGORIES,
  safetyIdentifierFor,
  type CitationFrequencySignal,
  type RelationshipCategory,
} from "@ice/ai-adapters";
import { resolveCitation, type ResolvedRecord } from "@ice/bibliographic";
import { extractCitationMentions, extractCitations, type CitationSourceInput, type ExtractedAuthorApparatus, type RawCitation } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { createHash } from "node:crypto";
import {
  allAdapters,
  buildCredibility,
  assessCredibilityV3,
  publicationRigor,
  structuralEvidenceStrength,
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
  deriveWorkIdentity,
  type WorkIdentity,
  type WorkIdentityKey,
  synthesizeConcepts,
  synthesizeNote,
  synthesizePassageAnnotations,
  annotationScope,
  chunkSectionAwareBlocks,
  dedupePassageAnnotations,
  type SectionAwareBlock,
  withCache,
  type CacheStore,
  type RawResource,
  type SourceAuthority,
  findOpenAccessEvidence,
  retrieveOpenAccessText,
} from "@ice/research";
import { and, eq, sql } from "drizzle-orm";
import { conservativeInfluenceClassification, verifyCreatorFromProviderMetadata } from "./v3";
import { compactWorkSignal, persistV4WorkSignals } from "./v4";

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

function normalizeFrequencyText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueFrequencyTerms(title: string, authors: string[] | string | null): string[] {
  const terms = new Set<string>();
  const normalizedTitle = normalizeFrequencyText(title);
  if (normalizedTitle.length >= 5) terms.add(normalizedTitle);

  // "Aristotle, Nicomachean Ethics" should count both the full label and the
  // title-bearing part; the author surname is added below.
  for (const part of title.split(/[:,.;]/)) {
    const normalized = normalizeFrequencyText(part);
    if (normalized.length >= 5 && normalized !== normalizedTitle) terms.add(normalized);
  }

  const authorList = Array.isArray(authors) ? authors : authors ? authors.split(/[,;]/) : [];
  for (const author of authorList) {
    const words = normalizeFrequencyText(author).split(/\s+/).filter(Boolean);
    const surname = words.at(-1);
    if (surname && surname.length >= 4) terms.add(surname);
  }

  return [...terms];
}

function countTermMentions(haystack: string, term: string): number {
  if (!haystack || !term) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const found = haystack.indexOf(term, from);
    if (found === -1) break;
    const before = found === 0 ? " " : haystack[found - 1];
    const after = found + term.length >= haystack.length ? " " : haystack[found + term.length];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) count++;
    from = found + Math.max(1, term.length);
  }
  return count;
}

function citationFrequencyFor(
  candidate: { title: string; authors: string[] | string | null },
  documentText: string,
  citationTexts: string[],
): CitationFrequencySignal {
  const terms = uniqueFrequencyTerms(candidate.title, candidate.authors);
  const normalizedDocument = normalizeFrequencyText(documentText);
  const normalizedCitations = citationTexts.map(normalizeFrequencyText).join(" ");
  const matchedTerms: string[] = [];
  let documentMentions = 0;
  let citationMentions = 0;

  for (const term of terms) {
    const docCount = countTermMentions(normalizedDocument, term);
    const citationCount = countTermMentions(normalizedCitations, term);
    if (docCount > 0 || citationCount > 0) matchedTerms.push(term);
    documentMentions += docCount;
    citationMentions += citationCount;
  }

  return { documentMentions, citationMentions, total: documentMentions + citationMentions, matchedTerms };
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
  // Canonical identity has a deliberate, conservative precedence order. Do
  // not merge Aristotle/Plato works merely because their author matches: the
  // final fallback requires normalized title + author + year together.
  const doi = canonicalizeDoi(record.doi);
  const isbn = canonicalizeIsbn(record.externalId);
  const canonicalUrl = canonicalizeUrl(record.url);
  if (doi) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.doi, doi))
      .limit(1);
    if (existing) return existing.id;
  }
  if (isbn ?? record.externalId) {
    const [existing] = await db
      .select({ id: bibliographicRecords.id })
      .from(bibliographicRecords)
      .where(eq(bibliographicRecords.externalId, isbn ?? record.externalId!))
      .limit(1);
    if (existing) return existing.id;
  }
  if (canonicalUrl || record.url) {
    const [existing] = await db.execute(sql`
      SELECT id FROM bibliographic_record
      WHERE url = ${canonicalUrl ?? record.url} OR url = ${record.url ?? canonicalUrl}
      LIMIT 1
    `) as unknown as { id: string }[];
    if (existing) return existing.id;
  }
  if (record.title.trim() && record.authors?.trim() && record.year != null) {
    const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
    const [existing] = await db.execute(sql`
      SELECT id FROM bibliographic_record
      WHERE regexp_replace(lower(title), '[^a-z0-9]', '', 'g') = ${normalize(record.title)}
        AND regexp_replace(lower(COALESCE(authors, '')), '[^a-z0-9]', '', 'g') = ${normalize(record.authors)}
        AND year = ${record.year}
      LIMIT 1
    `) as unknown as { id: string }[];
    if (existing) return existing.id;
  }

  const [created] = await db
    .insert(bibliographicRecords)
    .values({
      source: record.source,
      externalId: isbn ?? record.externalId,
      title: record.title,
      authors: record.authors,
      year: record.year,
      doi,
      url: canonicalUrl ?? record.url,
      accessStatus: record.accessStatus,
      raw: record.raw,
    })
    .returning({ id: bibliographicRecords.id });
  return created.id;
}

function citationIdentityKey(query: string): string {
  return `citation:${createHash("sha256").update(query.trim().toLocaleLowerCase()).digest("hex")}`;
}

function citationSourceLabel(sourceType: "bibliography" | "footnote" | "endnote" | "inline"): string {
  return sourceType === "bibliography" ? "Bibliography" : sourceType === "footnote" ? "Footnote" : sourceType === "endnote" ? "Endnote" : "Direct citation";
}

function citationRoleRationale(citation: RawCitation): string {
  const anchor = citation.anchor;
  const page = anchor?.pageIndex != null ? ` page ${anchor.pageIndex + 1}` : "";
  const marker = anchor?.marker ? ` note ${anchor.marker}` : "";
  return `${citationSourceLabel(citation.sourceType ?? "inline")}${page}${marker}: ${citation.text}`.slice(0, 2_000);
}

async function ensureCitationRole(input: {
  learningResourceId: string;
  workIdentityId: string;
  citation: RawCitation;
}): Promise<void> {
  await db
    .insert(resourceRoles)
    .values({
      learningResourceId: input.learningResourceId,
      workIdentityId: input.workIdentityId,
      relationship: "explicit_reference",
      readerLevel: null,
      rationale: citationRoleRationale(input.citation),
      confidence: input.citation.parserConfidence ?? 0,
      createdBy: "system",
    })
    .onConflictDoUpdate({
      target: [resourceRoles.learningResourceId, resourceRoles.workIdentityId, resourceRoles.readerLevel],
      set: {
        relationship: "explicit_reference",
        rationale: citationRoleRationale(input.citation),
        confidence: input.citation.parserConfidence ?? 0,
      },
    });
}

/**
 * Citation projection deliberately happens before any catalogue lookup or AI
 * stage. The exact source citation becomes a visible Library item immediately;
 * a later resolver may enrich it, but a provider failure can never erase it.
 */
export async function createCitationLibraryProjection(input: {
  citationId: string;
  citation: RawCitation;
  workIdentityId: string;
}): Promise<string> {
  const normalizedKey = citationIdentityKey(input.citation.query);
  const [resource] = await db
    .insert(learningResources)
    .values({
      normalizedKey,
      title: `Needs bibliographic resolution — ${input.citation.text}`.slice(0, 2_000),
      resourceType: "unresolved-citation",
      provider: "citation-extraction",
      authors: [],
    })
    .onConflictDoUpdate({
      target: learningResources.normalizedKey,
      set: {
        title: `Needs bibliographic resolution — ${input.citation.text}`.slice(0, 2_000),
        resourceType: "unresolved-citation",
        provider: "citation-extraction",
        updatedAt: new Date(),
      },
    })
    .returning({ id: learningResources.id });

  await ensureCitationRole({ learningResourceId: resource.id, workIdentityId: input.workIdentityId, citation: input.citation });
  await db
    .insert(citationLibraryLinks)
    .values({ citationId: input.citationId, learningResourceId: resource.id })
    .onConflictDoUpdate({
      target: citationLibraryLinks.citationId,
      set: { learningResourceId: resource.id },
    });
  return resource.id;
}

function resolvedCitationLibraryFields(record: ResolvedRecord) {
  const authors = record.authors
    ? record.authors.split(/\s*;\s*|\s+and\s+|\s*,\s*/).map((author) => author.trim()).filter(Boolean)
    : [];
  return {
    title: record.title,
    url: record.url,
    canonicalUrl: canonicalizeUrl(record.url),
    doi: canonicalizeDoi(record.doi),
    isbn: null,
    resourceType: "bibliographic",
    provider: record.source,
    year: record.year,
    authors,
    venue: null,
    peerReviewed: null,
  };
}

/**
 * Worker-queue consumer for metadata resolution. It is intentionally
 * serialized by the worker queue; this makes external lookup rate-limited and
 * keeps the immediate citation projection independent from provider health.
 */
export async function resolveCitationMetadata(citationId: string): Promise<void> {
  const [citation] = await db
    .select({
      id: citations.id,
      documentId: citations.documentId,
      rawText: citations.rawText,
      normalizedQuery: citations.normalizedQuery,
      sourceType: citations.sourceType,
      parserConfidence: citations.parserConfidence,
      sourceAnchor: citations.sourceAnchor,
      workId: documents.workId,
      workIdentityId: works.workIdentityId,
      userId: documents.userId,
    })
    .from(citations)
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(citations.id, citationId))
    .limit(1);
  if (!citation) return;

  let record: ResolvedRecord | null = null;
  try {
    record = await resolveCitation(citation.normalizedQuery);
  } catch (error) {
    // Resolution availability is not a prerequisite for Library coverage.
    reportError(error, { scope: "worker.resolveCitationMetadata", citationId });
  }
  if (!record) {
    await db.update(citations).set({ resolutionState: "unresolved", resolutionSource: "unresolved" }).where(eq(citations.id, citationId));
    return;
  }

  const bibId = await findOrCreateBibRecord(record);
  const [link] = await db
    .select({ learningResourceId: citationLibraryLinks.learningResourceId })
    .from(citationLibraryLinks)
    .where(eq(citationLibraryLinks.citationId, citationId))
    .limit(1);
  const citationMention: RawCitation = {
    text: citation.rawText,
    query: citation.normalizedQuery,
    kind: citation.sourceType === "inline" ? "inline" : "reference",
    sourceType: citation.sourceType,
    parserConfidence: citation.parserConfidence,
    anchor: citation.sourceAnchor as RawCitation["anchor"],
  };
  const fields = resolvedCitationLibraryFields(record);
  const canonicalKey = normalizedKey({
    doi: fields.doi,
    isbn: fields.isbn,
    url: fields.url,
    title: fields.title,
    authors: fields.authors,
    year: fields.year,
  });

  if (link && canonicalKey) {
    const [existing] = await db
      .select({ id: learningResources.id })
      .from(learningResources)
      .where(eq(learningResources.normalizedKey, canonicalKey))
      .limit(1);
    const targetId = existing?.id ?? link.learningResourceId;
    if (citation.workIdentityId) await ensureCitationRole({ learningResourceId: targetId, workIdentityId: citation.workIdentityId, citation: citationMention });
    if (existing && existing.id !== link.learningResourceId) {
      // Merge every provenance link before removing the temporary stub. This
      // makes DOI/ISBN/URL/title identity canonical without duplicate rows.
      await db.update(citationLibraryLinks).set({ learningResourceId: existing.id }).where(eq(citationLibraryLinks.learningResourceId, link.learningResourceId));
      await db.delete(resourceRoles).where(eq(resourceRoles.learningResourceId, link.learningResourceId));
      await db.delete(learningResources).where(eq(learningResources.id, link.learningResourceId));
    } else {
      await db.update(learningResources).set({ ...fields, normalizedKey: canonicalKey, bibRecordId: bibId, updatedAt: new Date() }).where(eq(learningResources.id, link.learningResourceId));
    }
  }

  await db.update(citations).set({ resolvedBibId: bibId, resolutionSource: record.source, resolutionState: "resolved" }).where(eq(citations.id, citationId));
  const [existingEdge] = await db
    .select({ id: graphEdges.id })
    .from(graphEdges)
    .where(and(
      eq(graphEdges.userId, citation.userId),
      eq(graphEdges.sourceType, "work"),
      eq(graphEdges.sourceId, citation.workId),
      eq(graphEdges.targetType, "bibliographic_record"),
      eq(graphEdges.targetId, bibId),
      eq(graphEdges.edgeType, "cites"),
    ))
    .limit(1);
  if (!existingEdge) {
    await db.insert(graphEdges).values({
      userId: citation.userId,
      sourceType: "work",
      sourceId: citation.workId,
      targetType: "bibliographic_record",
      targetId: bibId,
      edgeType: "cites",
      weight: 1,
      confidence: citation.parserConfidence,
      evidence: { citationId, sourceType: citation.sourceType, anchor: citation.sourceAnchor },
      createdBy: "system",
    });
  }
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
    const citationTexts = candidates.map((candidate) => `${candidate.text} ${candidate.query}`);
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
        normalizedQuery: candidate.query,
        sourceType: candidate.kind === "inline" ? "inline" : "bibliography",
        parserConfidence: candidate.kind === "inline" ? 0.74 : 0.8,
        resolvedBibId: bibId,
        resolutionSource: record?.source ?? "unresolved",
        resolutionState: record ? "resolved" : "unresolved",
      });

      // --- Anchoring (text docs only) ---
      const located = isText ? buildTextAnchor(paragraphs, leadingSurname(candidate.query)) : null;
      const sourceText = located?.sourceText ?? candidate.text;
      const citationFrequency = citationFrequencyFor(
        { title: record?.title ?? candidate.text.slice(0, 160), authors: record?.authors ?? null },
        doc.extractedText ?? "",
        citationTexts,
      );

      // --- Stage 2: classify the relationship ---
      const classification = await classifyRelationship({
        primaryTitle: doc.title,
        primaryAuthor: doc.authorName,
        candidateTitle: record?.title ?? candidate.text.slice(0, 160),
        candidateAuthor: record?.authors ?? null,
        sourceText,
        resolved: Boolean(record),
        citationFrequency,
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
          evidence: { extractedSourceText: sourceText, category: classification.category, citationFrequency },
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
 * Find-or-create the shared `work_identity` row for a computed identity key
 * (plan §34.4 9.5). Unlike `findOrCreateBibFromResource`'s catalogue,
 * `work_identity.workKey` carries a real unique constraint, so a plain
 * select-then-insert can lose a race between two concurrent runs that
 * resolve to the same work — `onConflictDoNothing` + re-select closes it.
 */
async function findOrCreateWorkIdentity(identity: WorkIdentityKey, authors: string[]): Promise<string | null> {
  const inserted = await db
    .insert(workIdentities)
    .values({
      workKey: identity.key,
      canonicalTitle: identity.canonicalTitle,
      authorSurname: identity.authorSurname,
      authors,
      evidence: identity.evidence,
    })
    .onConflictDoNothing({ target: workIdentities.workKey })
    .returning({ id: workIdentities.id });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await db.select({ id: workIdentities.id }).from(workIdentities).where(eq(workIdentities.workKey, identity.key)).limit(1);
  return existing?.id ?? null;
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
  pipeline?: "v1" | "v2" | "v3" | "v4";
  /** Real body blocks in document order. v4 adds page/section scope. */
  bodyBlocks?: { id: string; text: string; pageIndex?: number; blockOrder?: number; sectionTitle?: string | null }[];
  /** Deterministic source apparatus extracted from structural blocks. */
  apparatus?: ExtractedAuthorApparatus[];
}): Promise<void> {
  const [doc] = await db
    .select({ userId: documents.userId, workId: documents.workId, title: works.title, authorName: works.authorName })
    .from(documents)
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!doc) throw new Error(`Document ${input.documentId} not found for edition research`);
  const isV4 = input.pipeline === "v4";
  const isModernPipeline = input.pipeline === "v3" || isV4;
  const setStage = async (v2Stage: string, v3Stage: string, v4Stage = v3Stage) => {
    await db.update(processingRuns).set({
      stage: isV4 ? v4Stage : isModernPipeline ? v3Stage : v2Stage,
      updatedAt: new Date(),
    }).where(eq(processingRuns.id, input.runId));
  };

  // Prefer the metadata THIS run actually extracted over the work's provisional
  // title. Until the user confirms metadata, `works.title` is derived from the
  // filename ("Irwin-ViceReason-2001.pdf" → "Irwin ViceReason 2001"), which is
  // not the work's identity and makes every downstream query and relevance
  // decision wrong. Observed in a production canary: GROBID had extracted
  // "Vice and Reason" correctly and the research stage ignored it.
  const [extracted] = await db
    .select({ title: docMetadata.title, authors: docMetadata.authors })
    .from(docMetadata)
    .where(eq(docMetadata.runId, input.runId))
    .limit(1);
  const extractedAuthors = Array.isArray(extracted?.authors)
    ? (extracted.authors as unknown[]).filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : [];
  const resolvedTitle = extracted?.title?.trim() || doc.title;
  const resolvedAuthors = extractedAuthors.length
    ? extractedAuthors
    : doc.authorName
      ? [doc.authorName]
      : [];
  const resolvedAuthorName = resolvedAuthors.join(", ") || null;

  // Give the PRIMARY work its own canonical identity before citation
  // projection. Citation Library coverage must not wait for discovery or AI
  // classification, so this identity is established at the start of every
  // edition pipeline that can persist structural citations.
  // — the same `deriveWorkIdentity` computation already applied to every
  // cited resource (migration 0014) — so the Library can later join "what
  // was recommended for MY works" via `works.workIdentityId` instead of
  // re-deriving/matching workKey strings in application code. Lazy and
  // idempotent: only set once, harmless to repeat on reprocess.
  let primaryWorkIdentityId: string | null = null;
  if (input.pipeline !== "v1") {
    const primaryIdentity = deriveWorkIdentity({
      title: resolvedTitle,
      authors: resolvedAuthors,
      year: null,
      doi: null,
      isbn: null,
      resourceType: "book",
    });
    primaryWorkIdentityId = await findOrCreateWorkIdentity(primaryIdentity, resolvedAuthors);
    if (primaryWorkIdentityId) {
      await db
        .update(works)
        .set({ workIdentityId: primaryWorkIdentityId, updatedAt: new Date() })
        .where(and(eq(works.id, doc.workId), sql`${works.workIdentityId} is null`));
    }
  }

  const budget = makeBudget();
  const responses = new OpenAIResponsesClient();
  const safetyIdentifier = safetyIdentifierFor(doc.userId);
  const cheapModel = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const researchModel = process.env.OPENAI_MODEL_RESEARCH ?? "gpt-5.4-mini";
  // Conservative upper bound on one mini-model note (~700 in + ~400 out) — used
  // only for the hard-cap affordability gate before starting a synthesis call.
  const NOTE_COST_ESTIMATE = 0.01;
  const usageLogs: (typeof aiUsageLogs.$inferInsert)[] = [];
  const logUsage = (task: string, stage: string, model: string, pTok: number, cTok: number, costOverride?: number) => {
    const cost = costOverride ?? estimateCostUsd(model, pTok, cTok);
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

  // v3 only, and only when the extraction stage found real body blocks to
  // anchor to (see index.ts: `bodyBlocks` is only ever the actually-inserted
  // text_block rows). One bulk call regardless of document length keeps cost
  // bounded — a per-block loop would scale with page count, which nothing
  // else in this pipeline does either. No heuristic fallback when unavailable:
  // "zero passage annotations this run" is the honest degraded state, not a
  // guess dressed up as one (see synthesizePassageAnnotations's doc comment).
  const v4Claims: { textBlockId: string | null; claim: string; claimType: string; supportingExcerpt: string; confidence: number }[] = [];
  if (isV4 && input.bodyBlocks?.length) {
    const scopedBlocks: SectionAwareBlock[] = input.bodyBlocks.map((block, index) => ({
      blockId: block.id,
      text: block.text,
      pageIndex: block.pageIndex ?? 0,
      blockOrder: block.blockOrder ?? index,
      sectionTitle: block.sectionTitle ?? null,
    }));
    const chunks = chunkSectionAwareBlocks(scopedBlocks);
    const blocksById = new Map(scopedBlocks.map((block) => [block.blockId, block]));
    const annotations = [];
    const PASSAGE_ANNOTATION_COST_ESTIMATE = 0.01;
    for (const chunk of chunks) {
      if (!canAfford(budget, PASSAGE_ANNOTATION_COST_ESTIMATE) || overSoftCap(budget)) break;
      const synthesized = await synthesizePassageAnnotations(responses, {
        primary: { title: resolvedTitle, author: resolvedAuthorName },
        blocks: chunk.blocks,
        validRelationships: RELATIONSHIP_CATEGORIES,
        model: cheapModel,
        safetyIdentifier,
        maxAnnotations: 5,
        includeHelpfulFor: true,
        maxBlockChars: 12_000,
      });
      if (synthesized.usedModel) {
        logUsage("passage_annotation_synthesis", "section-aware-annotations", cheapModel, synthesized.promptTokens, synthesized.completionTokens);
      }
      annotations.push(...synthesized.annotations);
    }
    const deduped = dedupePassageAnnotations(annotations);
    if (deduped.length) {
      await db.insert(passageAnnotations).values(deduped.map((annotation) => ({
        runId: input.runId,
        textBlockId: annotation.blockId,
        isWholeWork: annotation.isWholeWork,
        quote: annotation.quote,
        summary: annotation.summary,
        explanation: annotation.explanation,
        helpfulFor: annotation.helpfulFor,
        scope: annotationScope(annotation, blocksById),
        annotationType: annotation.annotationType,
        relationship: annotation.relationship as RelationshipCategory,
        readerLevel: annotation.readerLevel,
        confidence: annotation.confidence,
      })));
      v4Claims.push(...deduped
        .filter((annotation) => annotation.annotationType === "argument" || annotation.annotationType === "evidence")
        .map((annotation) => ({
          textBlockId: annotation.blockId,
          claim: annotation.summary,
          claimType: annotation.annotationType,
          supportingExcerpt: annotation.quote ?? annotation.explanation,
          confidence: annotation.confidence,
        })));
      console.log(`[analyze] wrote ${deduped.length} section-aware passage annotation(s) for run ${input.runId}`);
    }
  } else if (input.pipeline === "v3" && input.bodyBlocks?.length) {
    // Cap both block COUNT and total characters sent, independent of NOTE_COST_ESTIMATE
    // below (that constant is scoped to the per-resource note loop).
    const candidateBlocks: { blockId: string; text: string }[] = [];
    let totalChars = 0;
    for (const b of input.bodyBlocks) {
      if (candidateBlocks.length >= 60 || totalChars >= 12_000) break;
      candidateBlocks.push({ blockId: b.id, text: b.text });
      totalChars += b.text.length;
    }
    const PASSAGE_ANNOTATION_COST_ESTIMATE = 0.01;
    if (canAfford(budget, PASSAGE_ANNOTATION_COST_ESTIMATE)) {
      const synthesized = await synthesizePassageAnnotations(responses, {
        primary: { title: resolvedTitle, author: resolvedAuthorName },
        blocks: candidateBlocks,
        validRelationships: RELATIONSHIP_CATEGORIES,
        model: cheapModel,
        safetyIdentifier,
      });
      if (synthesized.usedModel) {
        logUsage("passage_annotation_synthesis", "section-passage-anchors", cheapModel, synthesized.promptTokens, synthesized.completionTokens);
      }
      if (synthesized.annotations.length) {
        await db.insert(passageAnnotations).values(
          synthesized.annotations.map((a) => ({
            runId: input.runId,
            textBlockId: a.blockId,
            isWholeWork: a.isWholeWork,
            quote: a.quote,
            summary: a.summary,
            explanation: a.explanation,
            annotationType: a.annotationType,
            relationship: a.relationship as RelationshipCategory,
            readerLevel: a.readerLevel,
            confidence: a.confidence,
          })),
        );
        console.log(`[analyze] wrote ${synthesized.annotations.length} passage annotation(s) for run ${input.runId}`);
      }
    }
  }

  if (isModernPipeline && input.apparatus?.length) {
    await setStage("research-discovery", "explicit-citations", "author-apparatus");
    await db.insert(documentApparatus).values(input.apparatus.map((entry) => ({
      runId: input.runId,
      textBlockId: entry.textBlockId,
      kind: entry.kind,
      marker: entry.marker,
      text: entry.text,
      scope: entry.scope,
      source: entry.source,
    })));
    console.log(`[analyze] wrote ${input.apparatus.length} author apparatus record(s) for run ${input.runId}`);
  }

  await setStage("research-discovery", "explicit-citations", "explicit-citations");

  // Stage 1 (cheap, deterministic): source-aware citation mentions seed the
  // query set. Apparatus stays out of processed body text, but it is a
  // first-class extraction input with its own anchor and provenance.
  const structuralCitationSources: CitationSourceInput[] = [
    ...(input.bodyBlocks ?? []).map((block) => ({
      sourceType: "inline" as const,
      text: block.text,
      textBlockId: block.id,
      pageIndex: block.pageIndex ?? null,
      blockOrder: block.blockOrder ?? null,
      parserConfidence: 0.82,
    })),
    ...(input.apparatus ?? []).flatMap((entry): CitationSourceInput[] => {
      const sourceType = entry.kind === "bibliography_entry"
        ? "bibliography"
        : entry.kind === "footnote"
          ? "footnote"
          : entry.kind === "endnote"
            ? "endnote"
            : null;
      if (!sourceType) return [];
      const scope = entry.scope as { pageIndex?: number; blockOrder?: number };
      return [{
        sourceType,
        text: entry.text,
        textBlockId: entry.textBlockId,
        pageIndex: scope.pageIndex ?? null,
        blockOrder: scope.blockOrder ?? null,
        marker: entry.marker,
        parserConfidence: entry.source === "structure" ? 0.98 : 0.65,
      }];
    }),
  ];
  const citationCandidates = structuralCitationSources.length
    ? extractCitationMentions(structuralCitationSources, RESEARCH_LIMITS.maxCitationCandidates)
    : extractCitations(input.text, RESEARCH_LIMITS.maxCitationCandidates);

  if (primaryWorkIdentityId) {
    for (const citation of citationCandidates) {
      const [persisted] = await db
        .insert(citations)
        .values({
          documentId: input.documentId,
          processingRunId: input.runId,
          textBlockId: citation.anchor?.textBlockId ?? null,
          rawText: citation.text,
          normalizedQuery: citation.query,
          sourceType: citation.sourceType ?? (citation.kind === "inline" ? "inline" : "bibliography"),
          parserConfidence: citation.parserConfidence ?? 0,
          sourceAnchor: citation.anchor ?? null,
          resolutionSource: "unresolved",
          resolutionState: "pending",
        })
        .returning({ id: citations.id });
      await createCitationLibraryProjection({ citationId: persisted.id, citation, workIdentityId: primaryWorkIdentityId });
      try {
        await enqueueCitationMetadataResolution(persisted.id);
      } catch (error) {
        // Queue availability cannot turn a durable citation into an omission.
        reportError(error, { scope: "worker.enqueueCitationMetadata", citationId: persisted.id });
      }
    }
  }
  // Two different consumers, two different shapes:
  //  - `citationTexts` keeps the VERBATIM entry, which the relevance gate
  //    matches a discovered title against for containment.
  //  - `citationQueries` is the cleaned lookup string (cue words and
  //    publisher imprints stripped), which is what a catalogue search wants.
  const citationTexts = citationCandidates.map((c) => c.text);
  const citationQueries = citationCandidates.map((c) => c.query);

  // V3 (Phase 9.4, plan §34.4): real extraction for what was, until now, only
  // a label on this stage (the topic signature derived purely from citation
  // metadata — no concepts, people, or debates with an LLM at all). A
  // per-work diagnostic quiz needs something real to ask about, so this
  // extracts the concepts/doctrines/people/traditions/debates the work
  // itself requires or discusses, in one bulk call (bounded cost regardless
  // of document length, same pattern as `synthesizePassageAnnotations`), and
  // shares them in the global `concept` catalog — append-only, like
  // `bibliographic_record`, so two readers studying the same doctrine land
  // on the same node. Falls back to an honest empty result with no model
  // key; extracted labels also feed lane query generation below, replacing
  // the resolvedTitle-only placeholder with the work's actual vocabulary.
  await setStage("research-discovery", "concepts-people-debates");
  let extractedConceptLabels: string[] = [];
  if (isModernPipeline) {
    const CONCEPT_EXTRACTION_COST_ESTIMATE = 0.01;
    if (canAfford(budget, CONCEPT_EXTRACTION_COST_ESTIMATE)) {
      const synthesizedConcepts = await synthesizeConcepts(responses, {
        primary: { title: resolvedTitle, author: resolvedAuthorName },
        textSample: input.text,
        model: cheapModel,
        safetyIdentifier,
      });
      if (synthesizedConcepts.usedModel) {
        logUsage(
          "concept_extraction",
          "concepts-people-debates",
          cheapModel,
          synthesizedConcepts.promptTokens,
          synthesizedConcepts.completionTokens,
        );
      }
      if (synthesizedConcepts.concepts.length) {
        extractedConceptLabels = synthesizedConcepts.concepts.map((c) => c.label);
        for (const c of synthesizedConcepts.concepts) {
          const [existingConcept] = await db
            .select({ id: conceptsTable.id })
            .from(conceptsTable)
            .where(eq(conceptsTable.slug, c.slug))
            .limit(1);
          const conceptId =
            existingConcept?.id ??
            (
              await db
                .insert(conceptsTable)
                .values({ slug: c.slug, kind: c.kind, label: c.label, summary: c.summary })
                .returning({ id: conceptsTable.id })
            )[0].id;

          // Idempotent-safe on reprocess: graph_edge has no runId scope of
          // its own (unlike research_resource/passage_annotation), so a
          // repeat run over the same work would otherwise duplicate this
          // edge indefinitely rather than just refreshing it.
          const [existingEdge] = await db
            .select({ id: graphEdges.id })
            .from(graphEdges)
            .where(
              and(
                eq(graphEdges.userId, doc.userId),
                eq(graphEdges.sourceType, "work"),
                eq(graphEdges.sourceId, doc.workId),
                eq(graphEdges.targetType, "concept"),
                eq(graphEdges.targetId, conceptId),
              ),
            )
            .limit(1);
          if (!existingEdge) {
            await db.insert(graphEdges).values({
              userId: doc.userId,
              sourceType: "work",
              sourceId: doc.workId,
              targetType: "concept",
              targetId: conceptId,
              edgeType: "presupposes",
              confidence: c.confidence,
              evidence: { role: c.role, reason: c.evidence },
              createdBy: "system",
            });
          }
        }
        console.log(`[analyze] wrote ${synthesizedConcepts.concepts.length} concept(s) for run ${input.runId}`);
      }
    }
  }

  if (isV4) {
    await setStage("research-discovery", "lane-discovery", "lightweight-work-signals");
    if (v4Claims.length) {
      await db.insert(workClaims).values(v4Claims.map((claim) => ({
        runId: input.runId,
        workId: doc.workId,
        textBlockId: claim.textBlockId,
        claim: claim.claim,
        claimType: claim.claimType,
        supportingExcerpt: claim.supportingExcerpt,
        confidence: claim.confidence,
      })));
    }
    const signal = compactWorkSignal({
      title: resolvedTitle,
      author: resolvedAuthorName,
      concepts: extractedConceptLabels,
      claims: v4Claims.map((claim) => ({ claim: claim.claim, supportingExcerpt: claim.supportingExcerpt })),
    });
    const workSignals = await persistV4WorkSignals({
      runId: input.runId,
      workId: doc.workId,
      userId: doc.userId,
      signal,
      budget,
      logUsage: (model, inputTokens, cost) => logUsage("work_embedding", "lightweight-work-signals", model, inputTokens, 0, cost),
    });
    console.log(`[analyze] v4 work signals for run ${input.runId}: ${workSignals.embedded ? "embedded" : "no embedding"}, ${workSignals.candidates} candidate(s)`);
  }

  // Lane-specific query generation (LLM cheap-tier or heuristic fallback).
  // Running discovery per lane means a candidate is judged against the question
  // that surfaced it, and each lane only queries providers that can serve it.
  const concepts = extractedConceptLabels.length ? extractedConceptLabels : [resolvedTitle];
  await setStage("research-discovery", "lane-discovery", "lane-discovery");
  const qg = await generateLaneQueries(responses, {
    primary: { title: resolvedTitle, author: resolvedAuthorName },
    citationTexts: citationQueries,
    concepts,
    model: cheapModel,
    safetyIdentifier,
  });
  if (qg.usedModel) logUsage("query_generation", "research-discovery", cheapModel, qg.promptTokens, qg.completionTokens);
  const explicitCitationMatchTexts = [
    ...citationTexts,
    ...(qg.lanes.find((lane) => lane.lane === "explicit_citation")?.queries ?? []),
  ];

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
  await setStage("relevance-gate", "relevance-gate");

  const identity: WorkIdentity = {
    title: resolvedTitle,
    authors: resolvedAuthors,
    year: null,
    doi: null,
    ...buildTopicSignature({
      title: resolvedTitle,
      bodyText: input.text,
      concepts,
      authors: resolvedAuthors,
    }),
    explicitCitationKeys: new Set(),
    explicitCitationTexts: explicitCitationMatchTexts,
    documentTextForExplicitTitleMatch: input.text,
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
  const frequencyCitationTexts = citationCandidates.map((candidate) => `${candidate.text} ${candidate.query}`);
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

  await setStage("classification", "creator-verification");

  // Highest-authority first, capped by the full-inspection budget. Only
  // ACCEPTED candidates get here — nothing quarantined or rejected is ever
  // scored, projected, or shown.
  const ranked = acceptedResources
    .map(({ r, assessment }) => ({ r, assessment, authority: classifyAuthority(r) }))
    .sort((a, b) => AUTHORITY_ORDER[a.authority] - AUTHORITY_ORDER[b.authority])
    .slice(0, RESEARCH_LIMITS.maxFullInspections);
  // Full text is never an input to the paid research stages. It is a bounded
  // post-discovery retrieval only for records whose provider metadata carries
  // an explicit approved license, so this cannot expand the existing $1/$5 AI
  // budget or silently copy a paywalled source.
  let openAccessRetrievals = 0;
  const relationProjection: { id: string; workKey: string | null; workRole: "primary" | "review" | "edition" | "translation" | "excerpt" }[] = [];

  // Creator verification is a separate pass so every accepted resource gets a
  // provider-metadata-only identity before citation expansion or scoring.
  const verifiedCreators = new Map(ranked.map(({ r }) => [
    normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year }) ?? r.title,
    verifyCreatorFromProviderMetadata(r),
  ]));
  await setStage("classification", "citation-graph-expansion");

  for (const { r, assessment, authority } of ranked) {
    const citationFrequency = citationFrequencyFor({ title: r.title, authors: r.authors }, input.text, frequencyCitationTexts);
    const classify = () => classifyRelationship({
      primaryTitle: resolvedTitle,
      primaryAuthor: resolvedAuthorName,
      candidateTitle: r.title,
      candidateAuthor: r.authors.join(", ") || null,
      sourceText: r.snippet ?? r.title,
      resolved: Boolean(r.doi || r.isbn),
      citationFrequency,
    });
    // V2 classifies before writing its note as it always has. V3 deliberately
    // delays this until the final conservative-influence stage: a source first
    // earns relevance, creator evidence, citation expansion, credibility and
    // grounded claims; only then may an AI-assisted relationship label be
    // attached. Until then the note carries the honest generic aid label.
    let classification = isModernPipeline ? null : await classify();
    if (classification && !classification.heuristic) {
      logUsage("relationship_classification", "classification", classification.model, classification.promptTokens, classification.completionTokens);
    }
    const relevanceConfidence = isModernPipeline ? assessment.confidence : classification!.confidence;
    const provisionalCategory: RelationshipCategory = classification?.category ?? "interpretive_aid";

    const isScholarly = r.resourceType === "book" || r.resourceType === "article";
    const bibId = isScholarly ? await findOrCreateBibFromResource(r) : null;
    const openAccess = findOpenAccessEvidence(r.raw, r.url);
    const resourceWork = deriveWorkIdentity(r, { citedAuthorSurnames: identity.citedAuthorSurnames });

    const [resourceRow] = await db
      .insert(researchResources)
      .values({
        runId: input.runId,
        title: r.title,
        url: r.url,
        resourceType: r.resourceType,
        provider: r.provider,
        accessStatus: openAccess ? "open" : "metadata_only",
        inspectionDepth: r.snippet ? 1 : 0,
        doi: canonicalizeDoi(r.doi),
        isbn: canonicalizeIsbn(r.isbn),
        canonicalUrl: canonicalizeUrl(r.url),
        normalizedKey: normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year }),
        // Canonical WORK identity, so the Library can show one entry per work
        // with its reviews and editions attached instead of repeating a book.
        workKey: resourceWork.key,
        workRole: resourceWork.role,
        workCanonicalTitle: resourceWork.canonicalTitle,
        workAuthorSurname: resourceWork.authorSurname,
        workEvidence: resourceWork.evidence,
        year: r.year,
        authors: r.authors,
        bibRecordId: bibId,
        raw: r.raw,
      })
      .returning({ id: researchResources.id });

    // Provider/query provenance was already retained in raw metadata, but a
    // first-class row makes a source node's evidence inspectable without
    // parsing provider-specific JSON. The graph joins this run-scoped record.
    await db.insert(resourceProvenance).values({
      resourceId: resourceRow.id,
      provider: r.provider,
      query: qg.lanes.flatMap((lane) => lane.queries).join(" | ").slice(0, 2_000),
      inspectedAt: new Date(),
      inspectionDepth: r.snippet ? 1 : 0,
    });

    if (openAccess) {
      const retrieved = openAccessRetrievals < RESEARCH_LIMITS.maxOpenAccessRetrievals
        ? (openAccessRetrievals++, await retrieveOpenAccessText(openAccess))
        : { status: "open_access_available" as const, error: "Automatic open-access retrieval cap reached for this run." };
      await db.insert(researchResourceContents).values({
        resourceId: resourceRow.id,
        status: retrieved.status,
        sourceUrl: openAccess.sourceUrl,
        license: openAccess.license,
        licenseEvidence: openAccess.evidence,
        ...(retrieved.status === "open_access_indexed"
          ? { text: retrieved.text, contentHash: retrieved.contentHash, retrievedAt: retrieved.retrievedAt }
          : { error: retrieved.error ?? null }),
      });
    }
    relationProjection.push({ id: resourceRow.id, workKey: resourceWork.key, workRole: resourceWork.role });

    await setStage("classification", "credibility");
    // Structural cues (study design, sample size, statistics, hedging) beat
    // the old binary "does any snippet exist" check for scholarly articles —
    // deterministic, no model call, scoped to where the regex classes
    // actually mean something (see structuralEvidenceStrength's doc comment).
    const evidenceStrengthSignal = structuralEvidenceStrength(r);
    const cred = buildCredibility(r, {
      relevance: Math.max(0, Math.min(1, relevanceConfidence)),
      inspectionDepth: r.snippet ? 1 : 0,
      evidenceStrength: evidenceStrengthSignal.score,
    });
    // Single independent source at this stage → agreement is honestly insufficient.
    const agreement = computeAgreement(1, 0);
    const creatorKey = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year }) ?? r.title;
    const v3Credibility = isModernPipeline
      ? assessCredibilityV3(r, {
          relevance: Math.max(0, Math.min(1, relevanceConfidence)),
          evidenceStrength: evidenceStrengthSignal.score,
          evidenceStrengthWhy: evidenceStrengthSignal.why,
          creator: verifiedCreators.get(creatorKey),
        })
      : null;
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
      ...(v3Credibility ? {
        publicationRigor: v3Credibility.dimensions.publicationRigor,
        creatorExpertise: v3Credibility.dimensions.creatorExpertise,
        hostProvenance: v3Credibility.dimensions.hostProvenance,
        pedagogicalValue: v3Credibility.dimensions.pedagogicalValue,
        creator: v3Credibility.creator,
        peerReviewed: publicationRigor(r).peerReviewed,
        popularity: v3Credibility.popularity,
        rationale: v3Credibility.rationale,
      } : {}),
    });

    const evidenceText = (r.snippet ?? r.title).slice(0, 1000);
    const [evidence] = await db
      .insert(evidenceSpans)
      .values({ runId: input.runId, resourceId: resourceRow.id, quote: evidenceText })
      .returning({ id: evidenceSpans.id });

    await db.insert(editionRelations).values({
      runId: input.runId,
      resourceId: resourceRow.id,
      relationType: provisionalCategory,
      depth: r.resourceType === "unresolved-citation" ? 0 : 1,
      importance: cred.score,
      evidence: { category: provisionalCategory, sourceText: evidenceText.slice(0, 300), citationFrequency },
      confidence: relevanceConfidence,
    });

    // Critical note: LLM prose synthesis while under the soft cap and within the
    // hard cap, else the deterministic grounded floor. Claims are graded so a
    // factual claim survives only if its quote is grounded in evidence AND the
    // authority bar is met (plan §33) — the model can neither invent a quotation
    // nor over-assert.
    const authorityOk = meetsFactualBar([authority]);
    const evidenceTexts = [evidenceText, r.snippet ?? ""].filter((t) => t.length > 0);
    let noteBody = heuristicNote(r, provisionalCategory);
    let gradedClaims: { text: string; claimType: "factual" | "interpretive" | "inferred"; grounded: boolean }[] = [];
    if (responses.available && !overSoftCap(budget) && canAfford(budget, NOTE_COST_ESTIMATE)) {
      const syn = await synthesizeNote(responses, {
        primary: { title: doc.title, author: doc.authorName },
        resource: r,
        relation: provisionalCategory,
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
    await setStage("classification", "claims");
    const [note] = await db
      .insert(generatedNotes)
      .values({ runId: input.runId, evidenceSpanId: evidence.id, noteType: provisionalCategory, body: noteBody, confidence: relevanceConfidence })
      .returning({ id: generatedNotes.id });
    const claimsToInsert = gradedClaims.length > 0 ? gradedClaims : [{ text: noteBody, claimType: "interpretive" as const, grounded: false }];
    for (const gc of claimsToInsert) {
      const [claim] = await db
        .insert(generatedClaims)
        .values({ runId: input.runId, noteId: note.id, text: gc.text, claimType: gc.claimType, agreement, confidence: relevanceConfidence })
        .returning({ id: generatedClaims.id });
      await db.insert(claimEvidence).values({ claimId: claim.id, evidenceSpanId: evidence.id, stance: "supports" });
    }

    // Catalogue/graph projection for scholarly targets (roadmap + graph reuse).
    await setStage("classification", "conservative-influence-classification");
    if (isModernPipeline) classification = await classify();
    if (!classification!.heuristic && isModernPipeline) {
      logUsage("relationship_classification", "conservative-influence-classification", classification!.model, classification!.promptTokens, classification!.completionTokens);
    }
    const conservativeCategory = isModernPipeline
      ? conservativeInfluenceClassification(classification!.category, evidenceText)
      : classification!.category;
    if (isModernPipeline) {
      await db.update(editionRelations).set({
        relationType: conservativeCategory,
        evidence: { category: conservativeCategory, sourceText: evidenceText.slice(0, 300), citationFrequency },
        confidence: classification!.confidence,
      }).where(and(eq(editionRelations.runId, input.runId), eq(editionRelations.resourceId, resourceRow.id)));
      await db.update(generatedNotes).set({ noteType: conservativeCategory, confidence: classification!.confidence }).where(eq(generatedNotes.id, note.id));
    }
    if (bibId) {
      await db.insert(graphEdges).values({
        userId: doc.userId,
        sourceType: "work",
        sourceId: doc.workId,
        targetType: "bibliographic_record",
        targetId: bibId,
        edgeType: edgeValue(CATEGORY_TO_EDGE[conservativeCategory]),
        weight: 1,
        confidence: classification!.confidence,
        evidence: { category: conservativeCategory, provider: r.provider, citationFrequency },
        createdBy: "system",
      });
    }

    // Promote into the standing Library (plan §34.4 9.5), v3 only: a durable,
    // cross-run/cross-user projection so a reader's next visit shows what was
    // already discovered, not just this run's own "Sources consulted" panel.
    // `unresolved-citation` stubs (no real content) and a resource whose title
    // has no normalizable identity (rare — see `normalizedKey`'s doc comment)
    // are skipped rather than promoted as unreadable/unkeyable ghost entries.
    if (isModernPipeline && primaryWorkIdentityId && r.resourceType !== "unresolved-citation") {
      const libraryKey = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year });
      if (libraryKey) {
        const resourceWorkIdentityId = await findOrCreateWorkIdentity(resourceWork, r.authors);
        const libraryFields = {
          workIdentityId: resourceWorkIdentityId,
          title: r.title,
          url: r.url,
          canonicalUrl: canonicalizeUrl(r.url),
          doi: canonicalizeDoi(r.doi),
          isbn: canonicalizeIsbn(r.isbn),
          resourceType: r.resourceType,
          provider: r.provider,
          year: r.year,
          authors: r.authors,
          venue: r.venue,
          creator: v3Credibility?.creator ?? null,
          peerReviewed: publicationRigor(r).peerReviewed,
          popularity: v3Credibility?.popularity ?? null,
          bibRecordId: bibId,
        };
        const [learningResource] = await db
          .insert(learningResources)
          .values({ ...libraryFields, normalizedKey: libraryKey })
          .onConflictDoUpdate({ target: learningResources.normalizedKey, set: { ...libraryFields, updatedAt: new Date() } })
          .returning({ id: learningResources.id });

        await db
          .insert(resourceRoles)
          .values({
            learningResourceId: learningResource.id,
            workIdentityId: primaryWorkIdentityId,
            relationship: conservativeCategory,
            readerLevel: null,
            rationale: noteBody,
            confidence: classification!.confidence,
            createdBy: "system",
          })
          .onConflictDoUpdate({
            target: [resourceRoles.learningResourceId, resourceRoles.workIdentityId, resourceRoles.readerLevel],
            set: { relationship: conservativeCategory, rationale: noteBody, confidence: classification!.confidence },
          });
      }
    }
  }

  // Persist only deterministic, provenance-backed source-to-source links.
  // A review/edition/translation is connected to the discovered primary record
  // that shares its derived work identity; this is not a vector similarity
  // guess and the exact grouping evidence remains on both resource rows.
  const byWorkKey = new Map<string, typeof relationProjection>();
  for (const row of relationProjection) {
    if (!row.workKey) continue;
    byWorkKey.set(row.workKey, [...(byWorkKey.get(row.workKey) ?? []), row]);
  }
  for (const [workKey, rows] of byWorkKey) {
    const primary = rows.find((row) => row.workRole === "primary");
    if (!primary) continue;
    for (const related of rows) {
      if (related.id === primary.id) continue;
      await db.insert(editionRelations).values({
        runId: input.runId,
        resourceId: related.id,
        relatedResourceId: primary.id,
        relationType: `${related.workRole}_of`,
        depth: 1,
        importance: 1,
        evidence: { provenance: "shared_work_identity", workKey, relatedRole: related.workRole },
        confidence: 1,
      });
    }
  }

  if (usageLogs.length) await db.insert(aiUsageLogs).values(usageLogs);

  // `degraded` means the edition is WORSE than it should be — not that
  // discovery finished within its budget. Hitting the pre-dedup resource cap
  // or saturating are healthy outcomes: they mean enough was found and the run
  // stopped on purpose. A 10-document load test had all ten successful,
  // full-structure editions telling the reader they were degraded, which is
  // crying wolf: a warning shown on every run carries no information.
  //
  // The soft cap is different in kind — passing it means synthesis was cut
  // short, so the edition genuinely has less in it than intended.
  const degraded = overSoftCap(budget);
  await db
    .update(processingRuns)
    .set({ stage: "validation", aiCostUsd: budget.spentUsd, degraded, saturationNote: discovery.saturationNote, updatedAt: new Date() })
    .where(eq(processingRuns.id, input.runId));
}
