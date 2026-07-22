/**
 * Shared reading-prose typography scale (Phase 22.1, plan §22.2).
 *
 * The landing page's Reader showcase depicts body prose as serif at
 * 1.05rem with 1.7 line-height (`docs/baselines/phase-19/
 * landing-product-contract.md`) — that is the product's stated
 * reading-typography identity. This constant is the landing passage's
 * class list moved verbatim out of `page.tsx`; Phase 22.3's Reader parity
 * work (D-22-5: body prose lacks `font-serif` in both `EditionReader`
 * and `TextReader`) applies the same scale to the real reading column
 * from here rather than re-deriving it.
 *
 * Kept as a class-string constant (not a component): the two real readers
 * attach these styles to paragraphs they already render with their own
 * anchors/handlers, so a wrapper element would change their DOM.
 */
export const READING_PROSE_CLASS = "font-serif text-[1.05rem] leading-[1.7] text-[var(--color-text)]";
