"use client";

import { useMemo, useState } from "react";

export interface EditionPayload {
  run: { version: number; structureState: "full" | "limited"; note: string | null };
  pages: Array<{ id: string; pageIndex: number; text: string | null; isOcr: boolean; extractionConfidence: number | null }>;
  blocks: Array<{ id: string; pageId: string; blockOrder: number; kind: string; text: string }>;
  authorialNotes: Array<{ id: string; marker: string; text: string; pageAnchor: unknown }>;
  generatedNotes: Array<{ id: string; body: string; noteType: string; confidence: number }>;
  resources: Array<{ id: string; title: string; url: string | null; provider: string; inspectionDepth: number; credibility: number | null }>;
}

/** Published-run reader: authorial notes and generated editorial material are
 * visibly distinct, while the original PDF remains available through the
 * legacy PDF reader for visual rendering and selection. */
export function EditionReader({ edition }: { edition: EditionPayload }) {
  const [pageIndex, setPageIndex] = useState(0);
  const page = edition.pages[pageIndex];
  const pageBlocks = useMemo(
    () => edition.blocks.filter((block) => block.pageId === page?.id).sort((a, b) => a.blockOrder - b.blockOrder),
    [edition.blocks, page?.id],
  );
  if (!page) return <p className="text-[var(--color-text-muted)]">This published edition contains no readable pages.</p>;

  return (
    <section aria-label="Published critical edition" className="mx-auto max-w-[72ch]">
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
        <strong>Edition run v{edition.run.version}</strong>
        <span>{edition.run.structureState === "full" ? "Structured extraction" : "Structure-limited fallback"}</span>
        <span className="ml-auto">Page {page.pageIndex + 1} of {edition.pages.length}</span>
        <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)} className="disabled:opacity-40">← Prev</button>
        <button type="button" disabled={pageIndex >= edition.pages.length - 1} onClick={() => setPageIndex((index) => index + 1)} className="disabled:opacity-40">Next →</button>
      </div>
      {edition.run.note && <p className="mb-5 rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">{edition.run.note}</p>}
      <article className="flex flex-col gap-4 leading-[1.7] text-[var(--color-text)]">
        {(pageBlocks.length ? pageBlocks : [{ id: "fallback", kind: "body", text: page.text ?? "" }]).map((block) => {
          if (block.kind === "title") return <h1 key={block.id} className="font-serif text-3xl font-semibold">{block.text}</h1>;
          if (block.kind === "header") return <h2 key={block.id} className="mt-4 font-serif text-xl font-semibold">{block.text}</h2>;
          if (block.kind === "footnote") return <aside key={block.id} className="border-l-2 border-[var(--color-accent-ink)] pl-3 text-sm">{block.text}</aside>;
          return <p key={block.id} className="whitespace-pre-wrap">{block.text}</p>;
        })}
      </article>
      {edition.authorialNotes.length > 0 && (
        <section className="mt-8 border-t border-[var(--color-border)] pt-4">
          <h2 className="font-semibold">Authorial notes</h2>
          <ol className="mt-2 flex flex-col gap-2 text-sm">
            {edition.authorialNotes.map((note) => <li key={note.id}><sup>{note.marker}</sup> {note.text}</li>)}
          </ol>
        </section>
      )}
      {edition.generatedNotes.length > 0 && (
        <section className="mt-8 rounded-md border border-[var(--color-accent-green)] bg-[var(--color-surface)] p-4">
          <h2 className="font-semibold">Generated editorial notes</h2>
          <ul className="mt-2 flex flex-col gap-3 text-sm">
            {edition.generatedNotes.map((note) => <li key={note.id}><span className="text-[var(--color-text-muted)]">{note.noteType} · {Math.round(note.confidence * 100)}% confidence</span><br />{note.body}</li>)}
          </ul>
        </section>
      )}
      {edition.resources.length > 0 && (
        <section className="mt-8 border-t border-[var(--color-border)] pt-4">
          <h2 className="font-semibold">Research coverage</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {edition.resources.map((resource) => <li key={resource.id}>{resource.url ? <a className="underline" href={resource.url} target="_blank" rel="noreferrer">{resource.title}</a> : resource.title} <span className="text-[var(--color-text-muted)]">· {resource.provider} · inspection {resource.inspectionDepth}{resource.credibility !== null ? ` · credibility ${Math.round(resource.credibility * 100)}%` : ""}</span></li>)}
          </ul>
        </section>
      )}
    </section>
  );
}
