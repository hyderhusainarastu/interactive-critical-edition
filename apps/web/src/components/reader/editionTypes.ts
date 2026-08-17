import type { RelationshipCategory } from "./types";

export type Authority = "A" | "B" | "C" | "D" | "E";
export type Agreement = "strong" | "contested" | "mixed" | "insufficient";

export interface EditionClaim {
  id: string;
  text: string;
  claimType: "factual" | "interpretive" | "inferred";
  agreement: Agreement;
  confidence: number;
  evidence: Array<{ stance: string; quote: string | null; resourceId: string | null }>;
}

/** How a record relates to the work it belongs to. */
export type RecordRole = "primary" | "review" | "edition" | "translation" | "excerpt";

/** One work, with the records that describe it attached rather than repeated. */
export interface EditionWork {
  key: string;
  title: string;
  authorSurname: string | null;
  primary: EditionResource;
  related: Array<{ id: string; title: string; role: RecordRole; evidence: string | null; url: string | null; provider: string }>;
}

export interface EditionResource {
  id: string;
  title: string;
  url: string | null;
  provider: string;
  resourceType: string;
  doi: string | null;
  year: number | null;
  authors: unknown;
  inspectionDepth: number;
  /** Canonical work identity (migration 0014); null for pre-0014 rows. */
  work: {
    key: string;
    role: RecordRole;
    canonicalTitle: string | null;
    authorSurname: string | null;
    evidence: string | null;
  } | null;
  credibility: {
    authority: Authority | null;
    agreement: Agreement | null;
    relevance: number | null;
    evidenceStrength: number | null;
    inspectionDepth: number;
    score: number;
    rationale: string | null;
  } | null;
}

/** What KIND of note a passage annotation is making about the passage itself
 *  — distinct from `relationship`, which describes how a cited/related source
 *  bears on the work (plan §34.4 9.3). */
export type PassageAnnotationType = "context" | "clarification" | "connection" | "critique" | "definition" | "key_term" | "concept" | "argument" | "evidence" | "relationship";
export type ReaderLevel = "beginner" | "undergraduate" | "advanced" | "research";

export interface EditionPassageAnnotation {
  id: string;
  textBlockId: string | null;
  isWholeWork: boolean;
  quote: string | null;
  summary: string;
  explanation: string;
  helpfulFor: string | null;
  scope: unknown;
  annotationType: PassageAnnotationType;
  relationship: RelationshipCategory;
  relatedResourceId: string | null;
  readerLevel: ReaderLevel | null;
  confidence: number;
  createdBy: "system" | "user" | "editor";
}

export interface EditionGeneratedNote {
  id: string;
  noteType: string;
  body: string;
  confidence: number;
  evidence: { quote: string | null; resourceId: string | null } | null;
  claims: EditionClaim[];
}

export interface EditionForeignSpan {
  id: string;
  textBlockId: string;
  startOffset: number;
  endOffset: number;
  /** Exact stored block substring used to validate the anchor. */
  sourceText: string;
  /** Original-script text; differs from sourceText only for labelled recovery. */
  originalText: string;
  transliteration: string;
  translation: string;
  languageCode: string;
  languageLabel: string;
  direction: "ltr" | "rtl";
  script: "greek" | "hebrew" | "arabic" | "cyrillic" | "cjk";
  translationProvenance: "machine_translation";
  sourceProvenance: {
    kind: "source_text" | "ocr_recovery" | "pdf_glyph_recovery" | "manual";
    label: string;
    confidence: number;
  };
}

export interface EditionPayload {
  run: { version: number; structureState: "full" | "limited"; note: string | null; status: string; stage: string | null };
  analysis: {
    degraded: boolean;
  };
  pages: Array<{ id: string; pageIndex: number; text: string | null; isOcr: boolean; extractionConfidence: number | null }>;
  blocks: Array<{
    id: string;
    pageId: string;
    pageIndex: number;
    blockOrder: number;
    kind: string;
    marker: string | null;
    text: string;
    /** D-23-9: deterministic, recomputed-on-read offsets of source-scan
     * garbage (corrupted font encoding in the source PDF). Optional so an
     * older cached payload shape still renders — absent means "none". */
    untranscribableSpans?: Array<{ start: number; end: number; reason: string }>;
  }>;
  authorialNotes: Array<{ id: string; marker: string; text: string; pageAnchor: unknown }>;
  authorApparatus: Array<{ id: string; textBlockId: string | null; kind: "footnote" | "endnote" | "bibliography_entry" | "citation_block"; marker: string | null; text: string; scope: unknown }>;
  terms: Array<{
    id: string;
    originalScript: string;
    transliteration: string;
    language: string;
    direction: string;
    verificationStatus: "suggested" | "verified";
    source: string;
    occurrences: Array<{ id: string; textBlockId: string; startOffset: number; endOffset: number }>;
  }>;
  /**
   * Migration-0036-backed rows only. Optional keeps the reader deployable
   * before Workstream H supplies the table/query; no client detector invents
   * content when this field is absent.
   */
  foreignSpans?: EditionForeignSpan[];
  /** Anchored to a real text_block_id — never a fabricated one (DB-enforced). */
  passageAnnotations: EditionPassageAnnotation[];
  /** No single passage applies; always rendered under the literal label
   *  "Whole-work guidance" (plan §34.4 9.3), never mixed with the anchored ones. */
  wholeWorkGuidance: EditionPassageAnnotation[];
  generatedNotes: EditionGeneratedNote[];
  /** Every record, unchanged — nothing is hidden from the payload. */
  resources: EditionResource[];
  /**
   * The same records grouped into WORKS, which is what the Library lists. A
   * book, a review of it and its second edition are three real records but one
   * work; `related` keeps the others visible, attached to the work.
   */
  works: EditionWork[];
  relations: Array<{ id: string; resourceId: string | null; relatedResourceId: string | null; relationType: string; depth: number; importance: number | null }>;
  providerReports: Array<{ provider: string; status: string; resultCount: number; inspectionDepth: number; latencyMs: number; error: string | null }>;
}

export const AUTHORITY_LABEL: Record<Authority, string> = {
  A: "A · peer-reviewed / primary",
  B: "B · reputable scholarship",
  C: "C · credible web",
  D: "D · general web / video",
  E: "E · unverified / social",
};
export const AGREEMENT_LABEL: Record<Agreement, string> = {
  strong: "strong agreement",
  contested: "contested",
  mixed: "mixed evidence",
  insufficient: "insufficient corroboration",
};
export const PASSAGE_TYPE_LABEL: Record<PassageAnnotationType, string> = {
  context: "Context",
  clarification: "Clarification",
  connection: "Connection",
  critique: "Critique",
  definition: "Definition",
  key_term: "Key term",
  concept: "Concept",
  argument: "Argument",
  evidence: "Evidence",
  relationship: "Relationship",
};
export const READER_LEVEL_LABEL: Record<ReaderLevel, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
};
