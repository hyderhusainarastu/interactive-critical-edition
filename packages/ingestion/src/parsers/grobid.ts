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
  kind: "title" | "header" | "body" | "footnote" | "bibliography" | "reference";
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
    // Footnotes/marginalia. Keep authorial notes as their own block so the
    // reader can render them distinctly and page-anchored.
    const text = clean(textContent(node));
    if (text) {
      ctx.blocks.push({
        kind: "footnote",
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

  const title = header ? extractTitle(header) : null;
  const authors = header ? extractAuthors(header) : [];

  const ctx: WalkCtx = { currentPage: 0, blocks: [] };
  if (title) ctx.blocks.push({ kind: "title", text: title });
  if (textEl) walkBody(textEl, ctx);

  return { title, authors, blocks: ctx.blocks, tei };
}

/** Local, opt-in GROBID adapter. Missing configuration deliberately means
 * disabled, never a failed upload or a public-document transfer. Requests are
 * serialized upstream (GROBID_MAX_CONCURRENCY) since the CRF service is
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
  }
}
