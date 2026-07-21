"use client";

import { useEffect, useState } from "react";
import { TextReader } from "./TextReader";
import type { AnnotationRecord, FootnoteRecord, HighlightRecord } from "./types";

/** Render the immutable uploaded TXT/Markdown bytes, not the worker's
 * processed transcript. The signed URL is scoped to the owning reader and
 * makes source availability explicit without copying the source into a new
 * mutable application record. */
export function OriginalTextReader({
  sourceUrl,
  fallbackText,
  footnotes,
  highlights,
  annotations,
  activeParagraph,
  onParagraphInView,
  onCreateHighlight,
  onOpenFootnote,
  onOpenAnnotation,
}: {
  sourceUrl: string | null;
  fallbackText: string;
  footnotes: FootnoteRecord[];
  highlights: HighlightRecord[];
  annotations: AnnotationRecord[];
  activeParagraph: number | null;
  onParagraphInView: (index: number) => void;
  onCreateHighlight: (anchor: { paragraphIndex: number; quote: string; prefix: string; suffix: string }) => void;
  onOpenFootnote: (footnote: FootnoteRecord) => void;
  onOpenAnnotation: (id: string) => void;
}) {
  const [sourceText, setSourceText] = useState<string | null>(sourceUrl ? null : fallbackText);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!sourceUrl) return;
    void fetch(sourceUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error("The immutable source text could not be loaded.");
        return response.text();
      })
      .then((text) => { if (!cancelled) setSourceText(text); })
      .catch(() => { if (!cancelled) { setError("The immutable source text could not be loaded; showing the stored extraction instead."); setSourceText(fallbackText); } });
    return () => { cancelled = true; };
  }, [fallbackText, sourceUrl]);

  const displayedText = sourceUrl ? sourceText : fallbackText;
  if (displayedText === null) return <p className="text-[var(--color-text-muted)]">Loading immutable source text…</p>;
  return (
    <section aria-label="Published edition — original source text">
      <p className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">Published edition · original source text · immutable</p>
      {error && <p className="mb-3 text-sm text-[var(--color-accent-burgundy)]">{error}</p>}
      <TextReader text={displayedText} footnotes={footnotes} highlights={highlights} annotations={annotations} activeParagraph={activeParagraph} onParagraphInView={onParagraphInView} onCreateHighlight={onCreateHighlight} onOpenFootnote={onOpenFootnote} onOpenAnnotation={onOpenAnnotation} />
    </section>
  );
}
