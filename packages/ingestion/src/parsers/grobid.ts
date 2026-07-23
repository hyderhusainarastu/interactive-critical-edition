import { XMLParser } from "fast-xml-parser";
import { getGoogleIdToken } from "./gcpIdToken";

export interface GrobidBbox {
  page: number; // 1-based (as GROBID emits)
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GrobidBlock {
  kind: "title" | "header" | "body" | "footnote" | "endnote" | "caption" | "bibliography" | "reference";
  text: string;
  /** 0-based page index, resolved from TEI coordinates or <pb/> counting. */
  pageIndex?: number;
  /** Footnote marker (the `n` attribute), when present. */
  marker?: string;
  bbox?: GrobidBbox | null;
}

export interface GrobidResult {
  title: string | null;
  authors: string[];
  blocks: GrobidBlock[];
  tei: string;
  /** "header" when GROBID's own header-segmentation title is trusted
   *  verbatim; "body-heading" when that title was rejected (see
   *  `headerAuthorsMissing`) and recovered instead from a body `<head>`;
   *  null when no usable title was found either way. Callers use this to
   *  scale down confidence for a recovered title rather than treating it as
   *  equally certain as a normal header hit (see `parsers/pdf.ts`). */
  titleSource: "header" | "body-heading" | null;
}

// fast-xml-parser preserveOrder node: `{ tagName: [children], ":@": {attrs} }`
// or a text node `{ "#text": "..." }`. These helpers walk that shape.
type PoNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: true,
  // Keep <lb/>, <pb/> etc. even though self-closing.
  processEntities: true,
});

function tagName(node: PoNode): string | null {
  for (const key of Object.keys(node)) {
    if (key !== ":@" && key !== "#text") return key;
  }
  return null;
}

function childrenOf(node: PoNode): PoNode[] {
  const tag = tagName(node);
  if (!tag) return [];
  const value = node[tag];
  return Array.isArray(value) ? (value as PoNode[]) : [];
}

function attrsOf(node: PoNode): Record<string, string> {
  return (node[":@"] as Record<string, string>) ?? {};
}

function isText(node: PoNode): boolean {
  return Object.prototype.hasOwnProperty.call(node, "#text");
}

const clean = (value: string) => value.replaceAll(/\s+/g, " ").trim();

/** Concatenate all descendant text, optionally skipping whole subtrees whose
 *  tag is in `skip` — this is how a <p>'s body text excludes its nested
 *  footnote <note>s so the note text is never duplicated into the body. */
function textContent(node: PoNode, skip?: Set<string>): string {
  let out = "";
  for (const child of childrenOf(node)) {
    if (isText(child)) {
      out += `${String(child["#text"])} `;
      continue;
    }
    const tag = tagName(child);
    if (tag && skip?.has(tag)) continue;
    out += textContent(child, skip);
  }
  return out;
}

/** First TEI coordinate found on the node or its descendants. GROBID coords:
 *  "page,x,y,w,h" (possibly `;`-separated for multi-line spans). */
function firstBbox(node: PoNode): GrobidBbox | null {
  const coords = attrsOf(node)["@_coords"];
  if (typeof coords === "string" && coords.length > 0) {
    const parts = coords.split(";")[0].split(",").map(Number);
    if (parts.length >= 5 && parts.every((n) => !Number.isNaN(n))) {
      const [page, x, y, w, h] = parts;
      return { page, x, y, w, h };
    }
  }
  for (const child of childrenOf(node)) {
    if (isText(child)) continue;
    const found = firstBbox(child);
    if (found) return found;
  }
  return null;
}

interface WalkCtx {
  currentPage: number; // 1-based running page from <pb/> counting
  blocks: GrobidBlock[];
}

function pageInfo(node: PoNode, ctx: WalkCtx): { pageIndex?: number; bbox: GrobidBbox | null } {
  const bbox = firstBbox(node);
  if (bbox) return { pageIndex: bbox.page - 1, bbox };
  if (ctx.currentPage > 0) return { pageIndex: ctx.currentPage - 1, bbox: null };
  return { bbox: null };
}

/** Collect every descendant element with the given tag name (order-preserving). */
function collect(node: PoNode, tag: string, out: PoNode[]): void {
  if (tagName(node) === tag) out.push(node);
  for (const child of childrenOf(node)) {
    if (isText(child)) continue;
    collect(child, tag, out);
  }
}

