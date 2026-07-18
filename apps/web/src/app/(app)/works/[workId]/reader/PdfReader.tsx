"use client";

import { useEffect, useRef, useState } from "react";
import { applyHighlights, captureSelectionAnchor } from "./highlightDom";
import type { HighlightRecord } from "./types";

export function PdfReader({
  fileUrl,
  highlights,
  initialPage,
  onPageChange,
  onCreateHighlight,
}: {
  fileUrl: string;
  highlights: HighlightRecord[];
  initialPage: number;
  onPageChange: (page: number) => void;
  onCreateHighlight: (anchor: { page: number; quote: string; prefix: string; suffix: string }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionUi, setSelectionUi] = useState<{ x: number; y: number } | null>(null);

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument(fileUrl).promise;
        if (cancelled) return;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // Render the current page whenever it (or the document) changes.
  useEffect(() => {
    if (!pdfRef.current || !canvasRef.current || !textLayerRef.current) return;
    let cancelled = false;

    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      const pdfPage = await pdfRef.current!.getPage(page);
      if (cancelled) return;

      const viewport = pdfPage.getViewport({ scale: 1.4 });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      if (cancelled) return;

      const textLayerDiv = textLayerRef.current!;
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;

      const textContent = await pdfPage.getTextContent();
      if (cancelled) return;
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();
      if (cancelled) return;

      const list = highlights
        .filter((h): h is HighlightRecord & { anchor: { kind: "pdf"; page: number; quote: string; prefix: string; suffix: string } } =>
          h.anchor.kind === "pdf" && h.anchor.page === page,
        )
        .map((h) => ({ id: h.id, color: h.color, quote: h.anchor.quote, prefix: h.anchor.prefix, suffix: h.anchor.suffix }));
      applyHighlights(textLayerDiv, list);
    })();

    return () => {
      cancelled = true;
    };
  }, [page, numPages, highlights]);

  function goToPage(next: number) {
    if (!numPages) return;
    const clamped = Math.min(Math.max(1, next), numPages);
    setPage(clamped);
    onPageChange(clamped);
  }

  function handleMouseUp() {
    const el = textLayerRef.current;
    if (!el) return;
    const anchor = captureSelectionAnchor(el);
    if (!anchor) {
      setSelectionUi(null);
      return;
    }
    const sel = window.getSelection();
    const rect = sel?.getRangeAt(0).getBoundingClientRect();
    if (!rect) return;
    setSelectionUi({ x: rect.left + rect.width / 2, y: rect.top + window.scrollY });
  }

  if (error) {
    return (
      <p className="rounded-md border border-[var(--color-border)] px-4 py-3 text-[var(--color-accent-burgundy)]">
        Couldn&apos;t load this PDF: {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="sticky top-0 z-10 flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => goToPage(page - 1)}
          className="disabled:opacity-40"
          aria-label="Previous page"
        >
          ← Prev
        </button>
        <span>
          Page{" "}
          <input
            type="number"
            value={page}
            min={1}
            max={numPages ?? 1}
            onChange={(e) => goToPage(Number(e.target.value))}
            className="w-12 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1 text-center"
          />{" "}
          of {numPages ?? "…"}
        </span>
        <button
          type="button"
          disabled={!numPages || page >= numPages}
          onClick={() => goToPage(page + 1)}
          className="disabled:opacity-40"
          aria-label="Next page"
        >
          Next →
        </button>
      </div>

      {loading && <p className="text-[var(--color-text-muted)]">Loading PDF…</p>}

      <div className="relative" onMouseUp={handleMouseUp}>
        {selectionUi && (
          <button
            type="button"
            className="fixed z-20 -translate-x-1/2 -translate-y-full rounded-md bg-[var(--color-accent-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-background)] shadow-md"
            style={{ left: selectionUi.x, top: selectionUi.y - 8 }}
            onClick={() => {
              const el = textLayerRef.current;
              if (!el) return;
              const anchor = captureSelectionAnchor(el);
              if (!anchor) return;
              onCreateHighlight({ page, ...anchor });
              window.getSelection()?.removeAllRanges();
              setSelectionUi(null);
            }}
          >
            Highlight
          </button>
        )}
        <div ref={containerRef} className="pdf-page-container shadow-sm">
          <canvas ref={canvasRef} />
          <div ref={textLayerRef} className="textLayer" />
        </div>
      </div>
    </div>
  );
}
