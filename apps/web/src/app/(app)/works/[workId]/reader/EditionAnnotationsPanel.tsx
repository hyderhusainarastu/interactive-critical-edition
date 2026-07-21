"use client";

import { useEffect, useRef, useState } from "react";
import { CredibilityMeter } from "@/components/CredibilityMeter";
import { CATEGORY_META } from "./annotationMeta";
import {
  AGREEMENT_LABEL,
  AuthorityBadge,
  PASSAGE_TYPE_LABEL,
  READER_LEVEL_LABEL,
  type EditionPassageAnnotation,
  type EditionPayload,
  type EditionResource,
} from "./EditionReader";

type Tab = "annotations" | "sources";

/**
 * The published-edition's sidebar (plan §36 11.5) — modeled directly on
 * `AnnotationsPanel.tsx`'s shell (same width/border/scroll behavior) so the
 * two readers share one visual language. Two tabs for now: "Annotations"
 * (passage annotations, both anchored and whole-work, ported off the old
 * unconditional below-paragraph list) and "Sources" (the "Sources
 * consulted" list, relocated here so a long document no longer needs
 * scrolling past the whole text to reach it). A "Notes" tab (critical
 * notes + authorial footnotes) arrives in 11.6.
 */
export function EditionAnnotationsPanel({
  edition,
  activeId,
}: {
  edition: EditionPayload;
  activeId: string | null;
}) {
  const [tab, setTab] = useState<Tab>("annotations");

  // Clicking an in-text marker always means "show me the annotation" — if
  // the reader is currently on the Sources tab, switch them to Annotations
  // so the newly-active card is actually visible to scroll to. A one-shot
  // sync from an external prop change (the click), not a derived value —
  // the reader must still be free to switch back to Sources afterward
  // without activeId (unchanged) snapping them back.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeId) setTab("annotations");
  }, [activeId]);

  const resourceById = new Map(edition.resources.map((r) => [r.id, r]));
  const anchoredNotes = edition.passageAnnotations.filter((a) => a.textBlockId !== null);
  const annotationCount = anchoredNotes.length + edition.wholeWorkGuidance.length;

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
          aria-pressed={tab === "sources"}
          onClick={() => setTab("sources")}
          className="rounded px-3 py-1.5"
          style={{ background: tab === "sources" ? "var(--color-background)" : "transparent" }}
        >
          Sources{edition.works.length > 0 ? ` (${edition.works.length})` : ""}
        </button>
      </div>

      {tab === "annotations" ? (
        <AnnotationsTab edition={edition} activeId={activeId} anchoredNotes={anchoredNotes} resourceById={resourceById} />
      ) : (
        <SourcesTab edition={edition} />
      )}
    </aside>
  );
}

function AnnotationsTab({
  edition,
  activeId,
  anchoredNotes,
  resourceById,
}: {
  edition: EditionPayload;
  activeId: string | null;
  anchoredNotes: EditionPassageAnnotation[];
  resourceById: Map<string, EditionResource>;
}) {
  if (edition.wholeWorkGuidance.length === 0 && anchoredNotes.length === 0) {
    return <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">No passage annotations for this edition.</p>;
  }
  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {edition.wholeWorkGuidance.length > 0 && (
        <section aria-label="Whole-work guidance">
          <h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Whole-work guidance
          </h3>
          <p className="px-1 text-[0.68rem] text-[var(--color-text-muted)]">
            True of this work as a whole — no single passage captures it, so it carries no page/block anchor.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {edition.wholeWorkGuidance.map((note) => (
              <PassageAnnotationCard key={note.id} note={note} active={note.id === activeId} resourceById={resourceById} />
            ))}
          </ul>
        </section>
      )}
      {anchoredNotes.length > 0 && (
        <section>
          {edition.wholeWorkGuidance.length > 0 && (
            <h3 className="px-1 text-[0.72rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              In the text
            </h3>
          )}
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {anchoredNotes.map((note) => (
              <PassageAnnotationCard key={note.id} note={note} active={note.id === activeId} resourceById={resourceById} />
            ))}
          </ul>
        </section>
      )}
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
