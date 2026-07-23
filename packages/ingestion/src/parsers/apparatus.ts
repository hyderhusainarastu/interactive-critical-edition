import { extractCitations } from "./citations";

export const AUTHOR_APPARATUS_KINDS = ["footnote", "endnote", "bibliography_entry", "citation_block"] as const;
export type AuthorApparatusKind = (typeof AUTHOR_APPARATUS_KINDS)[number];

export interface ApparatusBlockInput {
  blockId: string;
  kind: "title" | "header" | "body" | "footer" | "footnote" | "endnote" | "caption" | "bibliography" | "reference";
  text: string;
  marker?: string;
  pageIndex: number;
  blockOrder: number;
  /** D-20-89/D-20-91: true only when this block was supplied from the
   *  document's own text layer because GROBID's structural pass omitted it
   *  (see `endnoteRecovery.ts`) — never true for a block GROBID itself
   *  produced. Threaded through so downstream consumers (citation
   *  resolution) can tell recovered apparatus apart from GROBID-native
   *  apparatus. */
  recovered?: boolean;
}

export interface ExtractedAuthorApparatus {
  textBlockId: string | null;
  kind: AuthorApparatusKind;
  marker: string | null;
  text: string;
  scope: Record<string, unknown>;
  source: "structure" | "endnote-heading" | "citation-heuristic";
  /** D-20-91: mirrors `ApparatusBlockInput.recovered` — true only for an
   *  endnote this pipeline supplied from the text layer, not GROBID's own
   *  structural output. Always false for non-endnote kinds. */
  recovered: boolean;
}

const NOTE_HEADING = /^\s*(endnotes?|notes?)\s*:?\s*$/i;
const NEXT_SECTION_HEADING = /^\s*(references|bibliography|works\s+cited|appendix|chapter|part)\b/i;
const NOTE_MARKER = /^\s*(?:\[?(\d{1,4}|[ivxlcdm]+)[\].):]?\s+|(\*+)\s+)/i;

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Extract source-authored apparatus without asking a model to reconstruct it.
 * Structural blocks are preferred; heading/marker detection fills the common
 * PDF fallback gap, and citation candidates retain only text already present
 * in the work. Output is deliberately independent from reader annotations.
 */
export function extractAuthorApparatus(input: {
  blocks: readonly ApparatusBlockInput[];
  text: string;
  maxCitationBlocks?: number;
}): ExtractedAuthorApparatus[] {
  const output: ExtractedAuthorApparatus[] = [];
  const seen = new Set<string>();
  let inEndnotes = false;

  const add = (entry: ExtractedAuthorApparatus) => {
    const key = `${entry.kind}:${normalized(entry.text)}`;
    if (!entry.text.trim() || seen.has(key)) return;
    seen.add(key);
    output.push(entry);
  };

  for (const block of input.blocks) {
    if (block.kind === "header" || block.kind === "title") {
      if (NOTE_HEADING.test(block.text)) inEndnotes = true;
      else if (inEndnotes && NEXT_SECTION_HEADING.test(block.text)) inEndnotes = false;
    }

    const scope = { pageIndex: block.pageIndex, blockOrder: block.blockOrder };
    if (block.kind === "footnote") {
      const marker = block.marker ?? block.text.match(NOTE_MARKER)?.[1] ?? block.text.match(NOTE_MARKER)?.[2] ?? null;
      add({ textBlockId: block.blockId, kind: "footnote", marker, text: block.text, scope, source: "structure", recovered: Boolean(block.recovered) });
      continue;
    }
    if (block.kind === "endnote") {
      const marker = block.marker ?? block.text.match(NOTE_MARKER)?.[1] ?? block.text.match(NOTE_MARKER)?.[2] ?? null;
      add({ textBlockId: block.blockId, kind: "endnote", marker, text: block.text, scope, source: "structure", recovered: Boolean(block.recovered) });
      continue;
    }
    if (block.kind === "bibliography" || block.kind === "reference") {
      add({ textBlockId: block.blockId, kind: "bibliography_entry", marker: null, text: block.text, scope, source: "structure", recovered: false });
      continue;
    }
    if (inEndnotes && block.kind === "body") {
      const match = block.text.match(NOTE_MARKER);
      if (match) {
        add({
          textBlockId: block.blockId,
          kind: "endnote",
          marker: match[1] ?? match[2] ?? null,
          text: block.text,
          scope,
          source: "endnote-heading",
          recovered: false,
        });
      }
    }
  }

  for (const citation of extractCitations(input.text, input.maxCitationBlocks ?? 300)) {
    add({
      textBlockId: null,
      kind: "citation_block",
      marker: null,
      text: citation.text,
      scope: { citationKind: citation.kind },
      source: "citation-heuristic",
      recovered: false,
    });
  }

  return output;
}
