import type { PrimaryWork, StructuredCaller } from "./synthesize";
import { quoteIsGrounded } from "./synthesize";

/**
 * Phase 9.3 (plan §34.4): explanatory notes anchored to a specific block of the
 * PRIMARY text — distinct from `synthesize.ts`'s notes, which explain how a
 * discovered EXTERNAL resource bears on the work. A passage annotation explains
 * the passage itself: why it matters, what a term means here, where the author
 * disagrees with someone, what background it presupposes.
 *
 * `relationship` is validated against the caller-supplied `validRelationships`
 * (the ai-adapters ten-category vocabulary) rather than imported directly —
 * this package deliberately stays decoupled from `@ice/ai-adapters` (the same
 * boundary `apps/worker/src/v3.ts` keeps), so the enum lives on the caller side.
 */

export const PASSAGE_ANNOTATION_TYPES = ["context", "clarification", "connection", "critique", "definition"] as const;
export type PassageAnnotationType = (typeof PASSAGE_ANNOTATION_TYPES)[number];

export const READER_LEVELS = ["beginner", "undergraduate", "advanced", "research"] as const;
export type ReaderLevelName = (typeof READER_LEVELS)[number];

export const MAX_SUMMARY_LENGTH = 240;

export interface PassageBlockInput {
  blockId: string;
  text: string;
}

/**
 * A passage annotation the worker can safely persist. `isWholeWork` and
 * `blockId`/`quote` are always consistent (never both a block and whole-work,
 * never whole-work with a fabricated anchor) — this mirrors the DB check
 * constraint (`packages/db/src/schema.ts` `passage_annotation`) at the
 * application layer, so a bad row is rejected before it ever reaches an insert.
 */
export interface PassageAnnotation {
  isWholeWork: boolean;
  blockId: string | null;
  quote: string | null;
  summary: string;
  explanation: string;
  annotationType: PassageAnnotationType;
  relationship: string;
  readerLevel: ReaderLevelName | null;
  confidence: number;
}

