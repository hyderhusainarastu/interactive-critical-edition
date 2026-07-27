import {
  OpenAIResponsesClient,
  TASK_ROUTES,
  resolveEmbeddingProvider,
  safetyIdentifierFor,
  type EmbeddingProvider,
} from "@ice/ai-adapters";
import {
  CLAIM_EXTRACTION_PROMPT_VERSION,
  CLAIM_NATURES,
  CLAIM_SCORER_VERSION,
  MAX_CLAIMS_FOR_ABSTRACT,
  buildClaimExtractionPrompt,
  isExtractClaimsWorkScope,
  isLegacyWorkIdsArrayScope,
  parseExtractClaimsScope,
  planExtractionChunks,
  rebindClaimAnchor,
  scoreBothDimensions,
  validateClaimExtraction,
  type ExtractClaimsScope,
  type ExtractedClaim,
  type ExtractionChunk,
} from "@ice/claims";
import { canonicalLocusKey, recognizeClassicalReference } from "@ice/ingestion";
import { canAfford, overSoftCap, type StructuredCaller } from "@ice/research";
import { createHash } from "node:crypto";
import * as repo from "./repository";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * extract_claims handler (Phase 26.1, plan §Pipeline "Map-reduce
 * extraction"; corpus-item abstract-source path added in the Phase 30 fix
 * lane, D-25-13). Two source paths, dispatched on the canonical
 * `@ice/claims` scope contract (`parseExtractClaimsScope`, D-25-14's fix for
 * the web/worker scope-shape mismatch): `{workId}` runs the uploaded-work
 * map-reduce extraction (`extractClaimsForWork`, unchanged since Phase 26.1);
 * `{corpusItemId}` runs the single-chunk abstract extraction below
 * (`extractClaimsForCorpusItem`).
 */

// Conservative per-chunk upper bound (gpt-5.4-nano, ≤12k-char input, up to
// `MAX_OUTPUT_TOKENS` output) — the `NOTE_COST_ESTIMATE`/
// `PASSAGE_ANNOTATION_COST_ESTIMATE` precedent from `apps/worker/src/analyze.ts`.
const CHUNK_COST_ESTIMATE_USD = 0.01;
const MAX_OUTPUT_TOKENS = 4000;
// ±80 chars either side of the excerpt — the anchor idiom's usual context
// window (`captureSelectionAnchor`'s `CONTEXT = 40` is smaller because it
// anchors a short user selection; a model-extracted excerpt is longer, so a
// wider window keeps `findQuoteOffset` well-disambiguated on relocation).
const ANCHOR_CONTEXT_CHARS = 80;

function normalizeClaimText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function claimContentHash(text: string): string {
  return createHash("sha256").update(normalizeClaimText(text)).digest("hex");
}

/** The claim-extraction response schema, identical for both the uploaded-work
 *  map-reduce path (`extractOneChunk`) and the corpus-item single-abstract
 *  path (`extractFromSingleText`) — one literal, not two copies to drift. */
const CLAIM_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          nature: { type: "string", enum: [...CLAIM_NATURES] },
          section: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          supportingExcerpt: { type: "string" },
        },
        required: ["text", "nature", "section", "confidence", "supportingExcerpt"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
} as const;

const CLAIM_EXTRACTION_SYSTEM_PROMPT =
  "You are extracting claims from a scholarly work for a research pipeline. Follow the instructions and " +
  "output schema in the user message exactly. Return ONLY the structured JSON requested — no markdown, no commentary.";

/**
 * Finds the SOLE chunk block whose text contains `excerpt` verbatim, or
 * null when zero or more than one block matches — the same "never guess
 * between plausible anchors" discipline as `rebindClaimAnchor`. This is the
 * "named block" the excerpt is re-verified against right before insert.
 */
