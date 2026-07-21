"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_META } from "./annotationMeta";
import { applyAnnotationMarkers, applyHighlights, captureSelectionAnchor, clearAnnotationMarkers } from "./highlightDom";
import { AnnotationHoverPreview } from "./AnnotationHoverPreview";
import { matchNoteToBlock } from "./matchNoteToBlock";
import type { RelationshipCategory } from "./types";
import type { HighlightRecord } from "./types";

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

export interface EditionPayload {
  run: { version: number; structureState: "full" | "limited"; note: string | null; status: string; stage: string | null };
  cost: {
    aiCostUsd: number;
    degraded: boolean;
    saturationNote: string | null;
    /** Per-module actual cost behind the single total above (plan §34.4 9.7). */
    breakdown: Array<{ stage: string | null; task: string; costUsd: number; calls: number; promptTokens: number; completionTokens: number }>;
  };
  pages: Array<{ id: string; pageIndex: number; text: string | null; isOcr: boolean; extractionConfidence: number | null }>;
  blocks: Array<{ id: string; pageId: string; pageIndex: number; blockOrder: number; kind: string; marker: string | null; text: string }>;
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

export function AuthorityBadge({ authority }: { authority: Authority | null }) {
  if (!authority) return null;
  const color = authority === "A" || authority === "B" ? "var(--color-accent-green)" : authority === "C" ? "var(--color-accent-ink)" : "var(--color-border)";
  return (
    <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium" style={{ borderColor: color }} title={AUTHORITY_LABEL[authority]}>
      {AUTHORITY_LABEL[authority]}
    </span>
  );
}

export function ClaimTypeBadge({ type }: { type: EditionClaim["claimType"] }) {
  const label = type === "factual" ? "factual" : type === "inferred" ? "AI-inferred" : "interpretive";
  return <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">{label}</span>;
}

export function ClaimView({ claim }: { claim: EditionClaim }) {
  const [open, setOpen] = useState(false);
  const supporting = claim.evidence.filter((e) => e.stance === "supports" && e.quote);
  const contradicting = claim.evidence.filter((e) => e.stance === "contradicts" && e.quote);
  const hasEvidence = supporting.length > 0 || contradicting.length > 0;
  return (
    <li className="rounded border border-[var(--color-border)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <ClaimTypeBadge type={claim.claimType} />
        <span className="text-xs text-[var(--color-text-muted)]">{AGREEMENT_LABEL[claim.agreement]}</span>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">{Math.round(claim.confidence * 100)}%</span>
      </div>
      <p className="mt-1">{claim.text}</p>
      {hasEvidence && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 text-xs underline">
          {open ? "Hide evidence" : `Evidence (${supporting.length + contradicting.length})`}
        </button>
      )}
      {open && hasEvidence && (
        // Competing interpretations side by side when both sides exist.
        <div className={`mt-2 grid gap-2 ${contradicting.length ? "sm:grid-cols-2" : "grid-cols-1"}`}>
          {supporting.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-accent-green)]">Supporting</p>
              <ul className="mt-1 flex flex-col gap-1">
                {supporting.map((e, i) => <li key={i} className="border-l-2 border-[var(--color-accent-green)] pl-2 text-xs italic">“{e.quote}”</li>)}
              </ul>
            </div>
          )}
          {contradicting.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-accent-ink)]">Contradicting</p>
              <ul className="mt-1 flex flex-col gap-1">
                {contradicting.map((e, i) => <li key={i} className="border-l-2 border-[var(--color-accent-ink)] pl-2 text-xs italic">“{e.quote}”</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function renderVerifiedTerms(
  text: string,
  blockId: string,
  terms: EditionPayload["terms"],
  scriptDisplay: "original" | "transliteration",
) {
  const occurrences = terms
    .filter((term) => term.verificationStatus === "verified")
    .flatMap((term) => term.occurrences.map((occurrence) => ({ term, ...occurrence })))
    .filter((occurrence) => occurrence.textBlockId === blockId)
    .filter((occurrence) => (
      occurrence.startOffset >= 0
      && occurrence.endOffset <= text.length
      && occurrence.endOffset > occurrence.startOffset
      && text.slice(occurrence.startOffset, occurrence.endOffset) === occurrence.term.originalScript
    ))
    .sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset);

  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const occurrence of occurrences) {
    if (occurrence.startOffset < offset) continue;
    if (occurrence.startOffset > offset) nodes.push(text.slice(offset, occurrence.startOffset));
    const displayed = scriptDisplay === "transliteration" ? occurrence.term.transliteration : occurrence.term.originalScript;
    nodes.push(
      <span
        key={occurrence.id}
        data-verified-term={occurrence.term.id}
        lang={occurrence.term.language}
        dir={occurrence.term.direction === "rtl" ? "rtl" : "ltr"}
        className="rounded-sm bg-[color-mix(in_srgb,var(--color-accent-ink)_12%,transparent)] px-0.5 text-[var(--color-accent-ink)]"
        title={scriptDisplay === "transliteration" ? occurrence.term.originalScript : occurrence.term.transliteration}
      >
        {displayed}
      </span>,
    );
    offset = occurrence.endOffset;
  }
  if (offset < text.length) nodes.push(text.slice(offset));
  return nodes.length ? nodes : text;
}

