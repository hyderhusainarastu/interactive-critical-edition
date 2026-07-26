import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { collectBoilerplateLines, isEntirelyBoilerplate, normalizeBoilerplateCandidate, stripBoilerplateAtBoundaries, stripBoilerplateLines } from "./boilerplate";
import { recoverLeadingBodyProse } from "./bodyRecovery";
import { findColumnSplit, joinPositionedItems, orderItemsForColumns, type PositionedTextItem } from "./columns";
import { recoverTruncatedEndnotes } from "./endnoteRecovery";
import { detectFootnotes } from "./footnotes";
import { recoverPageBottomFootnotes } from "./footnoteRecovery";
import { type GrobidBbox, type GrobidResult, processWithGrobid } from "./grobid";
import { ocrLowTextPages } from "./ocr";

export interface ParsedBlock {
  kind: "title" | "header" | "body" | "footer" | "footnote" | "endnote" | "caption" | "bibliography" | "reference";
  text: string;
  marker?: string;
  bbox?: GrobidBbox | null;
  /** D-20-89/D-25-L4: true for a footnote/endnote block this module supplied
   *  from the document's own text layer — either GROBID's structural output
   *  omitted it (text-layer recovery), or GROBID was unavailable entirely and
   *  it came from the plain-text footnote heuristic on the flat fallback —
   *  never for a block GROBID itself produced. Downstream code uses this to
   *  label provenance honestly (never presented as GROBID/layout-aware
   *  structure) rather than to change what the block contains. */
  recovered?: boolean;
}

export interface ParsedPage {
  pageIndex: number;
  text: string;
  blocks: ParsedBlock[];
  isOcr: boolean;
  extractionConfidence: number | null;
}

export interface ParsedDocument {
  text: string;
  detectedTitle: string | null;
  detectedAuthor: string | null;
  pages: ParsedPage[];
  structureState: "full" | "limited";
  metadataConfidence: number;
}

/** Build the reader/analysis transcript only from prose-bearing structural
 * blocks. Authorial notes and bibliography remain persisted and addressable,
 * but never get silently folded into the processed body transcript.
 *
 * A caption is included only when it carries a bbox (D-24-G1): GROBID
 * mis-segments garbled page-bottom footnote fragments as coordinate-less
 * `<figure>` captions, which would otherwise land at the transcript start as
 * junk. NOTE: `parsers/grobid.ts` deliberately does not request `figure`
 * coordinates (doing so was measured to give the garbled fragments a bbox too),
 * so in current production ALL captions are coordinate-less and this filter
 * therefore excludes every caption. The bbox check is a forward-compatible
 * invariant (a truly located caption would be kept), not a genuine-vs-junk
 * discriminator — see grobid.ts for why that trade was accepted. */