const PASSAGE_ANNOTATION_SCHEMA = {
  type: "object",
  properties: {
    annotations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          // Empty string ("") means "no specific block" — the sentinel for
          // whole-work guidance, since OpenAI's strict JSON-schema mode here
          // is exercised only with plain (non-nullable) property types.
          block_id: { type: "string" },
          quote: { type: "string" },
          summary: { type: "string" },
          explanation: { type: "string" },
          annotation_type: { type: "string", enum: [...PASSAGE_ANNOTATION_TYPES] },
          relationship: { type: "string" },
          reader_level: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["block_id", "quote", "summary", "explanation", "annotation_type", "relationship", "reader_level", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["annotations"],
  additionalProperties: false,
};

interface DraftAnnotation {
  blockId: string;
  quote: string;
  summary: string;
  explanation: string;
  annotationType: string;
  relationship: string;
  readerLevel: string;
  confidence: number;
}

function normalizeDraft(parsed: unknown): DraftAnnotation[] {
  const p = parsed as { annotations?: unknown };
  if (!Array.isArray(p.annotations)) throw new Error("annotations not an array");
  return p.annotations
    .map((a) => a as Record<string, unknown>)
    .filter((a) => typeof a.summary === "string" && typeof a.explanation === "string")
    .map((a) => ({
      blockId: typeof a.block_id === "string" ? a.block_id.trim() : "",
      quote: typeof a.quote === "string" ? a.quote.trim() : "",
      summary: String(a.summary).trim(),
      explanation: String(a.explanation).trim(),
      annotationType: typeof a.annotation_type === "string" ? a.annotation_type : "",
      relationship: typeof a.relationship === "string" ? a.relationship : "",
      readerLevel: typeof a.reader_level === "string" ? a.reader_level : "",
      confidence: typeof a.confidence === "number" ? a.confidence : 0,
    }));
}

/**
 * Validate one drafted annotation against the real blocks it could have
 * referenced. Returns null (drop the candidate entirely) when the anchor
 * cannot be verified — the ONE invariant this function will not soften,
 * because a fabricated anchor is worse than no annotation. Every other field
 * is demoted to a safe default rather than dropped, matching the pipeline's
 * existing conservative-classification pattern (`conservativeInfluenceClassification`).
 */
function validateDraft(
  draft: DraftAnnotation,
  blocksById: Map<string, string>,
  validRelationships: readonly string[],
): PassageAnnotation | null {
  const isWholeWork = draft.blockId.length === 0;

  if (isWholeWork) {
    if (draft.quote.length > 0) return null; // whole-work must carry no anchor at all
  } else {
    const blockText = blocksById.get(draft.blockId);
    // The block must be one the model was actually shown, AND the quote must
    // really occur in that block's text — the anti-hallucination check this
    // whole feature exists to enforce (mirrors `quoteIsGrounded` for resource
    // evidence; here it grounds against the PRIMARY text instead).
    if (blockText === undefined || !quoteIsGrounded(draft.quote, [blockText])) return null;
  }

  const annotationType = (PASSAGE_ANNOTATION_TYPES as readonly string[]).includes(draft.annotationType)
    ? (draft.annotationType as PassageAnnotationType)
    : "context";
  const relationship = validRelationships.includes(draft.relationship) ? draft.relationship : "ai_inferred";
  const readerLevel = (READER_LEVELS as readonly string[]).includes(draft.readerLevel)
    ? (draft.readerLevel as ReaderLevelName)
    : null;
  const summary = draft.summary.length > MAX_SUMMARY_LENGTH ? `${draft.summary.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : draft.summary;
  if (summary.length === 0 || draft.explanation.length === 0) return null;

  return {
    isWholeWork,
    blockId: isWholeWork ? null : draft.blockId,
    quote: isWholeWork ? null : draft.quote,
    summary,
    explanation: draft.explanation,
    annotationType,
    relationship,
    readerLevel,
    confidence: Math.max(0, Math.min(1, draft.confidence)),
  };
}

export interface SynthesizedPassageAnnotations {
  annotations: PassageAnnotation[];
  promptTokens: number;
  completionTokens: number;
  usedModel: boolean;
}

/**
 * Synthesize passage-anchored annotations for one run in a single call —
 * bounded cost regardless of document length, unlike a per-block loop.
 * Falls back to an EMPTY result (not a heuristic guess) when no model is
 * available: unlike relationship classification, there is no honest
 * deterministic way to pick which passages merit an explanatory note, so
 * "none generated this run" is the truthful degraded state, not a lie.
 */
export async function synthesizePassageAnnotations(
  caller: StructuredCaller,
  input: {
    primary: PrimaryWork;
    blocks: PassageBlockInput[];
    validRelationships: readonly string[];
    model: string;
    safetyIdentifier?: string;
    maxAnnotations?: number;
  },
): Promise<SynthesizedPassageAnnotations> {
  const empty = (): SynthesizedPassageAnnotations => ({ annotations: [], promptTokens: 0, completionTokens: 0, usedModel: false });
  if (!caller.available || input.blocks.length === 0) return empty();

  const maxAnnotations = input.maxAnnotations ?? 8;
  const blocksById = new Map(input.blocks.map((b) => [b.blockId, b.text]));

  try {
    const r = await caller.call({
      model: input.model,
      schemaName: "passage_annotations",
      schema: PASSAGE_ANNOTATION_SCHEMA,
      safetyIdentifier: input.safetyIdentifier,
      maxOutputTokens: 1400,
      system:
        `You are annotating a scholarly primary text for a reader, one passage at a time. You are given ` +
        `numbered blocks with their block_id. For each passage genuinely worth explaining (a difficult term, ` +
        `necessary context, a place the author disagrees with someone, a connection worth noting), emit ONE ` +
        `annotation with a VERBATIM quote copied exactly from that block's own text — never paraphrase the ` +
        `quote, never invent one. Pick at most ${maxAnnotations} passages; quality over coverage. You may ` +
        `ALSO emit at most one additional annotation with an empty block_id and an empty quote for genuine ` +
        `whole-document guidance (something true of the work as a whole that no single passage captures) — ` +
        `use this rarely, never as a substitute for a real anchor. summary must be a single sentence under ` +
        `${MAX_SUMMARY_LENGTH} characters; explanation may be longer. annotation_type is what KIND of note this ` +
        `is about the passage itself. relationship is only relevant when the note draws a comparison to another ` +
        `work or thinker; otherwise use "interpretive_aid". reader_level is who most needs this note — leave it ` +
        `empty if it's useful at every level.`,
      input: JSON.stringify({
        title: input.primary.title,
        author: input.primary.author ?? null,
        blocks: input.blocks.map((b) => ({ block_id: b.blockId, text: b.text.slice(0, 1000) })),
      }),
      validate: normalizeDraft,
    });

    const validated = r.data
      .map((d) => validateDraft(d, blocksById, input.validRelationships))
      .filter((a): a is PassageAnnotation => a !== null);

    const anchored = validated.filter((a) => !a.isWholeWork).slice(0, maxAnnotations);
    const wholeWork = validated.filter((a) => a.isWholeWork).slice(0, 1);

    return {
      annotations: [...anchored, ...wholeWork],
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      usedModel: true,
    };
  } catch {
    return empty();
  }
}
