/**
 * Passage-to-claim/evidence/map continuity (charter §16 journey 5):
 * reversible navigation back to the EXACT reader position, not just this
 * work's Reader in general. `#block-<id>` is already a real, load-bearing
 * anchor format (`packages/rag/src/index.ts` builds Ask Library citation
 * hrefs this exact way; `EditionReader`'s blocks already render
 * `id="block-<id>"`), and the claim permalink page's "Open in reader" link
 * now builds one too. This is the pure parse step `ReaderShell.tsx`'s lazy
 * `activeReaderBlockId` initializer calls — split out so the one piece of
 * real logic here (recognize the fragment, extract the id) is unit-testable
 * without a browser, matching this directory's own established
 * `matchClaimToBlock`/`matchNoteToBlock` precedent.
 */
const BLOCK_HASH_PREFIX = "#block-";

/** Returns the block id a `#block-<id>` URL fragment names, or `null` for
 *  any other fragment (including the empty string — no fragment at all) or
 *  an empty id (`#block-`, which names nothing). Never throws. */
export function parseReaderBlockHash(hash: string): string | null {
  if (!hash.startsWith(BLOCK_HASH_PREFIX)) return null;
  const id = hash.slice(BLOCK_HASH_PREFIX.length);
  return id.length > 0 ? id : null;
}