function InlineEvidenceMeta({
  note,
  resource,
}: {
  note: EditionPassageAnnotation;
  resource: EditionResource | undefined;
}) {
  const source = resource?.title ?? `Document passage${note.textBlockId ? " (anchored)" : ""}`;
  return (
    <p className="mt-1 text-[0.68rem] leading-snug text-[var(--color-text-muted)]">
      Source: {source} · confidence {Math.round(note.confidence * 100)}% · provenance: {note.createdBy === "system" ? "AI-generated, evidence-grounded" : note.createdBy}
    </p>
  );
}

/** A compact marginal reading aid on wide screens. Its long explanation is
 * hidden until hover/focus; narrow layouts receive an explicit inline
 * disclosure immediately below the passage instead. */
function MarginNote({
  note,
  resource,
}: {
  note: EditionPassageAnnotation;
  resource: EditionResource | undefined;
}) {
  const category = CATEGORY_META[note.relationship];
  return (
    <aside className="group hidden xl:block absolute left-[calc(100%+1.25rem)] top-0 w-52 border-l-2 bg-[var(--color-surface)] px-2 py-1.5 text-xs shadow-sm" style={{ borderColor: `var(${category.colorVar})` }} aria-label={`${category.label} margin note`} tabIndex={0}>
      <p className="font-medium"><span aria-hidden>{category.glyph}</span> {note.summary}</p>
      <div className="max-h-0 overflow-hidden opacity-0 transition-all duration-150 group-hover:max-h-96 group-hover:opacity-100 group-focus-within:max-h-96 group-focus-within:opacity-100">
        <p className="mt-1 leading-snug">{note.explanation}</p>
        <InlineEvidenceMeta note={note} resource={resource} />
      </div>
    </aside>
  );
}

/** Published-run reader: authorial (source) notes and AI-generated editorial
 * material are visibly distinct; every generated claim exposes its source-
 * grounded evidence, credibility, and agreement (plan §33 §3.4).
 *
 * Passage annotations (plan §34.4 9.3, ported to in-text markers in plan §36
 * 11.5): rather than an unconditional below-paragraph list, each anchored
 * annotation becomes a click-to-reveal marker inserted directly into the
 * block text (reusing `applyAnnotationMarkers`/the quote-fingerprint logic
 * from `highlightDom.ts`, same mechanism `TextReader` already uses) plus a
 * hover preview; the full explanation lives in the sidebar
 * (`EditionAnnotationsPanel`), which `onOpenAnnotation` opens and scrolls to
 * — mirroring `AnnotationsPanel`'s existing scroll-to-active behavior. */
