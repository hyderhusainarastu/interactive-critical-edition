"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReaderLevelFilter, ReaderLevelMatchMode } from "@ice/roadmap";
import { CredibilityMeter } from "@/components/CredibilityMeter";
import { CATEGORY_META } from "./annotationMeta";
import {
  AGREEMENT_LABEL,
  AuthorityBadge,
  ClaimView,
  type EditionGeneratedNote,
  PASSAGE_TYPE_LABEL,
  READER_LEVEL_LABEL,
  type EditionPassageAnnotation,
  type EditionPayload,
  type EditionResource,
  type PassageAnnotationType,
} from "./EditionReader";
import { matchNoteToBlock } from "./matchNoteToBlock";
import type { RelationshipCategory } from "./types";

type Tab = "annotations" | "notes" | "apparatus" | "terms" | "sources";
const READER_LEVEL_FILTER_OPTIONS: ReaderLevelFilter[] = ["beginner", "undergraduate", "advanced", "research", "all"];
const READER_LEVEL_FILTER_LABEL: Record<ReaderLevelFilter, string> = { ...READER_LEVEL_LABEL, all: "Show all levels" };

export interface EditionReaderFilters {
  annotationType: PassageAnnotationType | "all";
  relationship: RelationshipCategory | "all";
  provenance: "all" | "ai" | "user";
  apparatusKind: "all" | "footnote" | "endnote" | "bibliography_entry" | "citation_block";
}

/**
 * The interactive reader's sidebar is an index/filter/detail surface, never a
 * second long-form copy of every margin note. It also owns the labelled
 * source apparatus so authorial notes cannot be mistaken for generated prose.
 * `AnnotationsPanel.tsx`'s shell (same width/border/scroll behavior) so the
 * two readers share one visual language. Two tabs for now: "Annotations"
 * (passage annotations, both anchored and whole-work, ported off the old
 * unconditional below-paragraph list) and "Sources" (the "Sources
 * consulted" list, relocated here so a long document no longer needs
 * scrolling past the whole text to reach it). "Notes" (plan §36 11.6)
 * keeps generated critical notes and source footnotes in the same side rail,
 * with generated-note markers only when quote matching is unambiguous.
 */