export function processedTextFromPages(pages: readonly ParsedPage[]): string {
  return pages
    .flatMap((page) => page.blocks)
    .filter(
      (block) =>
        block.kind === "title" ||
        block.kind === "header" ||
        block.kind === "body" ||
        (block.kind === "caption" && block.bbox != null),
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Merge per-page texts into one document string. Rebuilt from the final page
 *  texts (which include any OCR results) so scanned PDFs whose text layer was
 *  empty still produce non-empty document text (plan 1.4). */
export function mergePageTexts(pageTexts: string[]): string {
  return pageTexts.map((t) => t.trim()).filter(Boolean).join("\n\n");
}

/**
 * D-20-67: a title recovered from a body heading (GROBID's header-author
 * guard rejected the header's own title — see `parsers/grobid.ts`) is real
 * structural evidence, but it is a heuristic fallback rather than GROBID's
 * own header judgment, so it is deliberately kept below the `autoReady`
 * confidence threshold (0.9, see `apps/worker/src/extraction.ts`) — the
 * document still goes to `needs_review` for a human to confirm, rather than
 * asserting a second guess with the same false certainty as the first one
 * that caused this defect. A plain PDF-metadata/first-line fallback (no
 * GROBID title at all) stays at its prior, already-sub-threshold value.
 */
export function metadataConfidenceFor(titleSource: GrobidResult["titleSource"] | undefined, hasFallbackTitle: boolean): number {
  if (titleSource === "header") return 0.95;
  if (titleSource === "body-heading") return 0.7;
  return hasFallbackTitle ? 0.65 : 0;
}

/**
 * D-25-L4: wire the plain-text footnote heuristic (`detectFootnotes`, cross-
 * checked against in-body [N]/(N) markers — see `parsers/footnotes.ts`) onto
 * the PDF flat-fallback path (no GROBID structure), so a fallback PDF that
 * has real numbered footnotes gets labeled `footnote` blocks instead of
 * none. Detection itself is untouched (same function, same rules) — this
 * only decides where the already-decided results are attached: the heuristic
 * only ever matches a TRAILING run of numbered lines, so every result
 * belongs on the LAST page, exactly where such a run physically sits.
 *
 * These blocks only ADD labeled apparatus; they never remove anything from
 * the (unstructured, whole-page) "body" block a fallback page already has,
 * so the same source text can appear in both places. This is the same
 * trade-off already accepted for text/markdown documents that have a
 * trailing numbered-notes section but no explicit "Notes:" heading (see
 * `parsers/text.ts`'s own, narrower, heading-triggered split) — not a new
 * category of duplication. `processedTextFromPages` still excludes
 * `footnote`-kind blocks from the reader-facing transcript either way, so no
 * apparatus content is duplicated INTO processed body prose.
 */
export function buildFallbackFootnoteBlocks(pageCount: number, mergedFallbackText: string): ParsedBlock[] {
  if (pageCount <= 0) return [];
  return detectFootnotes(mergedFallbackText).map((note) => ({
    kind: "footnote" as const,
    text: note.content,
    marker: note.marker,
    recovered: true,
  }));
}

/**
 * D-25-L4: re-derive a page's text from pdf.js's own `getTextContent()` items
 * (which carry real x/y geometry) instead of unpdf's flattened join, and
 * reorder it via `columns.ts` when the page is genuinely two-column — ported
 * from ScholarLens's column detection (see `columns.ts`'s own doc comment).
 * `unpdfPageText` is unpdf's own already-computed text for this page; it is
 * returned UNCHANGED whenever no split is detected (including on any error
 * probing geometry), so a single-column page — the overwhelming majority,
 * and every existing fixture — is provably unaffected by this function.
 */
async function extractColumnAwarePageText(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageIndex: number,
  unpdfPageText: string,
): Promise<string> {
  try {
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PositionedTextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || raw.str == null) continue; // skip TextMarkedContent entries — no position data
      const transform = raw.transform as number[];
      items.push({ x: transform[4], y: transform[5], str: raw.str, hasEOL: Boolean(raw.hasEOL) });
    }
    if (items.length === 0) return unpdfPageText;
    const split = findColumnSplit(
      items.map((item) => item.x),
      viewport.width,
    );
    if (split === null) return unpdfPageText; // single column — keep unpdf's own text byte-for-byte
    return joinPositionedItems(orderItemsForColumns(items, viewport.width));
  } catch {
    // Best-effort probe — never fail extraction over a column-detection pass.
    return unpdfPageText;
  }
}

