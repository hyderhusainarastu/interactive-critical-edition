import {
  aiUsageLogs,
  citations,
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
  learningResources,
  resourceRoles,
  enqueueCitationMetadataResolution,
} from "@ice/db";
import {
  classifyRelationship,
  estimateCostUsd,
  OpenAIResponsesClient,
  RELATIONSHIP_CATEGORIES,
  safetyIdentifierFor,
  type RelationshipCategory,
} from "@ice/ai-adapters";
import {
  extractCitationMentions,
  extractCitations,
  type CitationSourceInput,
  type ExtractedAuthorApparatus,
} from "@ice/ingestion";
import { reportError, reportEvent } from "@ice/observability";
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
  selectForFullInspection,
} from "@ice/research";
import { and, eq, gt, sql } from "drizzle-orm";
import { buildStructuralCitationSources } from "../citationSources";
import {
  conservativeInfluenceClassification,
  verifyCreatorFromProviderMetadata,
} from "../v3";
import { compactWorkSignal, persistV4WorkSignals } from "../v4";
import { CATEGORY_TO_EDGE, citationFrequencyFor, edgeValue } from "./citationAnchoring";
import { createCitationLibraryProjection } from "./citationRole";
import { linkCitationsToRunDiscoveries } from "./linkCitationsToRunDiscoveries";
import {
  findOrCreateBibFromResource,
  findOrCreateWorkIdentity,
} from "./workIdentity";

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
    .select({ userId: documents.userId, workId: documents.workId, title: works.title, authorName: works.authorName, contentHash: documents.contentHash })
    .from(documents)
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!doc) throw new Error(`Document ${input.documentId} not found for edition research`);
  const isV4 = input.pipeline === "v4";
  const isModernPipeline = input.pipeline === "v3" || isV4;
  const setStage = async (
    v2Stage: string,
    v3Stage: string,
    v4Stage = v3Stage,
    sourceProgress?: { sourceIndex: number; sourceTotal: number },
  ) => {
    await db.update(processingRuns).set({
      stage: isV4 ? v4Stage : isModernPipeline ? v3Stage : v2Stage,
      // Null whenever this stage isn't inside the per-source loop, so a
      // stage set before/after the loop never carries over a stale count
      // from a prior source (the write is unconditional, so "omitted" always
      // means "reset to null" here, not "leave whatever was there").
      stageSourceIndex: sourceProgress?.sourceIndex ?? null,
      stageSourceTotal: sourceProgress?.sourceTotal ?? null,
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
    // The upload's verified content hash participates in the precedence chain
    // (plan §20.6 rule 5): the same bytes re-uploaded under another filename
    // must resolve to the same canonical work identity.
    primaryWorkIdentityId = await findOrCreateWorkIdentity(primaryIdentity, resolvedAuthors, { contentHash: doc.contentHash });
    if (primaryWorkIdentityId) {
      await db
        .update(works)
        .set({ workIdentityId: primaryWorkIdentityId, updatedAt: new Date() })
        .where(and(eq(works.id, doc.workId), sql`${works.workIdentityId} is null`));
    }
  }

  const budget = makeBudget();
  // Crash-loop-proof budget (floors2 crash follow-up, §5 item 2): pg-boss
  // retries `extract-text`/`edition-reprocess` up to 3x on failure, and
  // `handleEditionExtraction` re-runs this ENTIRE pipeline — including every
  // paid stage — from scratch on each attempt, each under a NEW `runId`. If
  // the in-memory budget always started at $0, a document whose pipeline
  // keeps hitting the same crash would silently re-spend up to the hard cap
  // on every single attempt, with the $1 soft-cap / $5 hard-cap enforcement
  // never actually seeing the prior attempts' real spend. Seed it instead
  // from `ai_usage_log` rows already persisted for THIS DOCUMENT's prior
  // FAILED runs only (joined through `processing_run.status = 'failed'` —
  // the honest predicate for "crashed/still-crash-looping", per the actual
  // `processing_run_status` vocabulary: pending/running/complete/failed).
  // A prior COMPLETE run — published or superseded — is a legitimate edition,
  // not a crash; a fresh reprocess after one must start its budget at $0, or
  // every later reprocess of a well-behaved document would degrade for no
  // reason. A retry gets a fresh `runId`, so run-scoping alone would miss
  // exactly the spend this seed exists to catch — hence the document-level
  // join, narrowed to failed runs rather than every run of the document.
  //
  // ROUND-2 (episode scoping): "narrowed to failed runs" alone is still not
  // enough — a document can crash-loop (v1 failed), get manually recovered
  // and published (v2 complete), and only later be reprocessed again (v3).
  // Without a version floor, v1's old crash spend would keep seeding EVERY
  // future reprocess forever, even though a legitimate publish already
  // happened in between. A publish closes out the crash episode it followed,
  // so only failed runs with a version STRICTLY GREATER than the document's
  // most recent COMPLETE run's version — i.e. failed since that last publish
  // — belong to the CURRENT episode. `episodeStartVersion` is 0 (seed
  // everything) when the document has never had a complete run at all.
  // `ai_usage_log.run_id` is a real per-run column (FK added by migration
  // 0010), not merely a document-level or time-window association, so this
  // join attributes spend to exactly the runs it was actually incurred by —
  // no `created_at` window approximation is needed or used here.
  const [lastComplete] = await db
    .select({ version: sql<number>`coalesce(max(${processingRuns.version}), 0)` })
    .from(processingRuns)
    .where(and(eq(processingRuns.documentId, input.documentId), eq(processingRuns.status, "complete")));
  const episodeStartVersion = lastComplete?.version ?? 0;
  const [priorSpend] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .innerJoin(processingRuns, eq(aiUsageLogs.runId, processingRuns.id))
    .where(and(
      eq(processingRuns.documentId, input.documentId),
      eq(processingRuns.status, "failed"),
      gt(processingRuns.version, episodeStartVersion),
    ));
  // Tracked explicitly, once, as an immutable local — never recomputed from
  // `budget.spentUsd` later (which keeps accumulating this run's own spend)
  // so every place that persists `processing_run.ai_cost_usd` below can
  // subtract it back out and report ONLY this run's own spend, preserving
  // cost.ts's documented per-run invariant, the admin dashboard's global
  // sum, and the reader's per-edition cost display. The in-memory `budget`
  // itself still carries the seed permanently, so `canAfford`/`overSoftCap`
  // keep enforcing the true cumulative spend across a crash-loop retry.
  const seededUsd = priorSpend?.total ?? 0;
  if (seededUsd > 0) charge(budget, seededUsd);
  const responses = new OpenAIResponsesClient();
  const safetyIdentifier = safetyIdentifierFor(doc.userId);
  const cheapModel = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const researchModel = process.env.OPENAI_MODEL_RESEARCH ?? "gpt-5.4-mini";
  // Conservative upper bound on one mini-model note (~700 in + ~400 out) — used
  // only for the hard-cap affordability gate before starting a synthesis call.
  const NOTE_COST_ESTIMATE = 0.01;
  const usageLogs: (typeof aiUsageLogs.$inferInsert)[] = [];
  // How many of `usageLogs`' entries have already been written to the DB.
  // Used as a "flushed marker" so `flushUsageLogs` — called both
  // periodically and unconditionally in the `finally` below — only ever
  // inserts the DELTA since its last call, never the same row twice.
  let flushedUsageCount = 0;
  const flushUsageLogs = async () => {
    const pending = usageLogs.slice(flushedUsageCount);
    if (!pending.length) return;
    await db.insert(aiUsageLogs).values(pending);
    flushedUsageCount = usageLogs.length;
  };
  // How many un-flushed log entries accumulate before an incremental flush,
  // independent of the unconditional flush in `finally` — bounds how much a
  // crash mid-run (one that a plain try/finally in this same process could
  // still miss, e.g. a hard process kill) can leave unpersisted.
  const USAGE_FLUSH_BATCH_SIZE = 5;
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

  // Crash-safety wrapper (floors2 crash follow-up, §5 item 2): everything
  // from here on is the actual pipeline work, run inside a try/finally so
  // whatever `usageLogs` has accumulated — and the run's cost-so-far — is
  // always persisted on the way out, success OR throw. Before this fix, the
  // single `db.insert(aiUsageLogs)` bulk write only ran after the ENTIRE
  // pipeline finished successfully, so a mid-run crash (e.g. the duplicate-
  // key crash this same fix set repairs above) discarded every real OpenAI
  // call's cost with no ledger row anywhere to catch it — the $1/$5 caps
  // this pipeline depends on were themselves blind to that spend.
  try {
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
  // (D-20-91: assembly — including the recovered-endnote exclusion — lives
  // in `citationSources.ts` as a pure, DB-free function.)
  const structuralCitationSources: CitationSourceInput[] = buildStructuralCitationSources({
    bodyBlocks: input.bodyBlocks,
    apparatus: input.apparatus,
  });
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
    // Floors-capability-proposal §4: raised from the 10/doc default to 16 —
    // comfortable headroom above the gold-eval baseline's 8 required
    // concepts without inviting low-value padding from its ~40-entry full
    // inventory. Bounded, cheap raise ($0.0005-0.002/run via concepts.ts's
    // proportional `maxOutputTokens`), and the ONLY concept-cap change in
    // scope here — the proposal's paired sampling fix (a distributed text
    // sample instead of the current first-6000-characters slice) is a
    // separate, larger change and is deliberately deferred, not implemented.
    const CONCEPT_EXTRACTION_COST_ESTIMATE = 0.012;
    if (canAfford(budget, CONCEPT_EXTRACTION_COST_ESTIMATE)) {
      const synthesizedConcepts = await synthesizeConcepts(responses, {
        primary: { title: resolvedTitle, author: resolvedAuthorName },
        textSample: input.text,
        model: cheapModel,
        safetyIdentifier,
        maxConcepts: 16,
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

  // Selection for the full-inspection budget (floors-capability-proposal
  // §2.2): candidates whose explicit-citation grounding is the document's OWN
  // reference-list evidence (a resolved key or a matched citation-text entry)
  // are never competed out by authority alone — otherwise a flood of
  // interchangeable, high-authority primary-text editions (all legitimately
  // accepted via the broader title-phrase rule) can crowd out a real,
  // lower-authority secondary source for one of the scarce
  // `maxFullInspections` slots. Everything else is still ranked by authority,
  // exactly as before, and fills whatever budget remains. Only ACCEPTED
  // candidates get here — nothing quarantined or rejected is ever scored,
  // projected, or shown; this changes WHICH accepted candidates are
  // inspected, never what gets accepted (relevance.ts is untouched).
  const ranked = selectForFullInspection(
    acceptedResources.map(({ r, assessment }) => ({ r, assessment, authority: classifyAuthority(r) })),
    AUTHORITY_ORDER,
    RESEARCH_LIMITS.maxFullInspections,
  );
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

  for (const [rankedIndex, { r, assessment, authority }] of ranked.entries()) {
    const sourceProgress = { sourceIndex: rankedIndex + 1, sourceTotal: ranked.length };
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
    const candidateNormalizedKey = normalizedKey({ doi: r.doi, isbn: r.isbn, url: r.url, title: r.title, authors: r.authors, year: r.year });

    const insertedResourceRows = await db
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
        normalizedKey: candidateNormalizedKey,
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
      // D-23-xx (floors2 crash): two independently-accepted candidates in the
      // SAME run can legitimately resolve `deriveWorkIdentity`/`normalizedKey`
      // onto the identical (runId, normalizedKey) pair with DIFFERENT
      // work_role/work_evidence (e.g. one candidate is the primary edition,
      // another is a review of it that also carries the same DOI-derived
      // key) — `research_resource_run_key_unique` then rejects the second
      // insert outright, and an unguarded insert crashed the whole job 6/6
      // times in production. First-in wins: the row an earlier iteration of
      // this same loop already committed is kept exactly as-is. There is no
      // codebase precedent for merging two conflicting NON-NULL values onto
      // one row — `findOrCreateWorkIdentity`'s own "backfill" pattern (this
      // file) only ever fills a column that is still NULL, and explicitly
      // never overwrites one that already has a value — so inventing a
      // merge here for `work_role`/`work_evidence` would be new, unproven
      // policy. Skip the rest of this candidate's writes instead and log a
      // structured warning so the collision stays visible without crashing.
      .onConflictDoNothing({ target: [researchResources.runId, researchResources.normalizedKey] })
      .returning({ id: researchResources.id });

    if (!insertedResourceRows.length) {
      reportEvent("research_resource_duplicate_key_skipped", {
        scope: "worker.analyzeEditionRun",
        runId: input.runId,
        documentId: input.documentId,
        normalizedKey: candidateNormalizedKey,
        skippedTitle: r.title,
        skippedProvider: r.provider,
        skippedWorkRole: resourceWork.role,
        skippedWorkEvidence: resourceWork.evidence,
      });
      continue;
    }
    const [resourceRow] = insertedResourceRows;

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

    await setStage("classification", "credibility", undefined, sourceProgress);
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
    await setStage("classification", "claims", undefined, sourceProgress);
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
    await setStage("classification", "conservative-influence-classification", undefined, sourceProgress);
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
      // D-21-6: idempotent-safe on reprocess, same concern as the concept
      // edge above — graph_edge carries no runId of its own. Unlike the
      // concept edge, though, a reclassification can change the edgeType
      // itself (e.g. Phase 11.7's prerequisite fix), so a plain
      // existence-check-and-skip keyed on (source, target, edgeType) would
      // leave a stale category's edge sitting alongside the new one instead
      // of being superseded. Clear any prior SYSTEM classification edge for
      // this exact (work, target) pair — regardless of its edgeType —
      // immediately before writing the fresh one, so only the latest run's
      // classification survives for that pair, matching the legacy
      // `analyzeWork` path's "clear prior system output, then reinsert"
      // semantics (see its full-work clear above `resolveCitationMetadata`).
      await db
        .delete(graphEdges)
        .where(
          and(
            eq(graphEdges.userId, doc.userId),
            eq(graphEdges.sourceType, "work"),
            eq(graphEdges.sourceId, doc.workId),
            eq(graphEdges.targetType, "bibliographic_record"),
            eq(graphEdges.targetId, bibId),
            eq(graphEdges.createdBy, "system"),
          ),
        );
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
        // Verified identifiers feed the precedence chain only from a
        // PRIMARY-role record: a review's own DOI must never become the
        // reviewed work's DOI (plan §20.6).
        const resourceWorkIdentityId = await findOrCreateWorkIdentity(
          resourceWork,
          r.authors,
          resourceWork.role === "primary" ? { doi: r.doi, isbn: r.isbn, year: r.year } : {},
        );
        const libraryFields = {
          workIdentityId: resourceWorkIdentityId,
          workRole: resourceWork.role,
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
            // The classifier's own conservative, opt-in suggestion (null =
            // universal, its default) — see `@ice/ai-adapters`'s
            // `ClassificationResult.readerLevel` doc comment. Citation-only
            // roles (`ensureCitationRole`, above) intentionally stay null:
            // citations are genuinely universal, not just unclassified.
            readerLevel: classification!.readerLevel,
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

    // Incremental flush (floors2 crash follow-up, §5 item 2): this loop is
    // where the production crash actually happened, and it can run up to
    // `maxFullInspections * 2` iterations (see selection.ts's defense-in-
    // depth cap) — bound how much a crash inside THIS loop specifically
    // could still leave unpersisted, on top of the unconditional `finally`
    // flush below. Safe to call every iteration: it's a no-op whenever fewer
    // than `USAGE_FLUSH_BATCH_SIZE` new entries have accumulated.
    if (usageLogs.length - flushedUsageCount >= USAGE_FLUSH_BATCH_SIZE) await flushUsageLogs();
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

  // D-20-68: link any citation this run's own discovery already found a
  // candidate for (see linkCitationsToRunDiscoveries's doc comment) — must run
  // after every research_resource row for this run has been inserted (i.e.
  // after the `ranked` loop above), and before the run is marked validated, so
  // this pass always sees the run's own complete discovery set.
  await linkCitationsToRunDiscoveries(input.documentId, input.runId);

  await flushUsageLogs();

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
    .set({
      stage: "validation",
      // Direct update, not the `setStage` closure — reset explicitly so the
      // just-finished per-source loop's last count doesn't linger.
      stageSourceIndex: null,
      stageSourceTotal: null,
      aiCostUsd: budget.spentUsd - seededUsd,
      degraded,
      saturationNote: discovery.saturationNote,
      updatedAt: new Date(),
    })
    .where(eq(processingRuns.id, input.runId));
  } catch (error) {
    // Error-cause preservation (floors2 crash follow-up, §5 error-cause
    // item): the caller (`extraction.ts`'s catch block) only ever persists
    // `error.message` onto `processing_run.error`/`document.processingError`.
    // Drizzle wraps the real driver error in `DrizzleQueryError`, whose own
    // `.message` is just "Failed query: ... params: ...", losing the actual
    // Postgres error (`.cause.message`/`.cause.code`, e.g. `23505` unique-
    // violation or `42P01` undefined-table — this project's own already-
    // documented pg/Drizzle gotcha, see PROJECT-LOG Known Problems). Fold the
    // cause into the message here, at the source, so whatever later reads
    // `error.message` — with no change needed on its part — gets the real
    // driver detail instead of having to dig for it after the fact.
    const err = error instanceof Error ? error : new Error(String(error));
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    if (cause && (cause.message || cause.code)) {
      err.message = `${err.message} [cause${cause.code ? `: ${cause.code}` : ""}${cause.message ? ` ${cause.message}` : ""}]`;
    }
    throw err;
  } finally {
    // Unconditional, whether the try block succeeded or threw: persist
    // whatever usage this run actually incurred. `flushUsageLogs` inserts
    // only the delta since its last call (via `flushedUsageCount`), so
    // calling it again here after the success path already flushed is a
    // safe no-op, not a duplicate insert. On a throw, this is what makes the
    // spend from THIS attempt's own `ai_usage_log` rows visible to the next
    // attempt's budget seed above (the seed sums `ai_usage_log`, not this
    // column) instead of vanishing along with the crash. `aiCostUsd` itself
    // is set to `budget.spentUsd - seededUsd` — this run's own spend only,
    // matching the success-path update above and the per-run invariant.
    await flushUsageLogs();
    await db
      .update(processingRuns)
      .set({ aiCostUsd: budget.spentUsd - seededUsd, updatedAt: new Date() })
      .where(eq(processingRuns.id, input.runId));
  }
}
