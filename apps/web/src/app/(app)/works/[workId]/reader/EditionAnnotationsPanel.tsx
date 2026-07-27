"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReaderLevelFilter } from "@ice/roadmap";
import { CredibilityMeter } from "@/components/CredibilityMeter";
import { rolesHaveReaderLevelSignal } from "@/lib/librarySearch";
import { CategoryGlyph, EvidenceLine } from "@/components/shared/annotationPrimitives";
import { CATEGORY_META, VERIFICATION_LABELS } from "./annotationMeta";
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
import { ClaimsTab } from "./ClaimsTab";
import { ReaderSidebarFrame } from "./ReaderSidebarFrame";
import { readerScrollBehavior } from "./readerMotion";
import type { ResearchClaimSummary } from "./researchClaims";
import type { RelationshipCategory, VerificationStatus } from "./types";

type Tab = "annotations" | "notes" | "apparatus" | "terms" | "sources" | "claims";

/**
 * Passage annotations carry a reader-correction state (D-22-1) at parity with
 * the legacy `annotation` table. The base `EditionPassageAnnotation` type
 * (defined in the wave-4-owned `EditionReader.tsx`) predates these columns;
 * the server payload (`lib/edition.ts`) always populates them, so the sidebar
 * reads them through this narrow augmentation rather than editing that type.
 */
type ReviewablePassage = EditionPassageAnnotation & {
  verificationStatus: VerificationStatus;
  hidden: boolean;
};
type EditionWithReview = EditionPayload & { hiddenPassageAnnotations?: EditionPassageAnnotation[] };
type PassageOverride = Partial<Pick<ReviewablePassage, "verificationStatus" | "hidden" | "explanation" | "createdBy">>;
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
 * scrolling past the whole text to reach it). "Critical notes" (plan §36 11.6)
 * keeps generated critical notes and source footnotes in the same side rail,
 * with generated-note markers only when quote matching is unambiguous.
 */
