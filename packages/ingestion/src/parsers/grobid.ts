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
  /** D-20-84: surname (lowercased) -> the biblStruct nodes that cite a
   *  FORENAMED person with that surname. See `buildForenamedSurnameOwners`. */
  forenamedOwners: Map<string, Set<PoNode>>;
  /** D-20-84: biblStruct node -> its 0-based position in `<listBibl>`
   *  document order. See `buildForenamedSurnameOwners`. */
  biblStructIndex: Map<PoNode, number>;
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

function persNameSurname(persName: PoNode): string | null {
  const parts: PoNode[] = [];
  collect(persName, "surname", parts);
  const text = clean(parts.map((p) => textContent(p)).join(" "));
  return text || null;
}

function persNameHasForename(persName: PoNode): boolean {
  const parts: PoNode[] = [];
  collect(persName, "forename", parts);
  return parts.some((p) => clean(textContent(p)).length > 0);
}

/**
 * D-20-84: how many `<listBibl>` document-order positions apart an owning
 * biblStruct may sit from a bare-surname echo and still be treated as the
 * SAME segmentation bleed, rather than two unrelated citations that merely
 * share a surname. GROBID's citation-segmentation model — trained on
 * itemized numbered reference lists, not the continuous-prose,
 * multi-citation-per-footnote style this document (and note-style humanities
 * citations generally) uses — over-segments one continuous run of footnote
 * prose into several biblStruct siblings, and a bleed only ever happens
 * between siblings from that same run, never across the whole document. A
 * document-wide check (no distance limit at all, the first version of this
 * guard) is provably too broad: it strips a bare surname from a citation
 * whose owning namesake is unrelated and merely appears anywhere else in a
 * long reference list, which a real adversarial two-distinct-people-same-
 * surname case (see grobid.test.ts) demonstrates.
 *
 * Measured directly against the real baseline_test fixture (2026-07-23): the
 * confirmed Brickhouse -> Liddell & Scott bleed is NOT between immediate
 * neighbors — it is 3 `<listBibl>` positions apart (the correctly-attributed
 * Brickhouse entry, then two intervening biblStruct siblings that are
 * themselves artifacts of the same over-segmented footnote run — one a real
 * Irwin citation with a stray connective-prose `<note>` appended, the other
 * carrying no author or imprint at all, just a `<title>` that is really
 * leftover prose ("Brickhouse acknowledges that...") — then the contaminated
 * Liddell & Scott entry). A strict immediately-adjacent (distance 1) rule
 * does not cover this real case; 3 is the smallest window that does. The
 * same real 17-entry reference list contains exactly one forenamed/bare
 * surname collision anywhere in the whole list (this one), so widening this
 * far introduces no additional false-positive risk on the fixture the guard
 * was built from.
 */
const CONTAMINATION_ADJACENCY_WINDOW = 3;

/**
 * D-20-84: measured on the baseline_test Roochnik "Vicious Man" fixture,
 * GROBID's citation-segmentation model — trained on itemized numbered
 * reference lists, not the continuous-prose, multi-citation-per-footnote
 * style this document (and note-style humanities citations generally) uses
 * — sometimes bleeds one biblStruct's own author into a STRUCTURALLY NEARBY
 * one (within `CONTAMINATION_ADJACENCY_WINDOW` listBibl positions) whose real
 * citation carries no author of its own (e.g. the Liddell & Scott lexicon
 * note picks up a nearby Brickhouse entry's surname as if it were its
 * author). The tell: the correctly-attributed citation for that person always
 * has a full forename (every genuine author extraction in this fixture
 * does), while the contaminating echo is surname-only. Maps each forenamed
 * surname to the biblStruct(s) that legitimately own it, plus each
 * biblStruct's own document-order index (so a caller can test adjacency), so
 * a DIFFERENT, structurally-nearby biblStruct's bare-surname mention of the
 * same name can be recognized as an echo rather than a real (if
 * forename-less) citation of that person and excluded from that entry's
 * reference text — the same "prefer the reliable field, drop the residual
 * one" reasoning already applied to `<note>` below, extended to this second
 * contamination channel the `<note>` exclusion alone doesn't cover. A
 * same-surname mention belonging to a biblStruct OUTSIDE the window is left
 * untouched — distance alone is what distinguishes a segmentation bleed from
 * two distinct people who happen to share a surname.
 */
