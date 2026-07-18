"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { applyHighlights, captureSelectionAnchor } from "./highlightDom";
import type { FootnoteRecord, HighlightRecord } from "./types";

const FOOTNOTE_MARKER = /[[(](\d{1,3})[\])]/g;

function renderParagraph(text: string, footnotes: FootnoteRecord[], onMarkerClick: (f: FootnoteRecord) => void) {
  if (footnotes.length === 0) return text;
  const byMarker = new Map(footnotes.map((f) => [f.marker, f]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FOOTNOTE_MARKER.lastIndex = 0;
  while ((match = FOOTNOTE_MARKER.exec(text))) {
    const footnote = byMarker.get(match[1]);
    if (!footnote) continue;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <span
        key={`fn-${match.index}`}
        className="reader-footnote-marker"
        role="button"
        tabIndex={0}
        onClick={() => onMarkerClick(footnote)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onMarkerClick(footnote);
        }}
      >
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  parts.push(text.slice(lastIndex));
  return parts;
}

export function TextReader({
  text,
  footnotes,
  highlights,
  activeParagraph,
  onParagraphInView,
  onCreateHighlight,
  onOpenFootnote,
}: {
  text: string;
  footnotes: FootnoteRecord[];
  highlights: HighlightRecord[];
  activeParagraph: number | null;
  onParagraphInView: (index: number) => void;
  onCreateHighlight: (anchor: { paragraphIndex: number; quote: string; prefix: string; suffix: string }) => void;
  onOpenFootnote: (f: FootnoteRecord) => void;
}) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const paragraphRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [selectionUi, setSelectionUi] = useState<{
    paragraphIndex: number;
    x: number;
    y: number;
  } | null>(null);

  // Re-apply highlights whenever they change or the text changes.
  useEffect(() => {
    const byParagraph = new Map<number, HighlightRecord[]>();
    for (const h of highlights) {
      if (h.anchor.kind !== "text") continue;
      const list = byParagraph.get(h.anchor.paragraphIndex) ?? [];
      list.push(h);
      byParagraph.set(h.anchor.paragraphIndex, list);
    }
    paragraphRefs.current.forEach((el, i) => {
      if (!el) return;
      const list = (byParagraph.get(i) ?? []).map((h) => ({
        id: h.id,
        color: h.color,
        ...(h.anchor as { quote: string; prefix: string; suffix: string }),
      }));
      applyHighlights(el, list);
    });
  }, [highlights, text]);

  // Track which paragraph is in view for reading-position persistence.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const index = paragraphRefs.current.indexOf(topMost.target as HTMLParagraphElement);
        if (index !== -1) onParagraphInView(index);
      },
      { rootMargin: "-10% 0px -70% 0px" },
    );
    paragraphRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    if (activeParagraph === null) return;
    const el = paragraphRefs.current[activeParagraph];
    el?.scrollIntoView({ block: "start" });
    // Only run on initial mount / explicit jump — see callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleMouseUp(paragraphIndex: number, el: HTMLParagraphElement) {
    const anchor = captureSelectionAnchor(el);
    if (!anchor) {
      setSelectionUi(null);
      return;
    }
    const sel = window.getSelection();
    const rect = sel?.getRangeAt(0).getBoundingClientRect();
    if (!rect) return;
    setSelectionUi({ paragraphIndex, x: rect.left + rect.width / 2, y: rect.top + window.scrollY });
  }

  return (
    <div className="relative">
      {selectionUi && (
        <button
          type="button"
          className="fixed z-20 -translate-x-1/2 -translate-y-full rounded-md bg-[var(--color-accent-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-background)] shadow-md"
          style={{ left: selectionUi.x, top: selectionUi.y - 8 }}
          onClick={() => {
            const el = paragraphRefs.current[selectionUi.paragraphIndex];
            if (!el) return;
            const anchor = captureSelectionAnchor(el);
            if (!anchor) return;
            onCreateHighlight({ paragraphIndex: selectionUi.paragraphIndex, ...anchor });
            window.getSelection()?.removeAllRanges();
            setSelectionUi(null);
          }}
        >
          Highlight
        </button>
      )}
      <div
        className="reader-content mx-auto flex flex-col gap-[1.1em]"
        style={{
          maxWidth: "var(--reader-line-width, 66ch)",
          fontSize: "var(--reader-font-size, 1.05rem)",
        }}
      >
        {paragraphs.map((p, i) => (
          <Fragment key={i}>
            <p
              ref={(el) => {
                paragraphRefs.current[i] = el;
              }}
              data-paragraph-index={i}
              onMouseUp={(e) => handleMouseUp(i, e.currentTarget)}
              className="leading-[1.7] text-[var(--color-text)] whitespace-pre-wrap"
            >
              {renderParagraph(p, footnotes, onOpenFootnote)}
            </p>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
