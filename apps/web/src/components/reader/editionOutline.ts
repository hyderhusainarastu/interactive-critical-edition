import type { EditionPayload } from "./editionTypes";

export interface OutlineItem {
  id: string;
  label: string;
  pageIndex: number;
  level: 1 | 2;
}

/** Title/header blocks, in reading order — the reader's persistent outline
 * rail (`ReaderOutlineSidebar.tsx`, D-23-51) and this component's own
 * jump-to-block navigation (`activeBlockId`) both derive from this same
 * pure computation, so the two can never disagree about what the document's
 * sections are. */
export function computeOutline(blocks: EditionPayload["blocks"]): OutlineItem[] {
  return blocks
    .filter((block) => block.kind === "title" || block.kind === "header")
    .sort((a, b) => a.pageIndex - b.pageIndex || a.blockOrder - b.blockOrder)
    .map((block) => ({ id: block.id, label: block.text, pageIndex: block.pageIndex, level: block.kind === "title" ? 1 : 2 }));
}