/**
 * PDF extraction via unpdf (pdf.js). Text-layer pages are read directly; pages
 * whose layer is sparse are rendered and OCR'd (scanned documents). When a
 * local GROBID service is configured, its TEI structure (headings, footnotes,
 * bibliography, coordinates) is layered onto the pages and the run is marked
 * "full"; otherwise the honest "limited" (PDF.js block) state is used.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text: mergedText } = await extractText(pdf, { mergePages: true });
  const { text: unpdfPerPageText } = (await extractText(pdf, { mergePages: false })) as { text: string[] };

  // D-25-L4: dynamic two-column reordering (see `extractColumnAwarePageText`
  // above). unpdf's own extractText() flattens pdf.js's text-item stream
  // without looking at item geometry, so a genuine two-column page comes out
  // with its columns interleaved line-by-line; pdf.js's lower-level
  // `getTextContent()` DOES expose per-item x/y, so this re-derives text
  // from that when — and only when — a page is confidently two-column.
  const perPageText = await Promise.all(
    unpdfPerPageText.map((pageText, pageIndex) => extractColumnAwarePageText(pdf, pageIndex, pageText)),
  );

  let detectedTitle: string | null = null;
  let detectedAuthor: string | null = null;
  try {
    const meta = await getMeta(pdf);
    const info = meta.info as Record<string, unknown>;
    if (typeof info.Title === "string" && info.Title.trim()) detectedTitle = info.Title.trim();
    if (typeof info.Author === "string" && info.Author.trim()) detectedAuthor = info.Author.trim();
  } catch {
    // Metadata is best-effort — absence isn't a parse failure.
  }

  const pages: ParsedPage[] = perPageText.map((pageText, pageIndex) => ({
    pageIndex,
    text: pageText,
    blocks: pageText.trim() ? [{ kind: "body" as const, text: pageText }] : [],
    isOcr: false,
    extractionConfidence: pageText.trim().length > 40 ? 1 : null,
  }));

  // OCR any sparse pages and fold the recovered text back into BOTH the page
  // record and the merged document text (the previous bug: merged text was
  // taken from the text layer only, so scanned docs stayed empty after OCR).
  const ocr = await ocrLowTextPages(pdf, perPageText);
  for (const result of ocr) {
    const page = pages[result.pageIndex];
    if (!page) continue;
    page.text = result.text;
    page.blocks = [{ kind: "body", text: result.text }];
    page.isOcr = true;
    page.extractionConfidence = result.confidence === null ? null : result.confidence / 100;
  }

  // D-23-8: strip repeated running headers/footers (JSTOR-style download
  // stamps) from the text-layer body-assembly path before this becomes the
  // citation-extraction-facing document text. Only affects `text` here — the
  // per-page `page.text` array stays raw/unchanged, since it also feeds
  // endnote recovery below and the persisted page record. When GROBID
  // supplies its own body blocks further down, `text` is recomputed from
  // those blocks instead and this stripped value is superseded.
  let text = mergePageTexts(stripBoilerplateLines(pages.map((p) => p.text))) || mergedText.trim();

  if (!detectedTitle) {
    detectedTitle = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && l.length < 200) ?? null;
  }

  // D-25-L4: tracks whether GROBID's own structural body blocks replaced the
  // PDF.js fallback blocks below (mirrors `structureState`'s own condition).
  // When it stays false, `pages[].blocks` are still the flat, unstructured
  // fallback (see the footnote wiring right after this whole `if (grobid)`).
  let structuralBodyUsed = false;

  const grobid = await processWithGrobid(buffer);
  if (grobid) {
    detectedTitle = grobid.title ?? detectedTitle;
    detectedAuthor = grobid.authors[0] ?? detectedAuthor;
    // A usable TEI result replaces, rather than augments, the PDF.js fallback
    // blocks. Appending was a structural lie: the fallback page body already
    // contains footnote/bibliography glyphs, so appending structured notes
    // showed the same source material twice. PDF.js page text stays on the
    // page record as immutable source evidence; the processed blocks now have
    // one authoritative structural representation.
    const structured = grobid.blocks.filter((block) => block.text.trim().length > 0);
    const hasBody = structured.some((block) => block.kind === "body");
    if (hasBody) {
      structuralBodyUsed = true;
      for (const page of pages) page.blocks = [];
      // D-24-G1: drop coordinate-less caption blocks (the class GROBID uses for
      // garbled page-bottom footnote fragments it mis-reads as `<figure>`
      // captions), and carry the walk's running page forward for any other
      // coordinate-less block instead of defaulting it to page 0, so a
      // note/heading with no bbox is placed on the page it actually followed
      // rather than jumping to the cover page. Because grobid.ts does not
      // request `figure` coordinates (that reintroduces the junk — see there),
      // every caption is coordinate-less today, so this currently drops ALL
      // captions; genuine captions are rare in the target corpus and the trade
      // is accepted.
      let runningPage = 0;
      for (const block of structured) {
        if (block.kind === "caption" && block.bbox == null) continue;
        const resolved = block.pageIndex ?? runningPage;
        if (block.pageIndex != null) runningPage = block.pageIndex;
        const index = Math.min(Math.max(resolved, 0), Math.max(0, pages.length - 1));
        const page = pages[index];
        if (page) page.blocks.push({ kind: block.kind, text: block.text, marker: block.marker, bbox: block.bbox });
      }

      // D-24-G1: strip running headers/footers (JSTOR-style download stamps)
      // that GROBID space-joined onto body blocks. Whole-block furniture is
      // dropped (any kind); a footer merged onto the boundary of a real body
      // block is stripped in place, leaving the prose. Learned from the raw
      // per-page text layer, so this is a cross-page repetition signal, never a
      // publisher-name match. The raw `page.text` is untouched (it still feeds
      // endnote/footnote recovery below and the persisted page record).
      const boilerplateKeys = collectBoilerplateLines(pages.map((page) => page.text));
      if (boilerplateKeys.size > 0) {
        for (const page of pages) {
          page.blocks = page.blocks
            .filter((block) => !isEntirelyBoilerplate(block.text, boilerplateKeys))
            .map((block) =>
              block.kind === "body"
                ? { ...block, text: stripBoilerplateAtBoundaries(block.text, boilerplateKeys) }
                : block,
            )
            .filter((block) => block.text.trim().length > 0);
        }
      }

      // D-24-G1: recover a page's leading body prose GROBID skipped entirely
      // (the drop-cap opening paragraph, and the top of a page that continues
      // it). Conservative: only when substantial prose is unrepresented in any
      // GROBID body block on that page, and never duplicating what GROBID did
      // capture (see bodyRecovery.ts). Prepended so it reads before the blocks
      // GROBID placed on that page.
      const allBodyBlockTexts = pages.flatMap((page) => page.blocks.filter((block) => block.kind === "body").map((block) => block.text));
      for (const page of pages) {
        const recoveredProse = recoverLeadingBodyProse({
          pageText: page.text,
          pageBodyBlockTexts: page.blocks.filter((block) => block.kind === "body").map((block) => block.text),
          allBodyBlockTexts,
          title: detectedTitle,
          author: detectedAuthor,
          boilerplateKeys,
          normalizeBoilerplate: normalizeBoilerplateCandidate,
        });
        if (recoveredProse) page.blocks.unshift({ kind: "body", text: recoveredProse, recovered: true });
      }

      text = processedTextFromPages(pages);

      // D-20-89: GROBID's body/note segmentation can miss a numbered
      // endnotes list entirely (confirmed: zero `place="end"` notes on a
      // real fixture whose endnotes are fully present and well-formed in
      // the plain text layer). Recover only the marker numbers GROBID's own
      // structural output didn't already produce, from the SAME text layer
      // already extracted above (unaffected by the block replacement just
      // above — only `.blocks` was replaced, `.text` still holds the raw
      // per-page unpdf/OCR text). Recovered blocks are `endnote` kind, so
      // `processedTextFromPages` (already computed above) already and
      // automatically excludes them from the reader body transcript — this
      // can only add addressable apparatus, never duplicate into prose.
      const structuredMarkers = new Set<number>();
      for (const page of pages) {
        for (const block of page.blocks) {
          if (block.kind !== "footnote" && block.kind !== "endnote") continue;
          const n = block.marker ? Number(block.marker) : NaN;
          if (Number.isInteger(n)) structuredMarkers.add(n);
        }
      }
      const recovered = recoverTruncatedEndnotes({
        pageTexts: pages.map((page) => page.text),
        structuredMarkers,
      });
      for (const entry of recovered) {
        const index = Math.min(Math.max(entry.pageIndex, 0), Math.max(0, pages.length - 1));
        const page = pages[index];
        if (page) page.blocks.push({ kind: "endnote", text: entry.text, marker: entry.marker, recovered: true });
      }

      // D-24-G2: recover page-bottom numbered footnotes GROBID emitted no
      // `<note>` for at all (confirmed on the Brickhouse fixture: zero notes,
      // every footnote mis-segmented). Same text-layer, honest-provenance
      // precedent as the endnote recovery above; entries are `footnote` kind
      // so `processedTextFromPages` (already computed) excludes them from the
      // body transcript — this only adds addressable authorial apparatus.
      // structuredMarkers now also reflects any endnote just recovered, so the
      // two recoveries never double-emit the same marker number.
      for (const entry of recovered) {
        const n = Number(entry.marker);
        if (Number.isInteger(n)) structuredMarkers.add(n);
      }
      const recoveredFootnotes = recoverPageBottomFootnotes({
        pageTexts: pages.map((page) => page.text),
        structuredMarkers,
        // Body-containment guard corpus: every GROBID/recovered body block, so a
        // numbered heading/list or a footnote GROBID mislabeled as body is not
        // re-emitted as fabricated apparatus (D-24-G2 precision guard).
        bodyBlockTexts: pages.flatMap((page) => page.blocks.filter((block) => block.kind === "body").map((block) => block.text)),
      });
      for (const entry of recoveredFootnotes) {
        const index = Math.min(Math.max(entry.pageIndex, 0), Math.max(0, pages.length - 1));
        const page = pages[index];
        if (page) page.blocks.push({ kind: "footnote", text: entry.text, marker: entry.marker, recovered: true });
      }
    }
  }

  // D-25-L4: GROBID unavailable, or unusable (no body) — the flat PDF.js
  // fallback path. Wire the same plain-text footnote heuristic used for
  // text/markdown documents (see `buildFallbackFootnoteBlocks` above) onto
  // this document's fallback text, so it gets labeled footnote blocks
  // instead of none. `structureState` below stays "limited" exactly as
  // before this change — these blocks are still explicitly not presented as
  // layout-aware extraction, matching the fallback's existing discipline.
  if (!structuralBodyUsed) {
    const fallbackFootnoteBlocks = buildFallbackFootnoteBlocks(pages.length, text);
    const lastPage = pages[pages.length - 1];
    if (lastPage && fallbackFootnoteBlocks.length > 0) {
      lastPage.blocks.push(...fallbackFootnoteBlocks);
    }
  }

  return {
    text,
    detectedTitle,
    detectedAuthor,
    pages,
    // A syntactically valid TEI response without prose blocks is not enough
    // to claim structural fidelity; retain the transparent PDF.js fallback.
    structureState: grobid && processedTextFromPages(pages).length > 0 && grobid.blocks.some((block) => block.kind === "body") ? "full" : "limited",
    metadataConfidence: metadataConfidenceFor(grobid?.title ? grobid.titleSource : undefined, Boolean(detectedTitle)),
  };
}