export function EditionReader({
  edition,
  onOpenAnnotation,
  activeAnnotationId = null,
  highlights = [],
  notes = [],
  scriptDisplay = "original",
  focusMode = false,
  onPositionChange,
  onCreateHighlight,
  onCreateLinkedNote,
  onLinkExistingNote,
  isPhase12Reader = false,
  activeBlockId = null,
}: {
  edition: EditionPayload;
  onOpenAnnotation: (id: string) => void;
  activeAnnotationId?: string | null;
  highlights?: HighlightRecord[];
  notes?: Array<{ id: string; body: string }>;
  scriptDisplay?: "original" | "transliteration";
  focusMode?: boolean;
  onPositionChange?: (position: { pageIndex: number; textBlockId: string }) => void;
  onCreateHighlight?: (anchor: { pageIndex: number; textBlockId: string; quote: string; prefix: string; suffix: string }) => Promise<string | undefined>;
  onCreateLinkedNote?: (anchor: { pageIndex: number; textBlockId: string; quote: string; prefix: string; suffix: string }) => Promise<void>;
  onLinkExistingNote?: (noteId: string, anchor: { pageIndex: number; textBlockId: string; quote: string; prefix: string; suffix: string }) => Promise<void>;
  isPhase12Reader?: boolean;
  /** A sidebar apparatus/index selection can jump to a real source block. */
  activeBlockId?: string | null;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [selectionUi, setSelectionUi] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const page = edition.pages[pageIndex];
  const orderedBlocks = useMemo(
    () => [...edition.blocks].sort((a, b) => a.pageIndex - b.pageIndex || a.blockOrder - b.blockOrder),
    [edition.blocks],
  );
  const outline = useMemo(
    () => edition.blocks
      .filter((block) => block.kind === "title" || block.kind === "header")
      .map((block) => ({ id: block.id, label: block.text, pageIndex: block.pageIndex, level: block.kind === "title" ? 1 : 2 })),
    [edition.blocks],
  );
  const passageAnnotationsByBlock = useMemo(() => {
    const map = new Map<string, EditionPassageAnnotation[]>();
    for (const a of edition.passageAnnotations) {
      if (!a.textBlockId) continue;
      const list = map.get(a.textBlockId) ?? [];
      list.push(a);
      map.set(a.textBlockId, list);
    }
    return map;
  }, [edition.passageAnnotations]);
  const matchedNotesByBlock = useMemo(() => {
    const map = new Map<string, EditionGeneratedNote[]>();
    for (const note of edition.generatedNotes) {
      const match = matchNoteToBlock(note, edition.blocks);
      if (!match) continue;
      const list = map.get(match.blockId) ?? [];
      list.push(note);
      map.set(match.blockId, list);
    }
    return map;
  }, [edition.blocks, edition.generatedNotes]);
  const previewById = useMemo(() => {
    const map = new Map<string, { glyph: string; colorVar: string; categoryLabel: string; summary: string }>();
    for (const a of edition.passageAnnotations) {
      map.set(a.id, {
        glyph: CATEGORY_META[a.relationship].glyph,
        colorVar: CATEGORY_META[a.relationship].colorVar,
        categoryLabel: CATEGORY_META[a.relationship].label,
        summary: a.summary,
      });
    }
    for (const note of edition.generatedNotes) {
      map.set(note.id, {
        glyph: "✣",
        colorVar: "--color-credibility-warning",
        categoryLabel: "Matched critical note",
        summary: note.body,
      });
    }
    return map;
  }, [edition.generatedNotes, edition.passageAnnotations]);

  const blockRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    for (const [blockId, el] of blockRefs.current) {
      const notes = passageAnnotationsByBlock.get(blockId);
      const matchedNotes = matchedNotesByBlock.get(blockId);
      const blockHighlights = highlights.filter(
        (highlight): highlight is HighlightRecord & { anchor: { kind: "processed"; pageIndex: number; textBlockId: string; quote: string; prefix: string; suffix: string } } =>
          highlight.anchor.kind === "processed" && highlight.anchor.textBlockId === blockId,
      );
      applyHighlights(el, blockHighlights.map((highlight) => ({
        id: highlight.id,
        color: highlight.color,
        quote: highlight.anchor.quote,
        prefix: highlight.anchor.prefix,
        suffix: highlight.anchor.suffix,
      })));
      if ((!notes || notes.length === 0) && (!matchedNotes || matchedNotes.length === 0)) {
        clearAnnotationMarkers(el);
        continue;
      }
      applyAnnotationMarkers(
        el,
        [
          ...(notes ?? [])
          .filter((n): n is EditionPassageAnnotation & { quote: string } => n.quote !== null)
          .map((n) => ({
            id: n.id,
            quote: n.quote,
            prefix: "",
            suffix: "",
            colorVar: CATEGORY_META[n.relationship].colorVar,
            glyph: CATEGORY_META[n.relationship].glyph,
            markerKind: "annotation" as const,
          })),
          ...(matchedNotes ?? [])
            .filter((n): n is EditionGeneratedNote & { evidence: { quote: string; resourceId: string | null } } => n.evidence?.quote !== null && n.evidence?.quote !== undefined)
            .map((n) => ({
              id: n.id,
              quote: n.evidence.quote,
              prefix: "",
              suffix: "",
              colorVar: "--color-credibility-warning",
              glyph: "✣",
              markerKind: "matched-note" as const,
              ariaLabel: "Matched critical note — open details",
            })),
        ],
      );
    }
  }, [highlights, matchedNotesByBlock, orderedBlocks, passageAnnotationsByBlock, scriptDisplay]);

  useEffect(() => {
    if (!activeAnnotationId) return;
    const annotation = edition.passageAnnotations.find((item) => item.id === activeAnnotationId);
    if (!annotation?.textBlockId) return;
    const block = edition.blocks.find((item) => item.id === annotation.textBlockId);
    if (!block) return;
    const frame = window.requestAnimationFrame(() => {
      setPageIndex(block.pageIndex);
      window.requestAnimationFrame(() => blockRefs.current.get(block.id)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeAnnotationId, edition.blocks, edition.passageAnnotations]);

  useEffect(() => {
    const firstBlock = orderedBlocks.find((block) => block.pageIndex === pageIndex);
    if (firstBlock) onPositionChange?.({ pageIndex, textBlockId: firstBlock.id });
  }, [onPositionChange, orderedBlocks, pageIndex]);

  useEffect(() => {
    if (!activeBlockId) return;
    const block = edition.blocks.find((item) => item.id === activeBlockId);
    if (!block) return;
    window.requestAnimationFrame(() => {
      setPageIndex(block.pageIndex);
      blockRefs.current.get(block.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [activeBlockId, edition.blocks]);

  const hoverNote = hover ? previewById.get(hover.id) : null;

  function selectionAnchor(blockId: string) {
    const element = blockRefs.current.get(blockId);
    const block = edition.blocks.find((item) => item.id === blockId);
    const anchor = element ? captureSelectionAnchor(element) : null;
    if (!block || !anchor) return null;
    return { pageIndex: block.pageIndex, textBlockId: blockId, ...anchor };
  }

  function showSelectionToolbar(blockId: string, element: HTMLElement) {
    if (!captureSelectionAnchor(element)) {
      setSelectionUi(null);
      return;
    }
    const range = window.getSelection()?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();
    if (!rect) return;
    setSelectionUi({ blockId, x: rect.left + rect.width / 2, y: rect.top + window.scrollY });
  }

  async function runSelectionAction(action: (anchor: { pageIndex: number; textBlockId: string; quote: string; prefix: string; suffix: string }) => Promise<unknown>) {
    if (!selectionUi) return;
    const anchor = selectionAnchor(selectionUi.blockId);
    if (!anchor) return;
    await action(anchor);
    window.getSelection()?.removeAllRanges();
    setSelectionUi(null);
  }

  function goToPage(nextPageIndex: number) {
    const clamped = Math.min(Math.max(0, nextPageIndex), Math.max(0, edition.pages.length - 1));
    setPageIndex(clamped);
    const first = orderedBlocks.find((block) => block.pageIndex === clamped);
    if (first) window.requestAnimationFrame(() => blockRefs.current.get(first.id)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  return (
    <section aria-label="Interactive reader — processed text" className="mx-auto max-w-[72ch]">
      {!focusMode && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
        <strong>Interactive reader · processed text · run v{edition.run.version}</strong>
        <span>{edition.run.structureState === "full" ? "Structured extraction" : "Structure-limited extraction"}</span>
        {edition.cost.breakdown.length > 0 ? (
          <details className="text-[var(--color-text-muted)]">
            <summary className="cursor-pointer">AI cost ${Number(edition.cost.aiCostUsd).toFixed(4)}</summary>
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {edition.cost.breakdown.map((b, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{b.stage ?? b.task}</span>
                  <span>${b.costUsd.toFixed(4)} · {b.calls} call{b.calls === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span className="text-[var(--color-text-muted)]">AI cost ${Number(edition.cost.aiCostUsd).toFixed(4)}</span>
        )}
        {/* `degraded` is set only when the run crossed its cost soft cap
         *  (see `overSoftCap()` in apps/worker/src/analyze.ts) — it never
         *  means anything else, so the default tooltip names the cause
         *  rather than a generic "stopped early". */}
        {edition.cost.degraded && <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-xs" title={edition.cost.saturationNote ?? "Research stopped early — cost limit reached"}>degraded</span>}
        {isPhase12Reader && outline.length > 0 && (
          <details className="relative">
            <summary className="cursor-pointer">Outline</summary>
            <nav aria-label="Document outline" className="absolute left-0 top-6 z-20 max-h-64 w-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 shadow-lg">
              {outline.map((item) => <button key={item.id} type="button" onClick={() => { setPageIndex(item.pageIndex); window.requestAnimationFrame(() => blockRefs.current.get(item.id)?.scrollIntoView({ block: "start", behavior: "smooth" })); }} className={`block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--color-surface)] ${item.level === 2 ? "pl-4" : "font-medium"}`}>{item.label}</button>)}
            </nav>
          </details>
        )}
        {page && (
          <>
            <span className="ml-auto">Page {page.pageIndex + 1} / {edition.pages.length}</span>
            <button type="button" disabled={pageIndex === 0} onClick={() => goToPage(pageIndex - 1)} className="disabled:opacity-40">← Prev</button>
            <button type="button" disabled={pageIndex >= edition.pages.length - 1} onClick={() => goToPage(pageIndex + 1)} className="disabled:opacity-40">Next →</button>
          </>
        )}
      </div>}
      {edition.run.note && <p className="mb-5 rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">{edition.run.note}</p>}

      {focusMode && page && (
        <div className="mb-4 flex items-center justify-between border-b border-[var(--color-border)] pb-2 text-sm">
          <span>Page {page.pageIndex + 1} / {edition.pages.length}</span>
          <div className="flex gap-3">
            <button type="button" disabled={pageIndex === 0} onClick={() => goToPage(pageIndex - 1)} className="disabled:opacity-40">← Prev</button>
            <button type="button" disabled={pageIndex >= edition.pages.length - 1} onClick={() => goToPage(pageIndex + 1)} className="disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}

      {selectionUi && (
        <div
          className="fixed z-30 flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-md bg-[var(--color-accent-ink)] px-2 py-1.5 text-xs text-[var(--color-background)] shadow-lg"
          style={{ left: selectionUi.x, top: selectionUi.y - 8, transform: "translate(-50%, -100%)" }}
          role="toolbar"
          aria-label="Selected text actions"
        >
          {onCreateHighlight && <button type="button" onClick={() => void runSelectionAction(onCreateHighlight)}>Highlight</button>}
          {onCreateLinkedNote && <button type="button" onClick={() => void runSelectionAction(onCreateLinkedNote)}>New linked note</button>}
          {onLinkExistingNote && notes.length > 0 && (
            <select
              aria-label="Link existing note"
              defaultValue=""
              className="max-w-32 rounded bg-[var(--color-background)] px-1 py-0.5 text-[var(--color-text)]"
              onChange={(event) => {
                const noteId = event.target.value;
                if (noteId) void runSelectionAction((anchor) => onLinkExistingNote(noteId, anchor));
              }}
            >
              <option value="">Link note…</option>
              {notes.map((note) => <option key={note.id} value={note.id}>{note.body.slice(0, 42)}</option>)}
            </select>
          )}
        </div>
      )}

      {/* This is deliberately one continuous transcript. Page/block anchors
       * remain in the data and navigation, but authorial apparatus blocks are
       * not printed back into the prose flow: footnotes, endnotes, and
       * bibliography stay in their labelled linked apparatus. */}
      <article
        className="flex flex-col gap-4 leading-[1.7] text-[var(--color-text)]"
        onClick={(e) => {
          const marker = (e.target as HTMLElement).closest?.("button[data-annotation-id]");
          if (marker) onOpenAnnotation((marker as HTMLElement).dataset.annotationId!);
        }}
        onMouseOver={(e) => {
          const marker = (e.target as HTMLElement).closest?.("button[data-annotation-id]");
          if (marker) setHover({ id: (marker as HTMLElement).dataset.annotationId!, rect: marker.getBoundingClientRect() });
        }}
        onMouseOut={(e) => {
          const marker = (e.target as HTMLElement).closest?.("button[data-annotation-id]");
          if (marker) setHover(null);
        }}
      >
        {orderedBlocks.filter((block) => !["footnote", "endnote", "bibliography", "reference"].includes(block.kind)).map((block, index) => {
          const register = (element: HTMLElement | null) => {
            if (element) blockRefs.current.set(block.id, element);
            else blockRefs.current.delete(block.id);
          };
          const text = renderVerifiedTerms(block.text, block.id, edition.terms, scriptDisplay);
          const noteForBlock = passageAnnotationsByBlock.get(block.id) ?? [];
          const resourceById = new Map(edition.resources.map((resource) => [resource.id, resource]));
          const inlineNotes = noteForBlock.map((note) => (
            <details key={`inline-${note.id}`} className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm xl:hidden">
              <summary className="cursor-pointer font-medium">{CATEGORY_META[note.relationship].label}: {note.summary}</summary>
              <p className="mt-1">{note.explanation}</p>
              <InlineEvidenceMeta note={note} resource={note.relatedResourceId ? resourceById.get(note.relatedResourceId) : undefined} />
            </details>
          ));
          const margins = noteForBlock.slice(0, 2).map((note) => <MarginNote key={`margin-${note.id}`} note={note} resource={note.relatedResourceId ? resourceById.get(note.relatedResourceId) : undefined} />);
          const common = { ref: register, onMouseUp: (event: React.MouseEvent<HTMLElement>) => showSelectionToolbar(block.id, event.currentTarget) };
          const pageStart = index === 0 || orderedBlocks.filter((candidate) => !["footnote", "endnote", "bibliography", "reference"].includes(candidate.kind))[index - 1]?.pageIndex !== block.pageIndex;
          return (
            <div key={block.id} className="relative" data-page-index={block.pageIndex}>
              {pageStart && <p className="mb-2 text-xs text-[var(--color-text-muted)]">Source page {block.pageIndex + 1}</p>}
              {block.kind === "title" ? <h1 {...common} className="font-serif text-3xl font-semibold">{text}</h1> : block.kind === "header" ? <h2 {...common} className="mt-4 font-serif text-xl font-semibold">{text}</h2> : block.kind === "caption" ? <figcaption {...common} className="border-l-2 border-[var(--color-border)] pl-3 text-sm italic text-[var(--color-text-muted)]">{text}</figcaption> : <p {...common} className="whitespace-pre-wrap">{text}</p>}
              {margins}
              {inlineNotes}
            </div>
          );
        })}
      </article>

      {hover && hoverNote && (
        <AnnotationHoverPreview
          glyph={hoverNote.glyph}
          colorVar={hoverNote.colorVar}
          categoryLabel={hoverNote.categoryLabel}
          summary={hoverNote.summary}
          anchorRect={hover.rect}
        />
      )}

      {/* Authorial notes and AI-generated critical notes moved to the
       *  sidebar's "Notes" tab (plan §36 11.6). Generated notes may also
       *  receive visibly-inferred in-text markers when their evidence quote
       *  matches exactly one block; authorial notes remain page/sidebar-only
       *  because they carry no block anchor. */}

      {/* "Sources consulted" moved to the sidebar's "Sources" tab (plan §36
       *  11.5, `EditionAnnotationsPanel.tsx`) — same content, no longer
       *  requiring a scroll past the whole text to reach it. */}

      {edition.providerReports.length > 0 && (
        <section className="mt-8 border-t border-[var(--color-border)] pt-4">
          <h2 className="font-semibold">Provider reports <span className="text-xs font-normal text-[var(--color-text-muted)]">(what was consulted)</span></h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {edition.providerReports.map((report) => (
              <li key={report.provider} className="rounded border border-[var(--color-border)] px-2 py-1" title={report.error ?? undefined}>
                <span className="font-medium">{report.provider}</span> · {report.error === "No generated discovery lane selected this provider." ? "not selected" : report.status} · {report.resultCount} results
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