function buildForenamedSurnameOwners(biblStructs: readonly PoNode[]): {
  owners: Map<string, Set<PoNode>>;
  biblStructIndex: Map<PoNode, number>;
} {
  const owners = new Map<string, Set<PoNode>>();
  const biblStructIndex = new Map<PoNode, number>();
  biblStructs.forEach((bs, index) => biblStructIndex.set(bs, index));
  for (const bs of biblStructs) {
    const names: PoNode[] = [];
    collect(bs, "persName", names);
    for (const name of names) {
      if (!persNameHasForename(name)) continue;
      const surname = persNameSurname(name);
      if (!surname) continue;
      const key = surname.toLowerCase();
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(bs);
    }
  }
  return { owners, biblStructIndex };
}

/** True when `persName` is a bare (forename-less) surname mention whose
 *  surname is confidently owned by a DIFFERENT biblStruct within
 *  `CONTAMINATION_ADJACENCY_WINDOW` document-order positions. A same-surname
 *  owner further away is treated as a distinct person, not an echo. */
function isContaminatingBareSurname(
  persName: PoNode,
  bs: PoNode,
  owners: Map<string, Set<PoNode>>,
  biblStructIndex: Map<PoNode, number>,
): boolean {
  if (persNameHasForename(persName)) return false;
  const surname = persNameSurname(persName);
  if (!surname) return false;
  const owningSet = owners.get(surname.toLowerCase());
  if (!owningSet) return false;
  const bsIndex = biblStructIndex.get(bs);
  if (bsIndex === undefined) return false;
  for (const owner of owningSet) {
    if (owner === bs) continue;
    const ownerIndex = biblStructIndex.get(owner);
    if (ownerIndex === undefined) continue;
    if (Math.abs(ownerIndex - bsIndex) <= CONTAMINATION_ADJACENCY_WINDOW) return true;
  }
  return false;
}

/**
 * Builds a biblStruct's own reference text, same shape as `textContent` but
 * with two D-20-84 contamination guards a plain text walk can't express:
 * excluding a bare-surname `persName` that really belongs to a different,
 * STRUCTURALLY NEARBY, fully-attributed citation — within
 * `CONTAMINATION_ADJACENCY_WINDOW` document-order positions, not anywhere
 * in the document (see `buildForenamedSurnameOwners` and
 * `isContaminatingBareSurname` above for why distance is what distinguishes
 * a segmentation bleed from two distinct people who share a surname) — and
 * preferring a `<date>` element's own `@when` attribute — GROBID's
 * normalized, single-value date — over its raw text, which can carry a
 * second citation's year concatenated onto the real one (confirmed on TWO
 * separate real entries in the same fixture: `when="1986"` on text
 * "1986. 1994", and `when="1980"` on text "1984. 1980"). The existing
 * `<note>` exclusion (biblStruct's own "residual/unclassified field") is
 * preserved unchanged.
 */