function locateExcerptBlock(
  excerpt: string,
  chunkBlockIds: string[],
  blockMeta: Map<string, repo.BlockMeta>,
): repo.BlockMeta | null {
  const matches = chunkBlockIds
    .map((id) => blockMeta.get(id))
    .filter((block): block is repo.BlockMeta => block !== undefined && block.text.includes(excerpt));
  return matches.length === 1 ? matches[0] : null;
}

function buildAnchor(blockText: string, excerpt: string): { quote: string; prefix: string; suffix: string } | null {
  // `indexOf` deliberately anchors to the excerpt's FIRST occurrence in the
  // block: if the same substring appears more than once, every duplicate
  // collapses onto that first position, and the prefix/suffix context
  // captured below is what disambiguates the true location at re-location
  // time — the same quote+prefix+suffix text-fingerprint semantics as
  // `highlight`/`passage_annotation` anchoring (see plan §R3), not a bug.
  const idx = blockText.indexOf(excerpt);
  if (idx === -1) return null; // recomputed literal-substring check — drop on violation
  const prefix = blockText.slice(Math.max(0, idx - ANCHOR_CONTEXT_CHARS), idx);
  const suffix = blockText.slice(idx + excerpt.length, idx + excerpt.length + ANCHOR_CONTEXT_CHARS);
  return { quote: excerpt, prefix, suffix };
}

/** All four locus-harvest origins for one accepted claim (plan §Pipeline
 *  "Three-channel Stage 1" / §Improvements "Locus-based candidate
 *  retrieval"): the claim's own excerpt, its full anchored block, any
 *  footnote/endnote sharing that block's page, and any structurally
 *  resolved citation anchored to that same block. */
function harvestLoci(input: {
  excerpt: string;
  block: repo.BlockMeta;
  footnoteTextsByPage: Map<string, string[]>;
  citationTextsByBlock: Map<string, string[]>;
}): repo.NewClaimLocus[] {
  const found = new Map<string, repo.NewClaimLocus>(); // keyed by `${locusKey}:${origin}`
  const record = (text: string, origin: repo.NewClaimLocus["origin"]) => {
    const match = recognizeClassicalReference(text);
    if (!match) return;
    const locusKey = canonicalLocusKey(match);
    const key = `${locusKey}:${origin}`;
    if (!found.has(key)) found.set(key, { claimId: "", locusKey, origin, rawLocus: match.locus });
  };
  record(input.excerpt, "excerpt");
  record(input.block.text, "block");
  for (const text of input.footnoteTextsByPage.get(input.block.pageId) ?? []) record(text, "footnote");
  for (const text of input.citationTextsByBlock.get(input.block.id) ?? []) record(text, "citation");
  return [...found.values()];
}

interface ChunkExtractionResult {
  accepted: { claim: ExtractedClaim; block: repo.BlockMeta; anchor: { quote: string; prefix: string; suffix: string } }[];
  droppedForExcerptReverification: number;
}

