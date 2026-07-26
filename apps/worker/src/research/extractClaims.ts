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
  buildClaimExtractionPrompt,
  planExtractionChunks,
  rebindClaimAnchor,
  scoreBothDimensions,
  validateClaimExtraction,
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
 * extraction"). Scoped to the uploaded-work path only this lane — a
 * corpus-item's abstract-scoped extraction is a later lane (28.2's corpus
 * import), left as an honest typed-TODO failure below rather than a silent
 * no-op.
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

interface ExtractClaimsScope {
  workId: string;
}

function parseExtractClaimsScope(scope: unknown): ExtractClaimsScope | null {
  const s = scope as { workId?: unknown; corpusItemId?: unknown } | null;
  if (s && typeof s.workId === "string" && s.workId.length > 0) return { workId: s.workId };
  return null;
}

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
      schema: {
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
      },
      safetyIdentifier: input.safetyIdentifier,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      system:
        "You are extracting claims from a scholarly work for a research pipeline. Follow the instructions and " +
        "output schema in the user message exactly. Return ONLY the structured JSON requested — no markdown, no commentary.",
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

  // Batch-embed only the claims THIS run actually inserted — a dedup hit
  // already has an embedding row from whichever run first inserted it.
  if (newlyInsertedClaims.length > 0 && embedder.available) {
    if (embedder.dim !== 1536) {
      concerns.push(`Embedding provider dimension ${embedder.dim} does not match the fixed vector(1536) column — skipped embedding this run.`);
    } else {
      const texts = newlyInsertedClaims.map((c) => normalizeClaimText(c.text));
      const projectedTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
      const projectedCost = embedder.estimateCostUsd(projectedTokens);
      if (canAfford(ctx.budget, projectedCost)) {
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
      } else {
        concerns.push(`Embedding batch skipped: projected cost would exceed the hard cap.`);
      }
    }
  }

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

/** Real-provider wrapper wired into the worker's queue handler. */
export async function extractClaims(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseExtractClaimsScope(ctx.request.scope);
  if (!scope) {
    // Corpus-item abstract-path extraction (28.2) and any malformed scope
    // both land here as an honest, typed failure — never a silent no-op.
    // TODO(Phase 28.2): implement the corpus_item abstract-scoped path.
    throw new Error('extract_claims scope must be {"workId": string} — the corpus-item abstract-source path is not yet implemented (Phase 28.2).');
  }
  const caller = new OpenAIResponsesClient();
  const embedder = resolveEmbeddingProvider();
  const outcome = await extractClaimsForWork(caller, embedder, ctx, scope.workId);
  return { coverage: outcome.coverage, note: outcome.note };
}
