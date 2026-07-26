/**
 * Chunk planning for claim-extraction map-reduce over a work's text blocks.
 * A long work can't be sent to an LLM in one call (context limits, cost),
 * but naive fixed-size chunking would split a block mid-sentence or cross a
 * section boundary — both of which make a chunk's claims harder to ground
 * back to a real passage. This plans chunks that respect block/section
 * structure instead, and is honest (via `coverage`) about when the plan had
 * to leave material out.
 */

/** Only `body` blocks carry claim-worthy prose today — captions, footnotes,
 *  bibliography entries, running headers, etc. are excluded by default. An
 *  ALLOWLIST (not a denylist) so a future block kind is excluded until
 *  someone deliberately adds it here, rather than silently flowing into
 *  claim extraction the day a new block kind is introduced elsewhere in the
 *  pipeline. */
export const CLAIM_ELIGIBLE_BLOCK_KINDS = ["body"] as const;

export interface ExtractionBlock {
  id: string;
  kind: string;
  sectionLabel: string;
  text: string;
}

export interface ExtractionChunk {
  sectionLabel: string;
  blockIds: string[];
  text: string;
}

export type ExtractionCoverage = "full" | "partial" | "sampled";

export interface ExtractionPlan {
  chunks: ExtractionChunk[];
  coverage: ExtractionCoverage;
  /** Sections that contributed at least one chunk (in the order they were included). */
  includedSections: string[];
  /** Sections that contributed zero chunks because the chunk budget ran out. */
  excludedSections: string[];
}

export interface PlanExtractionChunksOptions {
  maxChunkChars?: number;
  maxChunks?: number;
}

const DEFAULT_MAX_CHUNK_CHARS = 12000;
const DEFAULT_MAX_CHUNKS = 12;

/** Sections named here are read first, in this order, regardless of their
 *  position in the document — an abstract/conclusion is worth extracting
 *  claims from before an unlabeled middle section, if the chunk budget runs
 *  out before reaching everything. */
const SECTION_IMPORTANCE_ORDER = ["abstract", "conclusion", "introduction", "results"];

function sectionImportanceRank(label: string): number {
  const idx = SECTION_IMPORTANCE_ORDER.indexOf(label.toLowerCase().trim());
  return idx === -1 ? SECTION_IMPORTANCE_ORDER.length : idx;
}

/**
 * Split one section's blocks into <=maxChunkChars chunks. NEVER splits a
 * block itself — a single block bigger than the whole per-chunk budget
 * still gets its own (oversized) chunk rather than being cut mid-block or
 * silently dropped. An oversized section (more blocks than fit in one
 * chunk) becomes multiple chunks, each re-prefixed with the section label so
 * a later chunk read in isolation still carries its own context.
 */
function chunkSection(sectionLabel: string, blocks: ExtractionBlock[], maxChunkChars: number): ExtractionChunk[] {
  const chunks: ExtractionChunk[] = [];
  let current: ExtractionBlock[] = [];
  let currentChars = sectionLabel.length;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      sectionLabel,
      blockIds: current.map((b) => b.id),
      text: `${sectionLabel}\n\n${current.map((b) => b.text).join("\n\n")}`,
    });
    current = [];
    currentChars = sectionLabel.length;
  };

  for (const block of blocks) {
    if (currentChars + block.text.length > maxChunkChars && current.length > 0) {
      flush();
    }
    current.push(block);
    currentChars += block.text.length;
  }
  flush();
  return chunks;
}

/**
 * Plans claim-extraction chunks across a work's eligible blocks: sections
 * are ordered by importance, each section's own chunks never split a block
 * or cross a section boundary, and the plan stops adding whole sections once
 * `maxChunks` is reached — with one deliberate exception (see `sampled`
 * below) so the single highest-priority section is never entirely skipped
 * just because it alone exceeds the budget.
 *
 * `coverage`:
 *   - "full": every eligible section got at least one chunk.
 *   - "partial": some sections included in full, others excluded entirely
 *     because the chunk budget ran out before reaching them.
 *   - "sampled": the FIRST (highest-priority) section alone needed more
 *     chunks than the whole budget allows, so even that first section had to
 *     be truncated — extraction is working from a sample of one section
 *     rather than covering the document's breadth.
 */
export function planExtractionChunks(
  blocks: ExtractionBlock[],
  opts: PlanExtractionChunksOptions = {},
): ExtractionPlan {
  const maxChunkChars = opts.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;

  const eligible = blocks.filter((b) => (CLAIM_ELIGIBLE_BLOCK_KINDS as readonly string[]).includes(b.kind));

  const sectionOrder: string[] = [];
  const bySection = new Map<string, ExtractionBlock[]>();
  for (const b of eligible) {
    if (!bySection.has(b.sectionLabel)) {
      bySection.set(b.sectionLabel, []);
      sectionOrder.push(b.sectionLabel);
    }
    bySection.get(b.sectionLabel)!.push(b);
  }

  const orderedSections = [...sectionOrder].sort(
    (a, b) => sectionImportanceRank(a) - sectionImportanceRank(b),
  );

  const chunks: ExtractionChunk[] = [];
  const includedSections: string[] = [];
  const excludedSections: string[] = [];
  let sampled = false;

  for (const sectionLabel of orderedSections) {
    const remaining = maxChunks - chunks.length;
    if (remaining <= 0) {
      excludedSections.push(sectionLabel);
      continue;
    }
    const sectionChunks = chunkSection(sectionLabel, bySection.get(sectionLabel)!, maxChunkChars);
    if (sectionChunks.length <= remaining) {
      chunks.push(...sectionChunks);
      includedSections.push(sectionLabel);
    } else if (chunks.length === 0) {
      // Nothing included yet and the single highest-priority section alone
      // exceeds the budget — take a truncated sample of it (still never
      // splitting an individual block) rather than produce zero chunks.
      chunks.push(...sectionChunks.slice(0, remaining));
      includedSections.push(sectionLabel);
      sampled = true;
    } else {
      excludedSections.push(sectionLabel);
    }
  }

  const coverage: ExtractionCoverage = sampled ? "sampled" : excludedSections.length === 0 ? "full" : "partial";

  return { chunks, coverage, includedSections, excludedSections };
}