async function extractOneChunk(
  caller: StructuredCaller,
  chunk: ExtractionChunk,
  input: { workTitle: string; safetyIdentifier: string; blockMeta: Map<string, repo.BlockMeta>; model: string },
  ctx: ResearchJobRunContext,
  concerns: string[],
): Promise<ChunkExtractionResult> {
  const blockTexts = chunk.blockIds.map((id) => input.blockMeta.get(id)?.text ?? "");

  let extracted: ExtractedClaim[];
  try {
    const result = await caller.call({
      model: input.model,
      schemaName: "claim_extraction",
      schema: CLAIM_EXTRACTION_RESPONSE_SCHEMA,
      safetyIdentifier: input.safetyIdentifier,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: CLAIM_EXTRACTION_SYSTEM_PROMPT,
      input: buildClaimExtractionPrompt({ workTitle: input.workTitle, documentText: chunk.text }),
      validate: (parsed) => validateClaimExtraction((parsed as { claims?: unknown }).claims, blockTexts),
    });
    await ctx.logUsage({
      task: "claim_extraction",
      stage: "extracting-claims",
      provider: "openai",
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
    extracted = result.data;
  } catch (err) {
    // Zero-tolerance grounding (plan §Pipeline "Excerpt fidelity
    // zero-tolerance"): `OpenAIResponsesClient.call()` already retried
    // (MAX_RETRIES) any response whose `validate()` threw — a fabricated
    // excerpt, an out-of-vocabulary nature, a malformed count. Exhausting
    // those retries means every attempt for this chunk was untrustworthy.
    // The only honest response is to DROP the chunk's claims entirely —
    // never repair a candidate the model couldn't produce validly, and
    // never fall back to a heuristic guess at what the claims might have
    // been (there is no honest deterministic way to invent a claim, unlike
    // relationship classification's heuristic fallback).
    const message = err instanceof Error ? err.message : String(err);
    concerns.push(`Chunk "${chunk.sectionLabel || "(untitled section)"}" dropped: extraction failed validation after retries (${message.slice(0, 200)}).`);
    return { accepted: [], droppedForExcerptReverification: 0 };
  }

  const accepted: ChunkExtractionResult["accepted"] = [];
  let droppedForExcerptReverification = 0;
  for (const claim of extracted) {
    const block = locateExcerptBlock(claim.supportingExcerpt, chunk.blockIds, input.blockMeta);
    if (!block) {
      droppedForExcerptReverification += 1;
      continue;
    }
    // Recompute the literal-substring check against the NAMED block,
    // immediately before insert — a second, independent verification from
    // `validateClaimExtraction`'s chunk-wide one above, now scoped to the
    // exact block this claim will be anchored to.
    const anchor = buildAnchor(block.text, claim.supportingExcerpt);
    if (!anchor) {
      droppedForExcerptReverification += 1;
      continue;
    }
    accepted.push({ claim, block, anchor });
  }
  if (droppedForExcerptReverification > 0) {
    concerns.push(
      `Chunk "${chunk.sectionLabel || "(untitled section)"}": ${droppedForExcerptReverification} claim(s) dropped — supportingExcerpt did not re-verify against exactly one block.`,
    );
  }
  return { accepted, droppedForExcerptReverification };
}

/**
 * Free, deterministic rebind pass (plan §Pipeline "Reprocess supersession"):
 * every active work-sourced claim not yet matched to the CURRENT published
 * run is re-located via `rebindClaimAnchor` (`@ice/claims`'s
 * `findQuoteOffset`, moved here from the reader — see `anchoring.ts`'s doc
 * comment). Exactly one match rebinds; zero or multiple leaves the claim
 * `unanchored` — NEVER deleted either way, since the user may have verified
 * or cited it. `processing_run_id` updates to the current run regardless of
 * outcome, so a later job invocation against the SAME published run doesn't
 * re-attempt the same (already-decided) rebind.
 */
export async function rebindClaimsForWork(scope: repo.WorkExtractionScope): Promise<{ rebound: number; unanchored: number }> {
  const candidates = scope.blocks
    .filter((b) => b.kind === "body")
    .map((b) => ({ blockId: b.id, text: scope.blockMeta.get(b.id)?.text ?? b.text }));

  const needingRebind = await repo.getClaimsNeedingRebind(scope.workId, scope.processingRunId);
  let rebound = 0;
  let unanchored = 0;
  for (const claim of needingRebind) {
    if (claim.quote === null) {
      // No anchor was ever recorded (shouldn't occur for a work-sourced
      // claim per the `research_claim_grounded` CHECK, but guarded rather
      // than assumed) — nothing to relocate; leave it as-is.
      continue;
    }
    const result = rebindClaimAnchor({ quote: claim.quote, prefix: claim.prefix ?? "", suffix: claim.suffix ?? "" }, candidates);
    if (result.state === "rebound") {
      await repo.applyRebindResult(claim.id, { textBlockId: result.blockId, anchorState: "rebound", processingRunId: scope.processingRunId });
      rebound += 1;
    } else {
      await repo.applyRebindResult(claim.id, { textBlockId: null, anchorState: "unanchored", processingRunId: scope.processingRunId });
      unanchored += 1;
    }
  }
  return { rebound, unanchored };
}

export interface ExtractClaimsOutcome extends ResearchJobOutcome {
  claimsExtracted: number;
  concerns: string[];
}

/**
 * Batch-embeds whichever claims THIS run actually inserted (a dedup hit
 * already has an embedding row from whichever run first inserted it) —
 * shared between the uploaded-work and corpus-item extraction paths so the
 * dimension/cost/failure handling can't drift between the two. Mutates
 * nothing by return value; concerns are pushed onto the caller's own array.
 */
async function embedNewlyInsertedClaims(
  embedder: EmbeddingProvider,
  ctx: ResearchJobRunContext,
  newlyInsertedClaims: { id: string; text: string }[],
  concerns: string[],
): Promise<void> {
  if (newlyInsertedClaims.length === 0 || !embedder.available) return;
  if (embedder.dim !== 1536) {
    concerns.push(`Embedding provider dimension ${embedder.dim} does not match the fixed vector(1536) column — skipped embedding this run.`);
    return;
  }
  const texts = newlyInsertedClaims.map((c) => normalizeClaimText(c.text));
  const projectedTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
  const projectedCost = embedder.estimateCostUsd(projectedTokens);
  if (!canAfford(ctx.budget, projectedCost)) {
    concerns.push(`Embedding batch skipped: projected cost would exceed the hard cap.`);
    return;
  }
  try {
    const result = await embedder.embedBatch(texts);
    await ctx.logUsage({
      task: "claim_embedding",
      stage: "embedding-claims",
      provider: embedder.id,
      model: result.model,
      promptTokens: result.inputTokens,
      completionTokens: 0,
      costOverride: embedder.estimateCostUsd(result.inputTokens),
    });
    const rows: repo.NewClaimEmbedding[] = newlyInsertedClaims.map((claim, index) => ({
      claimId: claim.id,
      model: result.model,
      inputHash: claimContentHash(claim.text),
      embedding: result.vectors[index],
      dim: result.vectors[index]?.length ?? embedder.dim,
    }));
    await repo.insertClaimEmbeddings(rows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    concerns.push(`Embedding batch failed; ${newlyInsertedClaims.length} claim(s) were inserted with no embedding row (${message.slice(0, 200)}).`);
  }
}

/**
 * The testable extraction core: DI'd `caller` (an `OpenAIResponsesClient`
 * in production, a mock in tests) and `embedder` (`resolveEmbeddingProvider()`
 * in production) — the `processForeignText(repository, adapter, options)`
 * precedent.
 */
export async function extractClaimsForWork(
  caller: StructuredCaller,
  embedder: EmbeddingProvider,
  ctx: ResearchJobRunContext,
  workId: string,
): Promise<ExtractClaimsOutcome> {
  const concerns: string[] = [];
  const scope = await repo.loadWorkExtractionScope(workId);
  if (!scope) throw new Error(`Work ${workId} has no document with a published processing run — claim extraction needs a stable, reader-visible text to anchor to.`);
  if (scope.userId !== ctx.request.userId) throw new Error(`Work ${workId} does not belong to the requesting user.`);

  await ctx.setStage("rebinding-claims");
  await rebindClaimsForWork(scope);

  await ctx.setStage("planning-extraction");
  const plan = planExtractionChunks(scope.blocks);
  const claimSourceScope: "full_text" | "sampled" = plan.coverage === "full" ? "full_text" : "sampled";
  const model = TASK_ROUTES.claim_extraction.preferred.model;
  const safetyIdentifier = safetyIdentifierFor(ctx.request.userId);

  const newlyInsertedClaims: { id: string; text: string }[] = [];
  let stoppedEarlyAtChunk: number | null = null;

  for (let i = 0; i < plan.chunks.length; i++) {
    if (overSoftCap(ctx.budget) || !canAfford(ctx.budget, CHUNK_COST_ESTIMATE_USD)) {
      stoppedEarlyAtChunk = i;
      break;
    }
    const chunk = plan.chunks[i];
    await ctx.setStage("extracting-claims", { index: i + 1, total: plan.chunks.length });

    const { accepted } = await extractOneChunk(caller, chunk, { workTitle: scope.workTitle, safetyIdentifier, blockMeta: scope.blockMeta, model }, ctx, concerns);

    for (const { claim, block, anchor } of accepted) {
      const claimId = await repo.insertResearchClaim({
        userId: scope.userId,
        workId: scope.workId,
        processingRunId: scope.processingRunId,
        textBlockId: block.id,
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        claimText: claim.text,
        claimNature: claim.nature,
        confidence: claim.confidence,
        section: claim.section,
        sourceScope: claimSourceScope,
        supportingExcerpt: claim.supportingExcerpt,
        contentHash: claimContentHash(claim.text),
        promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION,
      });
      // Dedup hit (claimId null) — this exact claim (by content_hash +
      // prompt_version) was already inserted by a prior run of this same
      // job; scoring/loci/embedding already exist for it too. Skipping here
      // is what makes a re-run's DB effect genuinely zero-new-rows.
      if (!claimId) continue;

      const scores = scoreBothDimensions(claim.text);
      if (scores.length > 0) {
        await repo.insertClaimScores(
          scores.map((s) => ({ claimId, dimension: s.dimension, score: s.score, label: s.label, tier: s.tier, signals: s.signals, scorerVersion: CLAIM_SCORER_VERSION })),
        );
      }

      const loci = harvestLoci({ excerpt: claim.supportingExcerpt, block, footnoteTextsByPage: scope.footnoteTextsByPage, citationTextsByBlock: scope.citationTextsByBlock });
      if (loci.length > 0) {
        await repo.insertClaimLoci(loci.map((l) => ({ ...l, claimId })));
      }

      newlyInsertedClaims.push({ id: claimId, text: claim.text });
    }
  }

  if (stoppedEarlyAtChunk !== null) {
    concerns.push(`Extraction stopped after chunk ${stoppedEarlyAtChunk}/${plan.chunks.length}: soft cost cap reached.`);
  }

  await embedNewlyInsertedClaims(embedder, ctx, newlyInsertedClaims, concerns);

  const coverage = stoppedEarlyAtChunk !== null ? "partial" : plan.coverage;
  const note =
    coverage === "full"
      ? null
      : [`Covered sections: ${plan.includedSections.join(", ") || "(none)"}`, plan.excludedSections.length ? `Excluded: ${plan.excludedSections.join(", ")}` : null, ...concerns]
          .filter((s): s is string => Boolean(s))
          .join(" | ")
          .slice(0, 2000);

  return { coverage, note, claimsExtracted: newlyInsertedClaims.length, concerns };
}

/**
 * The corpus-item (abstract-source) extraction core — the sibling of
 * `extractClaimsForWork` above for a project's imported-not-uploaded
 * members (Phase 28.2/30 fix lane, D-25-13). An abstract is a few hundred
 * words at most, so it is always ONE chunk (no `planExtractionChunks`
 * map-reduce needed — that helper exists to split a whole work's body text
 * across multiple model calls, which an abstract never needs). No abstract
 * at all is an honest FAILED request (a thrown error, matching
 * `extractClaimsForWork`'s own "no document with a published run" failure
 * mode above), never a silently-empty success — the caller asked to extract
 * claims from a source that has nothing to extract from, and that's worth
 * surfacing as a request-level failure, not a 0-claims "success."
 */
export async function extractClaimsForCorpusItem(
  caller: StructuredCaller,
  embedder: EmbeddingProvider,
  ctx: ResearchJobRunContext,
  corpusItemId: string,
): Promise<ExtractClaimsOutcome> {
  const concerns: string[] = [];
  const item = await repo.loadCorpusItemForExtraction(corpusItemId);
  if (!item) throw new Error(`Corpus item ${corpusItemId} does not exist.`);
  if (item.userId !== ctx.request.userId) throw new Error(`Corpus item ${corpusItemId} does not belong to the requesting user.`);

  const abstract = item.abstract?.trim();
  if (!abstract) {
    throw new Error(`Corpus item ${corpusItemId} has no abstract to extract from.`);
  }

  const model = TASK_ROUTES.claim_extraction.preferred.model;
  const safetyIdentifier = safetyIdentifierFor(ctx.request.userId);

  const newlyInsertedClaims: { id: string; text: string }[] = [];

  if (overSoftCap(ctx.budget) || !canAfford(ctx.budget, CHUNK_COST_ESTIMATE_USD)) {
    // Budget already exhausted before this single call could even be
    // attempted — the honest "partial" outcome (nothing extracted this run,
    // picked back up by a future retry), never a silent 0-claims "full".
    return { coverage: "partial", note: "Extraction did not start: cost budget reached.", claimsExtracted: 0, concerns: ["Extraction did not start: cost budget reached."] };
  }

  await ctx.setStage("extracting-claims", { index: 1, total: 1 });

  let extracted: ExtractedClaim[];
  try {
    const result = await caller.call({
      model,
      schemaName: "claim_extraction",
      schema: CLAIM_EXTRACTION_RESPONSE_SCHEMA,
      safetyIdentifier,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system: CLAIM_EXTRACTION_SYSTEM_PROMPT,
      input: buildClaimExtractionPrompt({ workTitle: item.title, documentText: abstract }),
      validate: (parsed) => validateClaimExtraction((parsed as { claims?: unknown }).claims, [abstract]),
    });
    await ctx.logUsage({
      task: "claim_extraction",
      stage: "extracting-claims",
      provider: "openai",
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    });
    extracted = result.data;
  } catch (err) {
    // Same zero-tolerance-grounding posture as `extractOneChunk` above:
    // exhausted retries on a fabricated/invalid response means the WHOLE
    // abstract's extraction is untrustworthy — drop it entirely, never
    // repair or guess.
    const message = err instanceof Error ? err.message : String(err);
    const concern = `Abstract extraction dropped: extraction failed validation after retries (${message.slice(0, 200)}).`;
    return { coverage: "full", note: concern, claimsExtracted: 0, concerns: [concern] };
  }

  const capped = extracted.slice(0, MAX_CLAIMS_FOR_ABSTRACT);
  if (extracted.length > capped.length) {
    concerns.push(`Extraction returned ${extracted.length} claim(s); capped at ${MAX_CLAIMS_FOR_ABSTRACT} for a single-abstract source.`);
  }

  let droppedForExcerptReverification = 0;
  for (const claim of capped) {
    // Recompute the literal-substring check directly against the abstract
    // text — the same "second, independent verification right before
    // insert" discipline as `extractOneChunk`'s `locateExcerptBlock`/
    // `buildAnchor` pair, simplified here since there is only one possible
    // "block" (the whole abstract) rather than several to disambiguate
    // between.
    if (!abstract.includes(claim.supportingExcerpt)) {
      droppedForExcerptReverification += 1;
      continue;
    }

    const claimId = await repo.insertResearchClaimForCorpusItem({
      userId: item.userId,
      corpusItemId: item.corpusItemId,
      claimText: claim.text,
      claimNature: claim.nature,
      confidence: claim.confidence,
      section: claim.section,
      supportingExcerpt: claim.supportingExcerpt,
      contentHash: claimContentHash(claim.text),
      promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION,
    });
    // Dedup hit (claimId null) — this exact claim already exists from a
    // prior run of this same job; scoring/loci/embedding already exist for
    // it too, matching `extractClaimsForWork`'s own dedup-skip discipline.
    if (!claimId) continue;

    const scores = scoreBothDimensions(claim.text);
    if (scores.length > 0) {
      await repo.insertClaimScores(
        scores.map((s) => ({ claimId, dimension: s.dimension, score: s.score, label: s.label, tier: s.tier, signals: s.signals, scorerVersion: CLAIM_SCORER_VERSION })),
      );
    }

    // Locus harvest reuses `harvestLoci` verbatim via a synthetic BlockMeta
    // standing in for "the whole abstract" — there is no real text_block to
    // harvest footnote/citation context from (a corpus item has neither),
    // so only the "excerpt" and "block" origins can ever fire here.
    const loci = harvestLoci({
      excerpt: claim.supportingExcerpt,
      block: { id: `corpus-abstract:${item.corpusItemId}`, pageId: `corpus-abstract:${item.corpusItemId}`, kind: "abstract", text: abstract },
      footnoteTextsByPage: new Map(),
      citationTextsByBlock: new Map(),
    });
    if (loci.length > 0) {
      await repo.insertClaimLoci(loci.map((l) => ({ ...l, claimId })));
    }

    newlyInsertedClaims.push({ id: claimId, text: claim.text });
  }
  if (droppedForExcerptReverification > 0) {
    concerns.push(`${droppedForExcerptReverification} claim(s) dropped — supportingExcerpt did not re-verify against the abstract text.`);
  }

  await embedNewlyInsertedClaims(embedder, ctx, newlyInsertedClaims, concerns);

  // One abstract, always sent whole — coverage is honestly "full" regardless
  // of how many claims came back (even zero, e.g. every candidate dropped
  // for excerpt re-verification): the source text itself was covered in
  // full, unlike `extractClaimsForWork`'s multi-chunk map-reduce where
  // "full" specifically means "every section got a chunk."
  const note = concerns.length > 0 ? concerns.join(" | ").slice(0, 2000) : null;
  return { coverage: "full", note, claimsExtracted: newlyInsertedClaims.length, concerns };
}

/** Real-provider wrapper wired into the worker's queue handler. Dispatches
 *  on the canonical `@ice/claims` scope contract (D-25-14's fix for the
 *  web/worker scope-shape mismatch) — `{workId}` runs the uploaded-work
 *  path, `{corpusItemId}` runs the abstract-source path above. */
export async function extractClaims(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseExtractClaimsScope(ctx.request.scope);
  if (!scope) {
    if (isLegacyWorkIdsArrayScope(ctx.request.scope)) {
      // A `research_job_request` row dispatched before D-25-14's fix — the
      // web app used to write `{workIds: [workId]}` (plural, array) here,
      // which this parser has never accepted. Distinguished from a generic
      // unrecognized shape so a stale queued/failed row from before the fix
      // is explained plainly rather than misdiagnosed (this exact confusion
      // is what surfaced D-25-14 in the first place: the old fallback
      // message below blamed an unrelated unimplemented feature).
      throw new Error(
        "extract_claims scope uses an unrecognized, pre-fix dispatch shape ({workIds: [...]}) — this request predates the extract_claims scope-shape fix. Re-run extraction from the project overview or Corpus page to dispatch a valid request.",
      );
    }
    throw new Error('extract_claims scope must be {"workId": string} or {"corpusItemId": string}.');
  }
  const caller = new OpenAIResponsesClient();
  const embedder = resolveEmbeddingProvider();
  const outcome = isExtractClaimsWorkScope(scope)
    ? await extractClaimsForWork(caller, embedder, ctx, scope.workId)
    : await extractClaimsForCorpusItem(caller, embedder, ctx, scope.corpusItemId);
  return { coverage: outcome.coverage, note: outcome.note };
}
