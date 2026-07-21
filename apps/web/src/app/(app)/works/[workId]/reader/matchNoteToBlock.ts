import { findQuoteOffset } from "./highlightDom";

export interface NoteBlockMatch {
  noteId: string;
  blockId: string;
  quote: string;
  offset: number;
}

/**
 * Generated critical notes do not carry a DB-enforced text_block_id. Recompute
 * a conservative client-side anchor from their evidence quote: exactly one
 * matching block is enough to render a visibly-inferred marker; zero or
 * multiple block matches stay sidebar-only.
 */
export function matchNoteToBlock(
  note: { id: string; evidence: { quote: string | null } | null },
  blocks: Array<{ id: string; text: string }>,
): NoteBlockMatch | null {
  const quote = note.evidence?.quote?.trim();
  if (!quote) return null;

  const matches = blocks
    .map((block) => ({ blockId: block.id, offset: findQuoteOffset(block.text, quote, "", "") }))
    .filter((match): match is { blockId: string; offset: number } => match.offset !== null);

  if (matches.length !== 1) return null;
  return { noteId: note.id, blockId: matches[0].blockId, quote, offset: matches[0].offset };
}