function biblStructText(
  node: PoNode,
  bs: PoNode,
  owners: Map<string, Set<PoNode>>,
  biblStructIndex: Map<PoNode, number>,
): string {
  let out = "";
  for (const child of childrenOf(node)) {
    if (isText(child)) {
      out += `${String(child["#text"])} `;
      continue;
    }
    const tag = tagName(child);
    if (tag === "note") continue;
    if (tag === "persName" && isContaminatingBareSurname(child, bs, owners, biblStructIndex)) continue;
    if (tag === "date") {
      const when = attrsOf(child)["@_when"];
      if (when) {
        out += `${when} `;
        continue;
      }
    }
    out += biblStructText(child, bs, owners, biblStructIndex);
  }
  return out;
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
    // D-20-84: a biblStruct's own <note> child is GROBID's residual/
    // unclassified field from its reference-parsing model — the least
    // reliable part of a parsed citation, not a structured bibliographic
    // field like <title>/<author>/<imprint>. Measured on a real fixture
    // (baseline_test's Roochnik "Vicious Man" document), this field is where
    // imperfect note-section segmentation concretely surfaces as cross-
    // citation contamination: the Liddell & Scott lexicon entry's <note>
    // held a nearby Brickhouse journal-article's own title verbatim,
    // rendering the Liddell & Scott query unresolvable regardless of
    // bibliographic provider. Re-verified against the real fixture
    // (2026-07-23): exactly 5 of its 17 reference-list biblStructs carry a
    // <note> at all. Four of those five (page pointers, "argues along these
    // lines"-style connective prose, and the Liddell & Scott contamination
    // itself) carry zero independent bibliographic signal — excluding them
    // never removes a resolvable citation's real evidence, only noise or
    // contamination. The fifth (a Dahl/Davidson entry whose own biblStruct
    // already conflates two distinct underlying citations — a separate,
    // pre-existing GROBID merge this guard cannot and does not attempt to
    // untangle) is the one genuinely ambiguous case: its <note> text reads as
    // a real essay title, but it cannot be attached to the right citation
    // without first separating the merge, so excluding it is honest (no
    // fabricated attribution) rather than a loss of otherwise-usable
    // evidence. Mirrors the existing `<p>` pattern just above, which already
    // excludes nested `<note>` from body text.
    //
    // That exclusion alone turned out not to be sufficient on the real
    // fixture: the same Liddell & Scott entry's <author> field also carried
    // a nearby Brickhouse entry's own surname (a SECOND, structurally
    // distinct contamination channel from the same underlying segmentation
    // error, scoped to structurally-plausible proximity by
    // `CONTAMINATION_ADJACENCY_WINDOW` — see its doc comment for why a
    // document-wide check over-reaches). `biblStructText` covers both
    // channels plus a third (a `<date>` whose raw text concatenates two
    // citations' years, confirmed on TWO separate real entries in this same
    // fixture) — see its doc comment.
    const text = clean(biblStructText(node, node, ctx.forenamedOwners, ctx.biblStructIndex));
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

  // D-20-84: gathered in a pre-pass (not discovered incrementally during
  // `walkBody`'s own single top-down traversal) so that a biblStruct
  // occurring EARLY in the reference list can still be recognized as the
  // confident owner of a surname a LATER, structurally-nearby biblStruct
  // bleeds in bare — the ownership map has to reflect the whole document's
  // biblStruct order, not just what's been walked so far, so adjacency can
  // be tested against every biblStruct's true document-order index.
  const { owners: forenamedOwners, biblStructIndex } = textEl
    ? buildForenamedSurnameOwners((() => {
        const biblStructs: PoNode[] = [];
        collect(textEl, "biblStruct", biblStructs);
        return biblStructs;
      })())
    : { owners: new Map<string, Set<PoNode>>(), biblStructIndex: new Map<PoNode, number>() };

  const ctx: WalkCtx = { currentPage: 0, blocks: [], forenamedOwners, biblStructIndex };
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
  //
  // D-24-G1: `figure`/`figDesc` are deliberately OMITTED. GROBID mis-segments
  // garbled page-bottom footnote fragments as `<figure>` captions, and
  // requesting figure coordinates was measured locally to give those bogus
  // captions a bbox too — a bbox does NOT distinguish a genuine caption from a
  // garbled fragment. Since `parsers/pdf.ts` drops coordinate-less captions to
  // remove that junk, requesting figure coordinates would reintroduce it. The
  // accepted trade is that GENUINE figure/table captions (rare in the target
  // scholarly corpus) are also coordinate-less and therefore also dropped.
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