/** Walk the <text> subtree, emitting structural blocks in reading order. */
function walkBody(node: PoNode, ctx: WalkCtx): void {
  const tag = tagName(node);
  const attrs = attrsOf(node);

  if (tag === "pb") {
    const n = Number(attrs["@_n"]);
    ctx.currentPage = Number.isNaN(n) ? ctx.currentPage + 1 : n;
    return;
  }

  if (tag === "head") {
    const text = clean(textContent(node));
    if (text) ctx.blocks.push({ kind: "header", text, ...pageInfo(node, ctx) });
    return;
  }

  if (tag === "note") {
    // Keep authorial notes as their own block so the reader can render them
    // distinctly and page-anchored. GROBID uses `place="end"` for endnotes;
    // treating every <note> as a footnote erases a source distinction that
    // readers need in the apparatus.
    const text = clean(textContent(node));
    if (text) {
      ctx.blocks.push({
        kind: attrs["@_place"] === "end" || attrs["@_type"] === "endnote" ? "endnote" : "footnote",
        text,
        marker: attrs["@_n"] ? String(attrs["@_n"]) : undefined,
        ...pageInfo(node, ctx),
      });
    }
    return;
  }

  if (tag === "p") {
    const body = clean(textContent(node, new Set(["note"])));
    if (body) ctx.blocks.push({ kind: "body", text: body, ...pageInfo(node, ctx) });
    // Emit any nested footnotes separately (not duplicated into the body above).
    for (const child of childrenOf(node)) {
      if (!isText(child) && tagName(child) === "note") walkBody(child, ctx);
    }
    return;
  }

  if (tag === "biblStruct") {
    const text = clean(textContent(node));
    if (text) ctx.blocks.push({ kind: "reference", text, ...pageInfo(node, ctx) });
    return;
  }

  if (tag === "figure" || tag === "table") {
    // GROBID keeps figure/table captions in a structural container. Preserve
    // them as captions rather than letting a recursive walk flatten them into
    // body text. A caption is source text, not an editorial annotation.
    const caption = clean(textContent(node));
    if (caption) ctx.blocks.push({ kind: "caption", text: caption, ...pageInfo(node, ctx) });
    return;
  }

  for (const child of childrenOf(node)) {
    if (isText(child)) continue;
    walkBody(child, ctx);
  }
}

function extractTitle(header: PoNode): string | null {
  const titles: PoNode[] = [];
  collect(header, "title", titles);
  const main = titles.find((t) => attrsOf(t)["@_type"] === "main");
  const chosen = main ?? titles.find((t) => clean(textContent(t)).length > 0);
  const text = chosen ? clean(textContent(chosen)) : "";
  return text || null;
}

function extractAuthors(header: PoNode): string[] {
  const names: PoNode[] = [];
  collect(header, "persName", names);
  const authors = names
    .map((n) => {
      const fore: PoNode[] = [];
      const sur: PoNode[] = [];
      collect(n, "forename", fore);
      collect(n, "surname", sur);
      const parts = [...fore, ...sur].map((p) => clean(textContent(p))).filter(Boolean);
      return parts.length ? parts.join(" ") : clean(textContent(n));
    })
    .filter(Boolean);
  return [...new Set(authors)];
}

/**
 * D-20-67: GROBID's header-segmentation model occasionally locks onto the
 * wrong region of a document — e.g. a hosting service's cover/terms page
 * prefixed to the real article — and reports a publisher/copublisher line as
 * the title (observed on a real fixture: title extracted as "North American
 * Philosophical Publications", the journal's copublisher printed on the PDF
 * cover, with the article's real title never touched). There is no reliable
 * way to blocklist every publisher/imprint string this could ever produce,
 * but a correctly segmented scholarly header virtually always yields at
 * least one `<persName>` for the author — the same header pass that
 * mis-produced the title in the real failure also produced zero person
 * names (only an institutional `<affiliation>`). Zero person names is
 * therefore treated as structural evidence the whole header region was
 * mis-anchored, not a name-specific rule, and the title it also produced is
 * distrusted rather than trusted at face value.
 */
function headerAuthorsMissing(header: PoNode): boolean {
  const names: PoNode[] = [];
  collect(header, "persName", names);
  return names.length === 0;
}

/**
 * Recovery for a distrusted header title: GROBID's body-segmentation pass
 * (a different model from the header pass above) marks the article's own
 * structural headings as `<head>` elements, each carrying font-size-bearing
 * coordinates. On the earliest page that carries any such heading, the
 * article's actual title is reliably the largest one — a running
 * venue/journal line prints smaller on the same page, and later section
 * headings ("Part Two", "Conclusion", ...) fall on later pages, not the
 * earliest heading page. This reuses GROBID's own structural output rather
 * than guessing from raw text.
 */
function recoverTitleFromHeadings(blocks: GrobidBlock[]): string | null {
  const headings = blocks.filter((b) => b.kind === "header" && b.bbox && b.text.trim().length > 0);
  if (!headings.length) return null;
  const earliestPage = Math.min(...headings.map((b) => b.bbox!.page));
  const onEarliestPage = headings.filter((b) => b.bbox!.page === earliestPage);
  const largest = onEarliestPage.reduce((best, b) => (b.bbox!.h > best.bbox!.h ? b : best));
  return clean(largest.text) || null;
}

/** Parse a GROBID TEI string into structured, page-attributed blocks.
 *  Returns null for input that isn't a usable TEI document. */
