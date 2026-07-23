import type { PrimaryWork, StructuredCaller } from "./synthesize";

/**
 * Phase 9.4 (plan §34.4): real extraction for the v3 sequence's
 * "concepts/people/debates" stage, which — like `section-passage-anchors`
 * before Phase 9.3 built it — has so far only been a label on
 * `processing_run.stage` with no data of its own (see `apps/worker/src/
 * analyze.ts`'s `concepts = [resolvedTitle]` placeholder). This is what a
 * work-specific diagnostic (9.4) needs something real to ask about: the
 * concepts, doctrines, people, traditions and debates a work actually
 * requires or discusses, extracted once per run and shared globally (the
 * `concept` table is append-only like `bibliographic_record`, not
 * per-user) — two readers studying the same doctrine must land on the same
 * node, or a later curriculum/graph cannot agree with itself.
 */

export const CONCEPT_KINDS = ["concept", "doctrine", "person", "tradition", "debate"] as const;
export type ConceptKind = (typeof CONCEPT_KINDS)[number];

/** How central this concept is to the work — mirrors `graph_edge`'s
 *  `presupposes` semantics: "prerequisite" means the reader needs this
 *  BEFORE the work makes sense; "central" means the work IS substantially
 *  about it; "mentioned" is neither — background color, not core matter. */
export const CONCEPT_ROLES = ["prerequisite", "central", "mentioned"] as const;
export type ConceptRole = (typeof CONCEPT_ROLES)[number];

export interface ExtractedConcept {
  /** Stable, URL-safe identity for dedup against the global `concept` table. */
  slug: string;
  kind: ConceptKind;
  label: string;
  summary: string;
  role: ConceptRole;
  confidence: number;
  /** Why this concept was surfaced for this work — never a bare assertion. */
  evidence: string;
}

const CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          kind: { type: "string", enum: [...CONCEPT_KINDS] },
          summary: { type: "string" },
          role: { type: "string", enum: [...CONCEPT_ROLES] },
          confidence: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["label", "kind", "summary", "role", "confidence", "evidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["concepts"],
  additionalProperties: false,
};

interface DraftConcept {
  label: string;
  kind: string;
  summary: string;
  role: string;
  confidence: number;
  evidence: string;
}

function normalizeDraft(parsed: unknown): DraftConcept[] {
  const p = parsed as { concepts?: unknown };
  if (!Array.isArray(p.concepts)) throw new Error("concepts not an array");
  return p.concepts
    .map((c) => c as Record<string, unknown>)
    .filter((c) => typeof c.label === "string" && typeof c.summary === "string")
    .map((c) => ({
      label: String(c.label).trim(),
      kind: typeof c.kind === "string" ? c.kind : "",
      summary: String(c.summary).trim(),
      role: typeof c.role === "string" ? c.role : "",
      confidence: typeof c.confidence === "number" ? c.confidence : 0,
      evidence: typeof c.evidence === "string" ? c.evidence.trim() : "",
    }));
}

/**
 * Deterministic slugify — lowercase, ASCII alphanumerics and hyphens only.
 * Dedup depends on two runs producing the SAME slug for the SAME underlying
 * concept, which only holds for identical wording (e.g. two runs both
 * saying "practical wisdom"); a near-duplicate under a different label
 * (e.g. "phronesis") will not merge with it. Documented, not silently
 * pretended away — exact-slug dedup is the honest first step, same posture
 * as `workIdentity.ts`'s title-key dedup before Phase 9's canonical
 * work-identity table existed.
 */