export function EditionAnnotationsPanel({
  edition,
  activeId,
  readerLevel,
  enableLevelFilter,
  levelFilteredEmpty = false,
  enablePhase12Reader = false,
  filters,
  onReaderLevelChange,
  onFiltersChange,
  onPreviousAnnotation,
  onNextAnnotation,
  onApproveTerm,
  onSelectAnnotation,
  onClose,
  flushTop = false,
  claims = [],
  enableReaderClaimLayer = false,
  enableEvidenceChips = false,
  onLocatePassage,
}: {
  edition: EditionWithReview;
  activeId: string | null;
  readerLevel: ReaderLevelFilter;
  enableLevelFilter: boolean;
  /** True when a level filter is active and produced zero annotations that
   *  would otherwise exist at another level (owner directive 2026-07-26:
   *  exact-band level filtering, not a cumulative union, so a level with
   *  little or no annotations tagged specifically for it can plausibly come
   *  up empty even though the edition has annotations overall). Drives the
   *  "Annotations" tab's empty-state message in `AnnotationsTab` below. */
  levelFilteredEmpty?: boolean;
  enablePhase12Reader?: boolean;
  filters: EditionReaderFilters;
  onReaderLevelChange: (level: ReaderLevelFilter) => void;
  onFiltersChange: (filters: EditionReaderFilters) => void;
  onPreviousAnnotation?: () => void;
  onNextAnnotation?: () => void;
  onApproveTerm?: (termId: string) => void;
  onSelectAnnotation?: (id: string) => void;
  /** Present only so this panel can be shown as a narrow-viewport dialog
   *  (`ReaderSidebarFrame`) — at wide widths it stays an always-open sticky
   *  rail and this is unused. */
  onClose: () => void;
  /** True when the reader's distraction-reduced focus mode hides the app
   *  header — see `ReaderSidebarFrame`'s own doc comment. */
  flushTop?: boolean;
  /** Phase 28.3, behind `readerClaimLayer`: `research_claim` rows for this
   *  work, fetched separately from `edition` (a different table/route). */
  claims?: ResearchClaimSummary[];
  enableReaderClaimLayer?: boolean;
  /** Phase 29.3 reverse-direction lane, `phase25FeatureEnabled("research")`
   *  (no new flag): shows render-time evidence-strength/textual-support
   *  chips on the generated critical-note cards' nested `generated_claim`
   *  content — see `ClaimView`'s own doc comment. Independent of
   *  `enableReaderClaimLayer` (the Claims tab): this is the "Critical
   *  notes" tab, ships even when the Research workspace itself is off, as
   *  long as `research` is on. */
  enableEvidenceChips?: boolean;
  /** Scrolls the main reader pane to a text block — the "Locate passage"
   *  card affordance, reusing the same `activeReaderBlockId` mechanism the
   *  outline rail and bookmark selection already use. */
  onLocatePassage?: (textBlockId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("annotations");
  const resourceById = new Map(edition.resources.map((r) => [r.id, r]));
  const anchoredNotes = edition.passageAnnotations.filter((a) => a.textBlockId !== null);
  const annotationCount = anchoredNotes.length + edition.wholeWorkGuidance.length;
  const notesCount = edition.generatedNotes.length + edition.authorialNotes.length;
  const apparatusCount = edition.authorApparatus.length;
  const suggestedTerms = edition.terms.filter((term) => term.verificationStatus === "suggested");
  const activeIsGeneratedNote = activeId ? edition.generatedNotes.some((note) => note.id === activeId) : false;
  const activeIsClaim = activeId ? claims.some((claim) => claim.id === activeId) : false;
  const annotationTypes = useMemo(() => [...new Set(edition.passageAnnotations.map((annotation) => annotation.annotationType))], [edition.passageAnnotations]);
  const relationships = useMemo(() => [...new Set(edition.passageAnnotations.map((annotation) => annotation.relationship))], [edition.passageAnnotations]);
  // Twin of the Library's `hasReaderLevelSignal`/Curriculum's
  // `rolesHaveReaderLevelSignal` use (D-23-12/D-23-8): only offer the reader-
  // level filter when at least one annotation actually carries a real
  // (non-null) level — otherwise every option would return the identical
  // set, which is a lie by omission, not a working control.
  const readerLevelSignal = useMemo(
    () => rolesHaveReaderLevelSignal([...edition.passageAnnotations, ...edition.wholeWorkGuidance]),
    [edition.passageAnnotations, edition.wholeWorkGuidance],
  );

  // Clicking an in-text marker always means "show me the annotation" — if
  // the reader is currently on another tab, switch to the tab that owns the
  // active id so the newly-active card is actually visible to scroll to. A
  // one-shot sync from an external prop change (the click), not a derived
  // value — the reader must still be free to switch tabs afterward without
  // activeId (unchanged) snapping them back.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeId) setTab(activeIsClaim ? "claims" : activeIsGeneratedNote ? "notes" : "annotations");
  }, [activeId, activeIsClaim, activeIsGeneratedNote]);

  // D-22-xx: no `.app-reveal` here, same reasoning as `NotesSidebar.tsx` —
  // this is a fixed reader-shell panel, always in the initial viewport at
  // mount, not below-the-fold content a reader scrolls to. Confirmed via
  // the same axe probe: this panel's own tab buttons/tab strip
  // (`--color-text-muted`/`--color-text` on `--color-surface`, both
  // comfortably >8:1 at rest) intermittently failed contrast only while
  // the now-removed one-shot opacity fade was still in flight.
  return (
    <ReaderSidebarFrame label="Edition sidebar" widthClassName="w-80" onClose={onClose} flushTop={flushTop}>
    <aside aria-label="Edition sidebar" className="border-s border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* D-23-51 polish: the five tabs don't reliably fit a 320–360px rail
          (pre-existing — this sidebar was already `w-80` on desktop before
          this task's layout change); `overflow-x-auto` lets the strip
          scroll horizontally instead of silently clipping "Sources" off the
          visible edge, at any width from 320px up.
          Landing-paradigm underline convention (matching the reader-view
          toggle and the depiction's own tab strips) replaces the previous
          background-fill "pill" look — same buttons, aria-pressed states,
          and click handlers, purely a border-bottom-2 accent swap. */}
      <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-[0.78rem] [&>button]:shrink-0">
        <button
          type="button"
          aria-pressed={tab === "annotations"}
          onClick={() => setTab("annotations")}
          className="app-control border-b-2 px-2.5 py-2 font-medium"
          style={{
            borderColor: tab === "annotations" ? "var(--color-accent-ink)" : "transparent",
            color: tab === "annotations" ? "var(--color-text)" : "var(--color-text-muted)",
          }}
        >
          Annotations{annotationCount > 0 ? ` (${annotationCount})` : ""}
        </button>
        <button
          type="button"
          aria-pressed={tab === "notes"}
          onClick={() => setTab("notes")}
          className="app-control border-b-2 px-2.5 py-2 font-medium"
          style={{
            borderColor: tab === "notes" ? "var(--color-accent-ink)" : "transparent",
            color: tab === "notes" ? "var(--color-text)" : "var(--color-text-muted)",
          }}
        >
          Critical notes{notesCount > 0 ? ` (${notesCount})` : ""}
        </button>
        {enablePhase12Reader && <button type="button" aria-pressed={tab === "apparatus"} onClick={() => setTab("apparatus")} className="app-control border-b-2 px-2.5 py-2 font-medium" style={{ borderColor: tab === "apparatus" ? "var(--color-accent-ink)" : "transparent", color: tab === "apparatus" ? "var(--color-text)" : "var(--color-text-muted)" }}>Apparatus{apparatusCount > 0 ? ` (${apparatusCount})` : ""}</button>}
        {enablePhase12Reader && <button type="button" aria-pressed={tab === "terms"} onClick={() => setTab("terms")} className="app-control border-b-2 px-2.5 py-2 font-medium" style={{ borderColor: tab === "terms" ? "var(--color-accent-ink)" : "transparent", color: tab === "terms" ? "var(--color-text)" : "var(--color-text-muted)" }}>Terms{suggestedTerms.length > 0 ? ` (${suggestedTerms.length})` : ""}</button>}
        {enableReaderClaimLayer && <button type="button" aria-pressed={tab === "claims"} onClick={() => setTab("claims")} className="app-control border-b-2 px-2.5 py-2 font-medium" style={{ borderColor: tab === "claims" ? "var(--color-accent-ink)" : "transparent", color: tab === "claims" ? "var(--color-text)" : "var(--color-text-muted)" }}>Claims{claims.length > 0 ? ` (${claims.length})` : ""}</button>}
        <button
          type="button"
          aria-pressed={tab === "sources"}
          onClick={() => setTab("sources")}
          className="app-control border-b-2 px-2.5 py-2 font-medium"
          style={{
            borderColor: tab === "sources" ? "var(--color-accent-ink)" : "transparent",
            color: tab === "sources" ? "var(--color-text)" : "var(--color-text-muted)",
          }}
        >
          Sources{edition.works.length > 0 ? ` (${edition.works.length})` : ""}
        </button>
      </div>

      {enableLevelFilter && tab === "annotations" && (
        <div className="grid grid-cols-1 gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs">
          {readerLevelSignal ? (
            <label className="flex items-center justify-between gap-2">
              <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Reader level</span>
              <select
                value={readerLevel}
                onChange={(event) => onReaderLevelChange(event.target.value as ReaderLevelFilter)}
                className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"
              >
                {READER_LEVEL_FILTER_OPTIONS.map((level) => <option key={level} value={level}>{READER_LEVEL_FILTER_LABEL[level]}</option>)}
              </select>
            </label>
          ) : (
            // Twin of the Library's D-23-12/`hasReaderLevelSignal` and
            // Curriculum's D-23-8/`rolesHaveReaderLevelSignal`: no annotation
            // in this edition carries a level-specific tag, so every filter
            // option would return the identical set — say so instead of a
            // select that visibly does nothing.
            <div className="flex flex-col gap-1">
              <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Reader level</span>
              <p
                role="note"
                aria-label="Reader level filtering is not available"
                className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1 text-[0.7rem] text-[var(--color-text-muted)]"
              >
                Not available yet — every annotation here currently applies at every level.
              </p>
            </div>
          )}
          {enablePhase12Reader && (
            <>
              <label className="flex items-center justify-between gap-2"><span className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Annotation type</span><select value={filters.annotationType} onChange={(event) => onFiltersChange({ ...filters, annotationType: event.target.value as EditionReaderFilters["annotationType"] })} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">All types</option>{annotationTypes.map((type) => <option key={type} value={type}>{PASSAGE_TYPE_LABEL[type]}</option>)}</select></label>
              <label className="flex items-center justify-between gap-2"><span className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Relationship</span><select value={filters.relationship} onChange={(event) => onFiltersChange({ ...filters, relationship: event.target.value as EditionReaderFilters["relationship"] })} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">All relationships</option>{relationships.map((relationship) => <option key={relationship} value={relationship}>{CATEGORY_META[relationship].label}</option>)}</select></label>
              <label className="flex items-center justify-between gap-2"><span className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Annotation source</span><select value={filters.provenance} onChange={(event) => onFiltersChange({ ...filters, provenance: event.target.value as EditionReaderFilters["provenance"] })} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">All annotations</option><option value="ai">Automated annotations</option><option value="user">User annotations</option></select></label>
              <div className="flex justify-end gap-2"><button type="button" onClick={onPreviousAnnotation} disabled={!onPreviousAnnotation} className="app-control underline disabled:opacity-40">Previous</button><button type="button" onClick={onNextAnnotation} disabled={!onNextAnnotation} className="app-control underline disabled:opacity-40">Next</button></div>
            </>
          )}
        </div>
      )}

      <div key={tab} className="reader-panel-tab-content">
        {tab === "annotations" ? (
          <AnnotationsTab
            edition={edition}
            activeId={activeId}
            anchoredNotes={anchoredNotes}
            resourceById={resourceById}
            onSelectAnnotation={onSelectAnnotation}
            levelFilteredEmpty={levelFilteredEmpty}
            activeLevelLabel={READER_LEVEL_FILTER_LABEL[readerLevel]}
          />
        ) : tab === "notes" ? (
          <NotesTab edition={edition} activeId={activeId} resourceById={resourceById} activeIsGeneratedNote={activeIsGeneratedNote} enableEvidenceChips={enableEvidenceChips} />
        ) : tab === "apparatus" ? (
          <ApparatusTab edition={edition} kind={filters.apparatusKind} onKindChange={(apparatusKind) => onFiltersChange({ ...filters, apparatusKind })} />
        ) : tab === "terms" ? (
          <TermsTab terms={edition.terms} onApproveTerm={onApproveTerm} />
        ) : tab === "claims" ? (
          <ClaimsTab claims={claims} blocks={edition.blocks} activeId={activeId} onSelectClaim={onSelectAnnotation} onLocatePassage={onLocatePassage} />
        ) : (
          <SourcesTab edition={edition} />
        )}
      </div>
    </aside>
    </ReaderSidebarFrame>
  );
}

function NotesTab({
  edition,
  activeId,
  resourceById,
  activeIsGeneratedNote,
  enableEvidenceChips,
}: {
  edition: EditionPayload;
  activeId: string | null;
  resourceById: Map<string, EditionResource>;
  activeIsGeneratedNote: boolean;
  enableEvidenceChips: boolean;
}) {
  if (edition.generatedNotes.length === 0 && edition.authorialNotes.length === 0) {
    return <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">No critical notes or source footnotes for this edition.</p>;
  }

  return (
    <div className="flex flex-col gap-5 px-3 py-3">
      {edition.generatedNotes.length > 0 && (
        <section aria-label="Generated critical notes">
          <h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Generated critical notes
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
                enableEvidenceChips={enableEvidenceChips}
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
          {/* Landing-paradigm authorial-note treatment: a hairline-divided
              list (top rule between entries) rather than a boxed card per
              note, matching the depiction's `.authorial-note` (border-top,
              muted body, umber-accented marker) — same content, no DOM
              change beyond the wrapping element's own className. */}
          <ol className="mt-1.5 flex flex-col divide-y divide-[var(--color-border)] text-sm">
            {edition.authorialNotes.map((note) => (
              <li key={note.id} className="px-1 py-2.5 text-[0.85rem] leading-snug text-[var(--color-text-muted)]">
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
      <label className="flex items-center justify-between gap-2 text-xs"><span className="text-[var(--color-text-muted)]">Author apparatus</span><select value={kind} onChange={(event) => onKindChange(event.target.value as EditionReaderFilters["apparatusKind"])} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"><option value="all">All apparatus</option><option value="footnote">Footnotes</option><option value="endnote">Endnotes</option><option value="bibliography_entry">Bibliography</option><option value="citation_block">Citation blocks</option></select></label>
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
  return <div className="flex flex-col gap-2 px-3 py-3">{terms.map((term) => <article key={term.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm"><p lang={term.language} dir={term.direction === "rtl" ? "rtl" : "ltr"} className="font-medium text-[var(--color-accent-ink)]">{term.originalScript}</p><p className="text-[var(--color-text-muted)]">{term.transliteration}</p><p className="mt-1 text-[0.7rem] text-[var(--color-text-muted)]">{term.verificationStatus === "verified" ? "Verified pair" : "Suggested pair — not shown in the text until approved."}</p><p className="mt-1 text-[0.68rem] text-[var(--color-text-muted)]">Source: {term.source} · confidence: {term.verificationStatus === "verified" ? "verified" : "pending verification"} · provenance: terminology extraction</p>{term.verificationStatus === "suggested" && onApproveTerm && <button type="button" onClick={() => onApproveTerm(term.id)} className="app-control mt-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs">Approve pair</button>}</article>)}</div>;
}

function CriticalNoteCard({
  note,
  active,
  matched,
  resourceById,
  enableEvidenceChips,
}: {
  note: EditionGeneratedNote;
  active: boolean;
  matched: boolean;
  resourceById: Map<string, EditionResource>;
  enableEvidenceChips: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement | null>(null);
  const src = note.evidence?.resourceId ? resourceById.get(note.evidence.resourceId) : null;
  const expanded = open || active;

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "center", behavior: readerScrollBehavior() });
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
        <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">{note.noteType.replace(/_/g, " ")}</span>
        {matched && <span className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-muted)]">quote-matched</span>}
        {src?.credibility?.authority && <AuthorityBadge authority={src.credibility.authority} />}
        <span className="ml-auto text-[0.68rem] text-[var(--color-text-muted)]">{Math.round(note.confidence * 100)}%</span>
      </div>
      <p className="mt-1.5 text-[0.82rem] leading-snug">{note.body}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded} className="app-control mt-1 text-[0.72rem] underline">
        {expanded ? "Hide evidence" : "Evidence and claims"}
      </button>
      {expanded && (
        <div className="app-panel-enter mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[0.78rem]">
          {note.evidence?.quote && (
            <p className="border-l-2 border-[var(--color-border)] pl-2 text-[0.72rem] italic text-[var(--color-text-muted)]">
              “{note.evidence.quote}”
            </p>
          )}
          {/* Progressive-disclosure trim (D-22-10): this used to be two
              consecutive "Source: …" lines — one with the link/provider/
              inspection-depth, a second, unconditional one repeating the
              title with confidence/provenance — duplicating the same fact
              twice in a row. Folded into the one shared `EvidenceLine`
              primitive `PassageAnnotationCard` (this same file) already uses,
              carrying every original fact (link, provider, inspection depth,
              confidence, provenance) in a single line instead of two. */}
          <EvidenceLine
            className="mt-1.5 text-[0.72rem]"
            source={src ? (src.url ? <a className="underline" href={src.url} target="_blank" rel="noreferrer">{src.title}</a> : src.title) : "Document research run"}
            confidencePercent={Math.round(note.confidence * 100)}
            provenance={src ? `System-generated, evidence-grounded · ${src.provider} · inspection depth ${src.inspectionDepth}` : "System-generated, evidence-grounded"}
          />
          {note.claims.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {note.claims.map((claim) => <ClaimView key={claim.id} claim={claim} enableEvidenceChips={enableEvidenceChips} />)}
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
  levelFilteredEmpty = false,
  activeLevelLabel,
}: {
  edition: EditionWithReview;
  activeId: string | null;
  anchoredNotes: EditionPassageAnnotation[];
  resourceById: Map<string, EditionResource>;
  onSelectAnnotation?: (id: string) => void;
  levelFilteredEmpty?: boolean;
  activeLevelLabel?: string;
}) {
  const params = useParams();
  const workId = String((params as Record<string, unknown>)?.workId ?? "");
  const [overrides, setOverrides] = useState<Record<string, PassageOverride>>({});
  const [showHidden, setShowHidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Server payload keeps hidden annotations out of the anchored/whole-work
  // arrays (so their in-text markers disappear) and surfaces them separately;
  // the sidebar recombines all three for its own review index.
  const basePassages = useMemo<ReviewablePassage[]>(
    () => [
      ...(edition.wholeWorkGuidance as ReviewablePassage[]),
      ...(anchoredNotes as ReviewablePassage[]),
      ...((edition.hiddenPassageAnnotations ?? []) as ReviewablePassage[]),
    ],
    [edition.wholeWorkGuidance, edition.hiddenPassageAnnotations, anchoredNotes],
  );

  // Optimistic local overrides layered on the server rows so a correction is
  // reflected immediately; persistence and reload come from the PATCH below.
  const allNotes = useMemo(
    () => basePassages.map((note): ReviewablePassage => ({ ...note, ...overrides[note.id] })),
    [basePassages, overrides],
  );
  const hiddenCount = allNotes.filter((note) => note.hidden).length;
  const visibleNotes = allNotes.filter((note) => showHidden || !note.hidden);
  const selected =
    visibleNotes.find((note) => note.id === activeId) ??
    visibleNotes.find((note) => note.id === selectedId) ??
    visibleNotes[0];

  async function onMutate(id: string, patch: PassageOverride) {
    const previous = overrides[id];
    setOverrides((current) => ({
      ...current,
      [id]: { ...current[id], ...patch, ...(patch.explanation ? { createdBy: "user" as const } : {}) },
    }));
    try {
      const res = await fetch(`/api/works/${workId}/reader/passage-annotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
    } catch {
      // Roll the optimistic change back so the card never shows a state the
      // server rejected.
      setOverrides((current) => ({ ...current, [id]: previous ?? {} }));
    }
  }

  if (basePassages.length === 0) {
    if (levelFilteredEmpty) {
      // A plausible consequence of exact-band level filtering (owner
      // directive 2026-07-26): this edition has annotations, but none are
      // tagged for the currently selected level — say so explicitly rather
      // than reading as "this edition has no annotations at all".
      return (
        <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">
          No annotations are tagged for the {activeLevelLabel ?? "selected"} level. Try &ldquo;Show all levels&rdquo; above to see everything.
        </p>
      );
    }
    return <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">No passage annotations for this edition.</p>;
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <section aria-label="Annotation index">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Annotation index</h3>
          {hiddenCount > 0 && (
            <button type="button" className="app-control text-[0.68rem] underline" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? "Hide dismissed" : `Show dismissed (${hiddenCount})`}
            </button>
          )}
        </div>
        <p className="px-1 text-[0.68rem] text-[var(--color-text-muted)]">Choose an item for its evidence detail. Full notes remain beside their passage on desktop and inline on narrow screens.</p>
        {visibleNotes.length === 0 ? (
          <p className="px-1 py-3 text-[0.72rem] text-[var(--color-text-muted)]">All annotations are dismissed. Use “Show dismissed” to review them.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1">
            {visibleNotes.map((note) => {
              const pageIndex = note.textBlockId ? edition.blocks.find((block) => block.id === note.textBlockId)?.pageIndex : null;
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => { setSelectedId(note.id); onSelectAnnotation?.(note.id); }}
                    className="app-control w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-left text-xs"
                    aria-current={selected?.id === note.id ? "true" : undefined}
                    style={{ opacity: note.verificationStatus === "rejected" ? 0.6 : 1 }}
                  >
                    <span className="font-medium">{note.isWholeWork ? "Whole work" : pageIndex === undefined || pageIndex === null ? "Anchored passage" : `Page ${pageIndex + 1}`}</span>
                    {note.hidden ? " · Dismissed" : note.verificationStatus !== "unreviewed" ? ` · ${VERIFICATION_LABELS[note.verificationStatus]}` : ""}
                    {" · "}{note.summary}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {selected && <section aria-label="Annotation detail"><h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Detail</h3><ul className="mt-1.5"><PassageAnnotationCard note={selected} active activationId={activeId} resourceById={resourceById} onMutate={onMutate} /></ul></section>}
    </div>
  );
}

function PassageStatusButton({
  current,
  value,
  label,
  onSet,
}: {
  current: VerificationStatus;
  value: VerificationStatus;
  label: string;
  onSet: (v: VerificationStatus) => void;
}) {
  const isActive = current === value;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      className="app-control underline"
      style={{ fontWeight: isActive ? 700 : 400 }}
      // Toggling an active status back to unreviewed lets a misclick be undone.
      onClick={() => onSet(isActive ? "unreviewed" : value)}
    >
      {label}
    </button>
  );
}

function PassageAnnotationCard({
  note,
  active,
  activationId,
  resourceById,
  onMutate,
}: {
  note: ReviewablePassage;
  active: boolean;
  /** The reader-shell `activeId` — non-null ONLY after a real user selection
   *  (marker click, index click, Prev/Next), never on initial page load.
   *  Gates the scroll-into-view below so it cannot fire at mount (D-23-17),
   *  where it scrolled the filter row above the fold in narrow drawers.
   *  Deliberately separate from `active`, which the one caller hardcodes
   *  `true` to keep the detail card always expanded/bordered. */
  activationId: string | null;
  resourceById: Map<string, EditionResource>;
  onMutate?: (id: string, patch: PassageOverride) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.explanation);
  const ref = useRef<HTMLLIElement | null>(null);
  const relatedResource = note.relatedResourceId ? resourceById.get(note.relatedResourceId) : undefined;
  const category = CATEGORY_META[note.relationship];
  // Derived, not effect-set state: becoming active always shows the
  // explanation (no separate setState needed), and the reader can still
  // manually collapse it afterward via `open`.
  const expanded = open || active;
  const rejected = note.verificationStatus === "rejected";

  // Scroll only on a user-driven activation (`activationId` matching this
  // card), never on the always-`active` mount — see the prop doc above.
  // `note.id` is a dep so switching between two annotations while one is
  // already activated still re-scrolls to the newly selected card.
  useEffect(() => {
    if (active && activationId === note.id) ref.current?.scrollIntoView({ block: "center", behavior: readerScrollBehavior() });
  }, [active, activationId, note.id]);
  // Keep the edit draft in step with the server value when it changes under us.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing) setDraft(note.explanation);
  }, [note.explanation, editing]);

  return (
    <li
      ref={ref}
      data-annotation-card={note.id}
      className="rounded-lg border bg-[var(--color-background)] p-2.5 text-sm"
      style={{ borderColor: active ? `var(${category.colorVar})` : "var(--color-border)", opacity: rejected ? 0.6 : 1 }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <CategoryGlyph colorVar={category.colorVar} glyph={category.glyph} className="shrink-0" />
        <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
          {PASSAGE_TYPE_LABEL[note.annotationType]}
        </span>
        {note.readerLevel && <span className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-muted)]">{READER_LEVEL_LABEL[note.readerLevel]}</span>}
        {note.verificationStatus !== "unreviewed" && (
          <span
            className="rounded border px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide"
            style={{ borderColor: `var(${category.colorVar})` }}
            data-review-status={note.verificationStatus}
          >
            {VERIFICATION_LABELS[note.verificationStatus]}
          </span>
        )}
        <span className="ml-auto text-[0.68rem] text-[var(--color-text-muted)]">{Math.round(note.confidence * 100)}%</span>
      </div>
      <p className="mt-1.5 text-[0.82rem] leading-snug">{note.summary}</p>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded} className="app-control mt-1 text-[0.72rem] underline">
        {expanded ? "Hide explanation" : "Read more"}
      </button>
      {expanded && (
        // No `.app-panel-enter` here (D-22-xx): this component's one caller
        // (`AnnotationsTab`'s "Detail" section) always passes `active` as a
        // hardcoded literal `true`, so `expanded` is permanently true from
        // this card's very first render, not a state a click transitions
        // into — the `open` toggle above never has anything to flip. Since
        // it is therefore always already-expanded at initial mount (never
        // "freshly created at open time" the way `.app-panel-enter`'s own
        // doc comment assumes for modals/drawers/popovers), the entrance
        // fade replayed on every reader page load and was the third
        // instance of the same transient-contrast pattern fixed above.
        <div className="mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[0.78rem]">
          {editing ? (
            <div>
              <textarea
                aria-label="Edit explanation"
                className="app-control w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-[0.78rem]"
                rows={4}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="mt-1 flex gap-3 text-[0.72rem]">
                <button
                  type="button"
                  className="app-control underline"
                  onClick={() => {
                    const next = draft.trim();
                    if (next && next !== note.explanation) onMutate?.(note.id, { explanation: next });
                    setEditing(false);
                  }}
                >
                  Save
                </button>
                <button type="button" className="app-control underline" onClick={() => { setDraft(note.explanation); setEditing(false); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p>{note.explanation}</p>
          )}
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
          <EvidenceLine
            className="mt-1.5 text-[0.72rem]"
            source={relatedResource?.title ?? (note.textBlockId ? "Anchored document passage" : "Whole work")}
            confidencePercent={Math.round(note.confidence * 100)}
            provenance={note.createdBy === "user" ? "Edited by you" : note.createdBy === "editor" ? "Editor" : "Evidence-grounded, corroborated against sources"}
          />
          {onMutate && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-2 text-[0.72rem]">
              <PassageStatusButton current={note.verificationStatus} value="user_verified" label="Verify" onSet={(v) => onMutate(note.id, { verificationStatus: v })} />
              <PassageStatusButton current={note.verificationStatus} value="disputed" label="Dispute" onSet={(v) => onMutate(note.id, { verificationStatus: v })} />
              <PassageStatusButton current={note.verificationStatus} value="rejected" label="Reject" onSet={(v) => onMutate(note.id, { verificationStatus: v })} />
              <button type="button" className="app-control underline" onClick={() => setEditing((v) => !v)}>
                {editing ? "Editing…" : "Edit"}
              </button>
              <button type="button" className="app-control ml-auto underline" onClick={() => onMutate(note.id, { hidden: !note.hidden })}>
                {note.hidden ? "Unhide" : "Hide"}
              </button>
            </div>
          )}
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