export function parseTei(tei: string): GrobidResult | null {
  if (!tei.includes("<TEI")) return null;
  let tree: PoNode[];
  try {
    tree = parser.parse(tei) as PoNode[];
  } catch {
    return null;
  }

  const teiRoot = tree.find((n) => tagName(n) === "TEI");
  if (!teiRoot) return null;

  const header = childrenOf(teiRoot).find((n) => tagName(n) === "teiHeader") ?? null;
  const textEl = childrenOf(teiRoot).find((n) => tagName(n) === "text") ?? null;

  const ctx: WalkCtx = { currentPage: 0, blocks: [] };
  if (textEl) walkBody(textEl, ctx);

  let title = header ? extractTitle(header) : null;
  const authors = header ? extractAuthors(header) : [];
  let titleSource: GrobidResult["titleSource"] = title ? "header" : null;

  if (title && header && headerAuthorsMissing(header)) {
    const recovered = recoverTitleFromHeadings(ctx.blocks);
    title = recovered;
    titleSource = recovered ? "body-heading" : null;
  }

  // D-20-67 (duplicate-title regression, this fix): a header-trusted title
  // comes from `teiHeader` metadata that `walkBody` never emits into
  // `ctx.blocks`, so unshifting it as a leading synthetic "title" block adds
  // information, not a copy — safe to prepend. A body-heading *recovery*, in
  // contrast, IS already one of the blocks `walkBody` emitted (the largest
  // heading on the earliest heading page, taken verbatim in
  // `recoverTitleFromHeadings` above) — unshifting it too would render that
  // exact text twice once `parsers/pdf.ts`'s `processedTextFromPages` renders
  // both the synthetic leading block and the heading at its natural position.
  // Leaving the heading where `walkBody` put it (still a "header" block, not
  // promoted to "title") keeps the processed text in the document's true
  // reading order and keeps the recovered title appearing exactly once;
  // `title`/`titleSource` above already carry it to every caller — such as
  // `parsePdf`'s `detectedTitle` — that needs it as metadata rather than as
  // reader-facing prose.
  if (title && titleSource === "header") ctx.blocks.unshift({ kind: "title", text: title });

  return { title, authors, blocks: ctx.blocks, tei, titleSource };
}

/**
 * Concurrency limiter for the GROBID service. The CRF service is memory-bound
 * and OOM-kills under parallel full-text requests, so calls are serialized by
 * default.
 *
 * This used to be a comment claiming requests were "serialized upstream
 * (GROBID_MAX_CONCURRENCY)" — but nothing read that variable anywhere. The
 * claim was accidentally true only because the worker happens to process one
 * job at a time; raising worker concurrency would have silently broken it.
 * The guarantee is now enforced here, where it is stated.
 */
const grobidLimit = Math.max(1, Number(process.env.GROBID_MAX_CONCURRENCY ?? 1));
let grobidActive = 0;
const grobidWaiting: (() => void)[] = [];

async function acquireGrobidSlot(): Promise<() => void> {
  if (grobidActive >= grobidLimit) {
    await new Promise<void>((resolve) => grobidWaiting.push(resolve));
  }
  grobidActive++;
  let released = false;
  return () => {
    if (released) return; // release must be idempotent
    released = true;
    grobidActive--;
    grobidWaiting.shift()?.();
  };
}

/** Local, opt-in GROBID adapter. Missing configuration deliberately means
 * disabled, never a failed upload or a public-document transfer. Calls are
 * limited to `GROBID_MAX_CONCURRENCY` (default 1) because the CRF service is
 * memory-bound; here we just call it and parse the TEI it returns. */
export async function processWithGrobid(buffer: Buffer): Promise<GrobidResult | null> {
  const baseUrl = process.env.GROBID_URL?.replace(/\/$/, "");
  if (!baseUrl) return null;
  const body = new FormData();
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  body.append("input", new Blob([bytes], { type: "application/pdf" }), "document.pdf");
  // Ask GROBID to emit coordinates so blocks can be page/bbox-anchored. These
  // are self-contained (no external consolidation calls).
  for (const el of ["p", "head", "note", "biblStruct", "persName", "s"]) {
    body.append("teiCoordinates", el);
  }
  // Authenticate to a private Cloud Run GROBID with a Google ID token (audience
  // = the service URL). Unset SA key → no header (local unauthenticated GROBID).
  const headers: Record<string, string> = {};
  try {
    const idToken = await getGoogleIdToken(baseUrl);
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
  } catch {
    // Auth failure → fall through unauthenticated; a 401 becomes null (fallback).
  }
  // The timeout starts when the request does, not while queued behind another
  // document — otherwise a backlog would abort work that never actually ran.
  const release = await acquireGrobidSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GROBID_TIMEOUT_MS ?? 120_000));
  try {
    const response = await fetch(`${baseUrl}/api/processFulltextDocument`, {
      method: "POST",
      body,
      headers,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const tei = await response.text();
    return parseTei(tei);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    release();
  }
}