function slugify(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function validateDraft(draft: DraftConcept): ExtractedConcept | null {
  if (draft.label.length === 0 || draft.summary.length === 0 || draft.evidence.length === 0) return null;
  const slug = slugify(draft.label);
  if (slug.length === 0) return null;
  const kind = (CONCEPT_KINDS as readonly string[]).includes(draft.kind) ? (draft.kind as ConceptKind) : "concept";
  const role = (CONCEPT_ROLES as readonly string[]).includes(draft.role) ? (draft.role as ConceptRole) : "mentioned";
  return {
    slug,
    kind,
    label: draft.label,
    summary: draft.summary,
    role,
    confidence: Math.max(0, Math.min(1, draft.confidence)),
    evidence: draft.evidence,
  };
}

export interface SynthesizedConcepts {
  concepts: ExtractedConcept[];
  promptTokens: number;
  completionTokens: number;
  usedModel: boolean;
}

/**
 * Extract concepts/doctrines/people/traditions/debates for one run in a
 * single bulk call — bounded cost regardless of document length, same
 * pattern as `synthesizePassageAnnotations`. Falls back to an EMPTY result
 * (not a heuristic guess) with no model key: there is no honest
 * deterministic way to identify a work's conceptual apparatus from text
 * alone, so "none extracted this run" is the truthful degraded state.
 */
export async function synthesizeConcepts(
  caller: StructuredCaller,
  input: {
    primary: PrimaryWork;
    /** A representative sample of the work's own text — the structural
     *  outline or opening body text is enough; this is a topic-identification
     *  task, not exhaustive coverage, so the full text is not required. */
    textSample: string;
    model: string;
    safetyIdentifier?: string;
    maxConcepts?: number;
  },
): Promise<SynthesizedConcepts> {
  const empty = (): SynthesizedConcepts => ({ concepts: [], promptTokens: 0, completionTokens: 0, usedModel: false });
  if (!caller.available || input.textSample.trim().length === 0) return empty();

  const maxConcepts = input.maxConcepts ?? 10;
  // Scales with maxConcepts so a raised cap (e.g. 16, floors-capability-
  // proposal §4) actually has the completion budget to fill it — the entry
  // schema is verbose enough (summary + evidence sentences per concept) that
  // the old flat 2200 was sized for ~10 entries specifically, not a ceiling
  // that happens to also work for more.
  const maxOutputTokens = Math.max(2200, 2200 + (maxConcepts - 10) * 115);

  try {
    const r = await caller.call({
      model: input.model,
      schemaName: "extracted_concepts",
      schema: CONCEPT_SCHEMA,
      safetyIdentifier: input.safetyIdentifier,
      maxOutputTokens,
      system:
        `You identify the concepts, doctrines, people, traditions and debates a scholarly work requires or ` +
        `discusses — the vocabulary a reader would need a glossary or a diagnostic quiz for. Emit at most ` +
        `${maxConcepts} entries, ranked by importance to THIS work (not generality). For each: label is the ` +
        `term/name as a reader would recognize it (e.g. "akrasia", "categorical imperative", "Immanuel Kant"), ` +
        `kind classifies it, summary is one plain-language sentence explaining what it IS (not why it matters ` +
        `here — that belongs in evidence), role is "prerequisite" if a reader needs this before the work makes ` +
        `sense, "central" if the work is substantially about it, otherwise "mentioned", and evidence is one ` +
        `sentence naming where/how it appears in this work. Do not include the work's own title or author as a ` +
        `concept. Do not invent obscure jargon not actually load-bearing for this text — a short accessible work ` +
        `may genuinely have only 2-3 entries.`,
      input: JSON.stringify({
        title: input.primary.title,
        author: input.primary.author ?? null,
        text_sample: input.textSample.slice(0, 6000),
      }),
      validate: normalizeDraft,
    });

    const validated = r.data.map(validateDraft).filter((c): c is ExtractedConcept => c !== null);

    // Dedup within this single response (the model can repeat itself across
    // a long list) — last-wins on rank order preserved, first-wins on content
    // since an earlier mention is more likely to reflect the model's primary
    // framing of the concept.
    const bySlug = new Map<string, ExtractedConcept>();
    for (const c of validated) if (!bySlug.has(c.slug)) bySlug.set(c.slug, c);

    return {
      concepts: [...bySlug.values()].slice(0, maxConcepts),
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      usedModel: true,
    };
  } catch (err) {
    // A transient/malformed model call must not sink the whole run — degrade
    // to the honest empty result, same pattern as passage annotations and
    // relationship classification's heuristic fallback.
    console.error("[concepts] synthesis call failed, no concepts this run:", err);
    return empty();
  }
}
