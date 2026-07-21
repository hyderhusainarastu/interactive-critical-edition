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
  blocks: Array<{ id: string; pageId: string; pageIndex: number; blockOrder: number; kind: string; text: string }>;
  authorialNotes: Array<{ id: string; marker: string; text: string }>;
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
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [selectionUi, setSelectionUi] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const page = edition.pages[pageIndex];
  const pageBlocks = useMemo(
    () => edition.blocks.filter((block) => block.pageId === page?.id).sort((a, b) => a.blockOrder - b.blockOrder),
    [edition.blocks, page?.id],
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
  }, [highlights, matchedNotesByBlock, pageBlocks, passageAnnotationsByBlock, scriptDisplay]);

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
    const firstBlock = pageBlocks[0];
    if (firstBlock) onPositionChange?.({ pageIndex, textBlockId: firstBlock.id });
  }, [onPositionChange, pageBlocks, pageIndex]);

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

  return (
    <section aria-label={isPhase12Reader ? "Processed text" : "Published critical edition"} className="mx-auto max-w-[72ch]">
      {!focusMode && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
        <strong>{isPhase12Reader ? "Processed text" : "Edition"} · run v{edition.run.version}</strong>
        <span>{edition.run.structureState === "full" ? "Structured extraction" : "Structure-limited"}</span>
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
            <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((i) => i - 1)} className="disabled:opacity-40">← Prev</button>
            <button type="button" disabled={pageIndex >= edition.pages.length - 1} onClick={() => setPageIndex((i) => i + 1)} className="disabled:opacity-40">Next →</button>
          </>
        )}
      </div>}
      {edition.run.note && <p className="mb-5 rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">{edition.run.note}</p>}

      {focusMode && page && (
        <div className="mb-4 flex items-center justify-between border-b border-[var(--color-border)] pb-2 text-sm">
          <span>Page {page.pageIndex + 1} / {edition.pages.length}</span>
          <div className="flex gap-3">
            <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)} className="disabled:opacity-40">← Prev</button>
            <button type="button" disabled={pageIndex >= edition.pages.length - 1} onClick={() => setPageIndex((index) => index + 1)} className="disabled:opacity-40">Next →</button>
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

      {/* Annotations (anchored + whole-work) live in the sidebar's
       *  "Annotations" tab now (plan §36 11.5) — clicking an in-text marker
       *  below opens and scrolls to its card there. */}
      {page && (
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
          {(pageBlocks.length ? pageBlocks : [{ id: "fallback", pageIndex, kind: "body", text: page.text ?? "" }]).map((block) => {
            const register = (element: HTMLElement | null) => {
              if (element) blockRefs.current.set(block.id, element);
              else blockRefs.current.delete(block.id);
            };
            const text = renderVerifiedTerms(block.text, block.id, edition.terms, scriptDisplay);
            if (block.kind === "title") return <h1 key={block.id} ref={register} onMouseUp={(event) => showSelectionToolbar(block.id, event.currentTarget)} className="font-serif text-3xl font-semibold">{text}</h1>;
            if (block.kind === "header") return <h2 key={block.id} ref={register} onMouseUp={(event) => showSelectionToolbar(block.id, event.currentTarget)} className="mt-4 font-serif text-xl font-semibold">{text}</h2>;
            if (block.kind === "footnote") return <aside key={block.id} ref={register} onMouseUp={(event) => showSelectionToolbar(block.id, event.currentTarget)} className="border-l-2 border-[var(--color-accent-ink)] pl-3 text-sm">{text}</aside>;
            return (
              <p
                key={block.id}
                ref={register}
                onMouseUp={(event) => showSelectionToolbar(block.id, event.currentTarget)}
                className="whitespace-pre-wrap"
              >
                {text}
              </p>
            );
          })}
        </article>
      )}

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
                <span className="font-medium">{report.provider}</span> · {report.status} · {report.resultCount} results
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