export function EditionAnnotationsPanel({
  edition,
  activeId,
  readerLevel,
  levelMode,
  enableLevelFilter,
  enablePhase12Reader = false,
  filters,
  onReaderLevelChange,
  onLevelModeChange,
  onFiltersChange,
  onPreviousAnnotation,
  onNextAnnotation,
  onApproveTerm,
  onSelectAnnotation,
}: {
  edition: EditionPayload;
  activeId: string | null;
  readerLevel: ReaderLevelFilter;
  levelMode: ReaderLevelMatchMode;
  enableLevelFilter: boolean;
  enablePhase12Reader?: boolean;
  filters: EditionReaderFilters;
  onReaderLevelChange: (level: ReaderLevelFilter) => void;
  onLevelModeChange: (mode: ReaderLevelMatchMode) => void;
  onFiltersChange: (filters: EditionReaderFilters) => void;
  onPreviousAnnotation?: () => void;
  onNextAnnotation?: () => void;
  onApproveTerm?: (termId: string) => void;
  onSelectAnnotation?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("annotations");
  const resourceById = new Map(edition.resources.map((r) => [r.id, r]));
  const anchoredNotes = edition.passageAnnotations.filter((a) => a.textBlockId !== null);
  const annotationCount = anchoredNotes.length + edition.wholeWorkGuidance.length;
  const notesCount = edition.generatedNotes.length + edition.authorialNotes.length;
  const apparatusCount = edition.authorApparatus.length;
  const suggestedTerms = edition.terms.filter((term) => term.verificationStatus === "suggested");
  const activeIsGeneratedNote = activeId ? edition.generatedNotes.some((note) => note.id === activeId) : false;
  const annotationTypes = useMemo(() => [...new Set(edition.passageAnnotations.map((annotation) => annotation.annotationType))], [edition.passageAnnotations]);
  const relationships = useMemo(() => [...new Set(edition.passageAnnotations.map((annotation) => annotation.relationship))], [edition.passageAnnotations]);

  // Clicking an in-text marker always means "show me the annotation" — if
  // the reader is currently on another tab, switch to the tab that owns the
  // active id so the newly-active card is actually visible to scroll to. A
  // one-shot sync from an external prop change (the click), not a derived
  // value — the reader must still be free to switch tabs afterward without
  // activeId (unchanged) snapping them back.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeId) setTab(activeIsGeneratedNote ? "notes" : "annotations");
  }, [activeId, activeIsGeneratedNote]);

  return (
    <aside aria-label="Edition sidebar" className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="sticky top-0 z-10 flex gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-sm">
        <button
          type="button"
          aria-pressed={tab === "annotations"}
          onClick={() => setTab("annotations")}
          className="rounded px-3 py-1.5"
          style={{ background: tab === "annotations" ? "var(--color-background)" : "transparent" }}
        >
          Annotations{annotationCount > 0 ? ` (${annotationCount})` : ""}
        </button>
        <button
          type="button"
          aria-pressed={tab === "notes"}
          onClick={() => setTab("notes")}
          className="rounded px-3 py-1.5"
          style={{ background: tab === "notes" ? "var(--color-background)" : "transparent" }}
        >
          Notes{notesCount > 0 ? ` (${notesCount})` : ""}
        </button>
        {enablePhase12Reader && <button type="button" aria-pressed={tab === "apparatus"} onClick={() => setTab("apparatus")} className="rounded px-3 py-1.5" style={{ background: tab === "apparatus" ? "var(--color-background)" : "transparent" }}>Apparatus{apparatusCount > 0 ? ` (${apparatusCount})` : ""}</button>}
        {enablePhase12Reader && <button type="button" aria-pressed={tab === "terms"} onClick={() => setTab("terms")} className="rounded px-3 py-1.5" style={{ background: tab === "terms" ? "var(--color-background)" : "transparent" }}>Terms{suggestedTerms.length > 0 ? ` (${suggestedTerms.length})` : ""}</button>}
        <button
          type="button"
          aria-pressed={tab === "sources"}
          onClick={() => setTab("sources")}
          className="rounded px-3 py-1.5"
          style={{ background: tab === "sources" ? "var(--color-background)" : "transparent" }}
        >
          Sources{edition.works.length > 0 ? ` (${edition.works.length})` : ""}
        </button>
      </div>

      {enableLevelFilter && tab === "annotations" && (
        <div className="grid grid-cols-1 gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs">
          <label className="flex items-center justify-between gap-2">
            <span className="text-[var(--color-text-muted)]">Reader level</span>
            <select
              value={readerLevel}
              onChange={(event) => onReaderLevelChange(event.target.value as ReaderLevelFilter)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"
            >
              {READER_LEVEL_FILTER_OPTIONS.map((level) => <option key={level} value={level}>{READER_LEVEL_FILTER_LABEL[level]}</option>)}
            </select>
          </label>
          {readerLevel !== "all" && (
            <label className="flex items-center justify-between gap-2">
              <span className="text-[var(--color-text-muted)]">Level match</span>
              <select
                value={levelMode}
                onChange={(event) => onLevelModeChange(event.target.value as ReaderLevelMatchMode)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"
              >
                <option value="cumulative">Selected + foundations</option>
                <option value="exact">Exact level</option>
              </select>
            </label>
          )}
          {enablePhase12Reader && (
            <>
              <label className="flex items-center justify-between gap-2"><span className="text-[var(--color-text-muted)]">Annotation type</span><select value={filters.annotationType} onChange={(event) => onFiltersChange({ ...filters, annotationType: event.target.value as EditionReaderFilters["annotationType"] })} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">All types</option>{annotationTypes.map((type) => <option key={type} value={type}>{PASSAGE_TYPE_LABEL[type]}</option>)}</select></label>
              <label className="flex items-center justify-between gap-2"><span className="text-[var(--color-text-muted)]">Relationship</span><select value={filters.relationship} onChange={(event) => onFiltersChange({ ...filters, relationship: event.target.value as EditionReaderFilters["relationship"] })} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">All relationships</option>{relationships.map((relationship) => <option key={relationship} value={relationship}>{CATEGORY_META[relationship].label}</option>)}</select></label>
              <label className="flex items-center justify-between gap-2"><span className="text-[var(--color-text-muted)]">Annotation source</span><select value={filters.provenance} onChange={(event) => onFiltersChange({ ...filters, provenance: event.target.value as EditionReaderFilters["provenance"] })} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">AI and user</option><option value="ai">AI annotations</option><option value="user">User annotations</option></select></label>
              <div className="flex justify-end gap-2"><button type="button" onClick={onPreviousAnnotation} disabled={!onPreviousAnnotation} className="underline disabled:opacity-40">Previous</button><button type="button" onClick={onNextAnnotation} disabled={!onNextAnnotation} className="underline disabled:opacity-40">Next</button></div>
            </>
          )}
        </div>
      )}

      {tab === "annotations" ? (
        <AnnotationsTab edition={edition} activeId={activeId} anchoredNotes={anchoredNotes} resourceById={resourceById} onSelectAnnotation={onSelectAnnotation} />
      ) : tab === "notes" ? (
        <NotesTab edition={edition} activeId={activeId} resourceById={resourceById} activeIsGeneratedNote={activeIsGeneratedNote} />
      ) : tab === "apparatus" ? (
        <ApparatusTab edition={edition} kind={filters.apparatusKind} onKindChange={(apparatusKind) => onFiltersChange({ ...filters, apparatusKind })} />
      ) : tab === "terms" ? (
        <TermsTab terms={edition.terms} onApproveTerm={onApproveTerm} />
      ) : (
        <SourcesTab edition={edition} />
      )}
    </aside>
  );
}

function NotesTab({
  edition,
  activeId,
  resourceById,
  activeIsGeneratedNote,
}: {
  edition: EditionPayload;
  activeId: string | null;
  resourceById: Map<string, EditionResource>;
  activeIsGeneratedNote: boolean;
}) {
  if (edition.generatedNotes.length === 0 && edition.authorialNotes.length === 0) {
    return <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">No critical notes or source footnotes for this edition.</p>;
  }

  return (
    <div className="flex flex-col gap-5 px-3 py-3">
      {edition.generatedNotes.length > 0 && (
        <section aria-label="AI-generated critical notes">
          <h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            AI-generated critical notes
          </h3>
          <p className="px-1 text-[0.68rem] text-[var(--color-text-muted)]">
            Generated research aids, not settled scholarship. A dashed in-text marker means the note was quote-matched on read, not DB-anchored.
          </p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {edition.generatedNotes.map((note) => (
              <CriticalNoteCard
                key={note.id}
                note={note}
                active={activeIsGeneratedNote && note.id === activeId}
                matched={matchNoteToBlock(note, edition.blocks) !== null}
                resourceById={resourceById}
              />
            ))}
          </ul>
        </section>
      )}

      {edition.authorialNotes.length > 0 && (
        <section aria-label="Author's notes">
          <h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Author&apos;s notes
          </h3>
          <p className="px-1 text-[0.68rem] text-[var(--color-text-muted)]">
            Source-text footnotes. These remain page/sidebar-only because no block-level anchor exists.
          </p>
          <ol className="mt-1.5 flex flex-col gap-1.5 text-sm">
            {edition.authorialNotes.map((note) => (
              <li key={note.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2">
                <sup className="font-semibold text-[var(--color-accent-umber)]">{note.marker}</sup>{" "}
                <span>{note.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function ApparatusTab({
  edition,
  kind,
  onKindChange,
}: {
  edition: EditionPayload;
  kind: EditionReaderFilters["apparatusKind"];
  onKindChange: (kind: EditionReaderFilters["apparatusKind"]) => void;
}) {
  const entries = kind === "all" ? edition.authorApparatus : edition.authorApparatus.filter((entry) => entry.kind === kind);
  return (
    <div className="px-3 py-3">
      <h2 className="mb-2 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Footnotes apparatus and source records</h2>
      <label className="flex items-center justify-between gap-2 text-xs"><span className="text-[var(--color-text-muted)]">Author apparatus</span><select value={kind} onChange={(event) => onKindChange(event.target.value as EditionReaderFilters["apparatusKind"])} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">All apparatus</option><option value="footnote">Footnotes</option><option value="endnote">Endnotes</option><option value="bibliography_entry">Bibliography</option><option value="citation_block">Citation blocks</option></select></label>
      {entries.length === 0 ? <p className="py-5 text-sm text-[var(--color-text-muted)]">No author apparatus matches this filter.</p> : <ol className="mt-3 flex flex-col gap-2 text-sm">{entries.map((entry) => <li key={entry.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2"><p className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{entry.kind.replace("_", " ")}{entry.marker ? ` · ${entry.marker}` : ""}{entry.textBlockId ? " · page/block anchored" : " · source-scoped"}</p><p className="mt-1 whitespace-pre-wrap">{entry.text}</p><p className="mt-1 text-[0.68rem] text-[var(--color-text-muted)]">Provenance: authorial source · extraction: {entry.scope && typeof entry.scope === "object" && "pageIndex" in entry.scope ? `page ${Number((entry.scope as { pageIndex: number }).pageIndex) + 1}` : "source record"}</p></li>)}</ol>}
    </div>
  );
}

function TermsTab({
  terms,
  onApproveTerm,
}: {
  terms: EditionPayload["terms"];
  onApproveTerm?: (termId: string) => void;
}) {
  if (terms.length === 0) return <p className="px-4 py-6 text-sm text-[var(--color-text-muted)]">No verified or suggested original-script terms were found.</p>;
  return <div className="flex flex-col gap-2 px-3 py-3">{terms.map((term) => <article key={term.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm"><p lang={term.language} dir={term.direction === "rtl" ? "rtl" : "ltr"} className="font-medium text-[var(--color-accent-ink)]">{term.originalScript}</p><p className="text-[var(--color-text-muted)]">{term.transliteration}</p><p className="mt-1 text-[0.7rem] text-[var(--color-text-muted)]">{term.verificationStatus === "verified" ? "Verified pair" : "Suggested pair — not shown in the text until approved."}</p><p className="mt-1 text-[0.68rem] text-[var(--color-text-muted)]">Source: {term.source} · confidence: {term.verificationStatus === "verified" ? "verified" : "pending verification"} · provenance: terminology extraction</p>{term.verificationStatus === "suggested" && onApproveTerm && <button type="button" onClick={() => onApproveTerm(term.id)} className="mt-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs">Approve pair</button>}</article>)}</div>;
}

function CriticalNoteCard({
  note,
  active,
  matched,
  resourceById,
}: {
  note: EditionGeneratedNote;
  active: boolean;
  matched: boolean;
  resourceById: Map<string, EditionResource>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement | null>(null);
  const src = note.evidence?.resourceId ? resourceById.get(note.evidence.resourceId) : null;
  const expanded = open || active;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <li
      ref={ref}
      className="rounded-lg border bg-[var(--color-background)] p-2.5 text-sm"
      style={{ borderColor: active ? "var(--color-credibility-warning)" : "var(--color-border)" }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[var(--color-credibility-warning)] text-[0.7rem] font-bold text-[var(--color-background)]"
        >
          ✣
        </span>
        <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[0.68rem] font-medium">{note.noteType.replace(/_/g, " ")}</span>
        {matched && <span className="text-[0.68rem] text-[var(--color-text-muted)]">quote-matched</span>}
        {src?.credibility?.authority && <AuthorityBadge authority={src.credibility.authority} />}
        <span className="ml-auto text-[0.68rem] text-[var(--color-text-muted)]">{Math.round(note.confidence * 100)}%</span>
      </div>
      <p className="mt-1.5 text-[0.82rem] leading-snug">{note.body}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded} className="mt-1 text-[0.72rem] underline">
        {expanded ? "Hide evidence" : "Evidence and claims"}
      </button>
      {expanded && (
        <div className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[0.78rem]">
          {note.evidence?.quote && (
            <p className="border-l-2 border-[var(--color-border)] pl-2 text-[0.72rem] italic text-[var(--color-text-muted)]">
              “{note.evidence.quote}”
            </p>
          )}
          {src && (
            <p className="mt-1.5 text-[0.72rem] text-[var(--color-text-muted)]">
              Source:{" "}
              {src.url ? (
                <a className="underline" href={src.url} target="_blank" rel="noreferrer">
                  {src.title}
                </a>
              ) : (
                src.title
              )}{" "}
              · {src.provider} · inspection depth {src.inspectionDepth}
            </p>
          )}
          <p className="mt-1.5 text-[0.72rem] text-[var(--color-text-muted)]">
            Source: {src?.title ?? "Document research run"} · confidence {Math.round(note.confidence * 100)}% · provenance: AI-generated, evidence-grounded
          </p>
          {note.claims.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {note.claims.map((claim) => <ClaimView key={claim.id} claim={claim} />)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function AnnotationsTab({
  edition,
  activeId,
  anchoredNotes,
  resourceById,
  onSelectAnnotation,
}: {
  edition: EditionPayload;
  activeId: string | null;
  anchoredNotes: EditionPassageAnnotation[];
  resourceById: Map<string, EditionResource>;
  onSelectAnnotation?: (id: string) => void;
}) {
  const allNotes = [...edition.wholeWorkGuidance, ...anchoredNotes];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = allNotes.find((note) => note.id === activeId) ?? allNotes.find((note) => note.id === selectedId) ?? allNotes[0];
  if (edition.wholeWorkGuidance.length === 0 && anchoredNotes.length === 0) {
    return <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">No passage annotations for this edition.</p>;
  }
  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <section aria-label="Annotation index">
        <h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Annotation index</h3>
        <p className="px-1 text-[0.68rem] text-[var(--color-text-muted)]">Choose an item for its evidence detail. Full notes remain beside their passage on desktop and inline on narrow screens.</p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {allNotes.map((note) => (
            (() => {
              const pageIndex = note.textBlockId ? edition.blocks.find((block) => block.id === note.textBlockId)?.pageIndex : null;
              return <li key={note.id}>
              <button
                type="button"
                onClick={() => { setSelectedId(note.id); onSelectAnnotation?.(note.id); }}
                className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-left text-xs"
                aria-current={selected?.id === note.id ? "true" : undefined}
              >
                <span className="font-medium">{note.isWholeWork ? "Whole work" : pageIndex === undefined || pageIndex === null ? "Anchored passage" : `Page ${pageIndex + 1}`}</span>
                {" · "}{note.summary}
              </button>
            </li>;
            })()
          ))}
        </ul>
      </section>
      {selected && <section aria-label="Annotation detail"><h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Detail</h3><ul className="mt-1.5"><PassageAnnotationCard note={selected} active resourceById={resourceById} /></ul></section>}
    </div>
  );
}

function PassageAnnotationCard({
  note,
  active,
  resourceById,
}: {
  note: EditionPassageAnnotation;
  active: boolean;
  resourceById: Map<string, EditionResource>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement | null>(null);
  const relatedResource = note.relatedResourceId ? resourceById.get(note.relatedResourceId) : undefined;
  const category = CATEGORY_META[note.relationship];
  // Derived, not effect-set state: becoming active always shows the
  // explanation (no separate setState needed), and the reader can still
  // manually collapse it afterward via `open`.
  const expanded = open || active;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  return (
    <li
      ref={ref}
      data-annotation-card={note.id}
      className="rounded-lg border bg-[var(--color-background)] p-2.5 text-sm"
      style={{ borderColor: active ? `var(${category.colorVar})` : "var(--color-border)" }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold text-[var(--color-background)]"
          style={{ background: `var(${category.colorVar})` }}
        >
          {category.glyph}
        </span>
        <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[0.68rem] font-medium">
          {PASSAGE_TYPE_LABEL[note.annotationType]}
        </span>
        {note.readerLevel && <span className="text-[0.68rem] text-[var(--color-text-muted)]">{READER_LEVEL_LABEL[note.readerLevel]}</span>}
        <span className="ml-auto text-[0.68rem] text-[var(--color-text-muted)]">{Math.round(note.confidence * 100)}%</span>
      </div>
      <p className="mt-1.5 text-[0.82rem] leading-snug">{note.summary}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded} className="mt-1 text-[0.72rem] underline">
        {expanded ? "Hide explanation" : "Read more"}
      </button>
      {expanded && (
        <div className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[0.78rem]">
          <p>{note.explanation}</p>
          {note.quote && (
            <p className="mt-1.5 border-l-2 border-[var(--color-border)] pl-2 text-[0.72rem] italic text-[var(--color-text-muted)]">
              “{note.quote}”
            </p>
          )}
          {relatedResource && (
            <p className="mt-1.5 text-[0.72rem] text-[var(--color-text-muted)]">
              Related source:{" "}
              {relatedResource.url ? (
                <a href={relatedResource.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {relatedResource.title}
                </a>
              ) : (
                relatedResource.title
              )}
            </p>
          )}
          <p className="mt-1.5 text-[0.72rem] text-[var(--color-text-muted)]">
            Source: {relatedResource?.title ?? (note.textBlockId ? "Anchored document passage" : "Whole work")} · confidence {Math.round(note.confidence * 100)}% · provenance: {note.createdBy === "system" ? "AI-generated, evidence-grounded" : note.createdBy}
          </p>
        </div>
      )}
    </li>
  );
}

function SourcesTab({ edition }: { edition: EditionPayload }) {
  if (edition.resources.length === 0) {
    return <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">No sources consulted for this edition.</p>;
  }
  return (
    <div className="px-3 py-3">
      <h2 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Sources consulted
      </h2>
      <p className="px-1 text-[0.68rem] text-[var(--color-text-muted)]">
        {edition.works.length} work{edition.works.length === 1 ? "" : "s"}
        {edition.resources.length !== edition.works.length ? `, ${edition.resources.length} records` : ""}
      </p>
      {/* One entry per WORK. A book, a review of it and its second edition
          are three real records but one work, and repeating the same book
          five times makes the list unusable. Related records stay visible,
          attached to the work rather than listed beside it. */}
      <ul className="mt-1.5 flex flex-col gap-2">
        {edition.works.map((work) => {
          const resource = work.primary;
          return (
            <li key={work.key} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-[0.8rem]">
              <div className="flex flex-wrap items-center gap-1.5">
                {resource.url ? (
                  <a className="underline" href={resource.url} target="_blank" rel="noreferrer">
                    {work.title}
                  </a>
                ) : (
                  work.title
                )}
              </div>
              <p className="mt-0.5 text-[0.7rem] text-[var(--color-text-muted)]">
                {resource.provider}
                {resource.year ? ` · ${resource.year}` : ""}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {resource.credibility?.authority && <AuthorityBadge authority={resource.credibility.authority} />}
                {resource.credibility?.score != null && <CredibilityMeter score={resource.credibility.score} />}
              </div>
              {resource.credibility?.agreement && (
                <p className="mt-1 text-[0.7rem] text-[var(--color-text-muted)]">{AGREEMENT_LABEL[resource.credibility.agreement]}</p>
              )}
              {work.related.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-2 text-[0.7rem] text-[var(--color-text-muted)]">
                  {work.related.map((rel) => (
                    <li key={rel.id} title={rel.evidence ?? undefined}>
                      <span className="capitalize">{rel.role}</span>:{" "}
                      {rel.url ? (
                        <a className="underline" href={rel.url} target="_blank" rel="noreferrer">
                          {rel.title}
                        </a>
                      ) : (
                        rel.title
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
