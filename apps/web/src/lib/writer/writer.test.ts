import { describe, expect, it } from "vitest";
import {
  buildCslFromCorpusItemFields,
  buildCslFromWorkBibliographicFields,
  buildEvidenceBlockquote,
  buildEvidenceMarker,
  proseMirrorDocumentSchema,
  proseMirrorToPlainText,
} from "@/lib/writer";

// Plain node:assert, run ad hoc via tsx — the `matchNoteToBlock.test.ts`
// convention (apps/web has no vitest wiring, tracked as D-25-6).

// -----------------------------------------------------------------------
// Phase 28.5: CSL-from-work construction honesty. A bare title must never
// be treated as a resolvable bibliographic identity — the writer_citation
// insertion path relies on `null` here to mean "show the 'citation
// unresolved' marker, write no citation row."
// -----------------------------------------------------------------------

describe("CSL construction honesty", () => {
  // A bare title with no author/year/DOI/URL is NOT a resolvable identity.
  it("treats a bare title with no author/year/DOI/URL as not a resolvable identity", () => {
    expect(buildCslFromWorkBibliographicFields({ title: "Some Book", authors: null, year: null, doi: null, url: null })).toBe(null);
  });

  // An author alone is enough real signal to resolve.
  it("author-only fields should resolve to a citation", () => {
    const csl = buildCslFromWorkBibliographicFields({ title: "Nicomachean Ethics", authors: "Aristotle", year: null, doi: null, url: null });
    expect(csl).toBeTruthy();
    expect(csl!.title).toBe("Nicomachean Ethics");
    expect(csl!.author).toEqual([{ literal: "Aristotle" }]);
    expect(csl!.issued).toBe(undefined);
  });

  // A year/DOI alone (no author) also resolves — never model-invented, but
  // never gated on author presence specifically either.
  it("year+doi fields should resolve to a citation", () => {
    const csl = buildCslFromWorkBibliographicFields({ title: "Some Article", authors: null, year: 1999, doi: "10.1/x", url: null });
    expect(csl).toBeTruthy();
    expect(csl!.issued?.["date-parts"]?.[0]?.[0]).toBe(1999);
    expect(csl!.DOI).toBe("10.1/x");
  });

  // Corpus items: no provider-supplied signal beyond a title -> unresolved.
  it("leaves a corpus item with no provider-supplied signal beyond a title unresolved", () => {
    expect(buildCslFromCorpusItemFields({ title: "Some Paper", authors: [], year: null, doi: null, url: null, venue: null })).toBe(null);
    expect(
      buildCslFromCorpusItemFields({ title: "Some Paper", authors: "not-an-array" as unknown, year: null, doi: null, url: null, venue: null }),
    ).toBe(null);
  });

  // Real provider-supplied authors resolve, and non-string entries are
  // dropped rather than guessed at.
  it("provider-supplied authors should resolve to a citation", () => {
    const csl = buildCslFromCorpusItemFields({ title: "A Paper", authors: ["Jane Doe", 42, null, "John Roe"], year: 2020, doi: null, url: null, venue: "Journal of Things" });
    expect(csl).toBeTruthy();
    expect(csl!.author).toEqual([{ literal: "Jane Doe" }, { literal: "John Roe" }]);
    expect(csl!["container-title"]).toBe("Journal of Things");
  });
});

// -----------------------------------------------------------------------
// Attr shapes: the evidence blockquote node, and the schema widening that
// keeps a document containing one from silently round-tripping to "".
// -----------------------------------------------------------------------

describe("evidence node attr shapes and schema widening", () => {
  it("builds an evidence blockquote carrying its claim id, excerpt and work title", () => {
    const block = buildEvidenceBlockquote({ researchClaimId: "11111111-1111-4111-8111-111111111111", excerpt: "an incomplete practical syllogism", workTitle: "Nicomachean Ethics" });
    expect(block.type).toBe("blockquote");
    expect(block.attrs).toEqual({ researchClaimId: "11111111-1111-4111-8111-111111111111", excerpt: "an incomplete practical syllogism", workTitle: "Nicomachean Ethics" });
    expect(block.content).toEqual([{ type: "text", text: "an incomplete practical syllogism" }]);
  });

  // `workTitle` is honestly nullable (a corpus-item-sourced claim may have no
  // owned work at all).
  it("keeps workTitle honestly nullable, since a corpus-item-sourced claim may have no owned work", () => {
    const block = buildEvidenceBlockquote({ researchClaimId: "22222222-2222-4222-8222-222222222222", excerpt: "weakness of will", workTitle: null });
    expect((block.attrs as { workTitle: string | null }).workTitle).toBe(null);
  });

  it("builds an evidence marker paragraph", () => {
    expect(buildEvidenceMarker("[Citation unresolved]")).toEqual({ type: "paragraph", content: [{ type: "text", text: "[Citation unresolved]" }] });
  });

  // A document containing an evidence blockquote must validate — this is the
  // regression the schema widening exists to prevent. Before it, ANY document
  // with a blockquote carrying `{researchClaimId, excerpt, workTitle}` attrs
  // failed `.strict()` validation, and `proseMirrorToPlainText` (which
  // swallows a parse failure into `""`) would have silently blanked the WHOLE
  // draft, not just dropped the quote.
  it("a document with an evidence blockquote must validate", () => {
    const doc = {
      type: "doc" as const,
      content: [
        { type: "paragraph" as const, content: [{ type: "text" as const, text: "Some prose before the quote." }] },
        buildEvidenceBlockquote({ researchClaimId: "33333333-3333-4333-8333-333333333333", excerpt: "quoted evidence", workTitle: "A Work" }),
        buildEvidenceMarker("[Passage not currently locatable in the source text.]"),
      ],
    };
    const parsed = proseMirrorDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    expect(proseMirrorToPlainText(doc)).toBe(
      "Some prose before the quote.\nquoted evidence\n[Passage not currently locatable in the source text.]",
    );
  });

  // A heading's own `{level}` attrs shape still validates unchanged.
  it("still validates a heading's own {level} attrs shape unchanged", () => {
    expect(
      proseMirrorDocumentSchema.safeParse({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] }] }).success,
    ).toBe(true);
  });

  // A malformed evidence-shaped attrs object (missing `researchClaimId`, not
  // a valid uuid) must still be rejected — the widening is additive, not a
  // blanket bypass of validation.
  it("still rejects a malformed evidence-shaped attrs object, since the widening is additive", () => {
    expect(
      proseMirrorDocumentSchema.safeParse({ type: "doc", content: [{ type: "blockquote", attrs: { excerpt: "x", workTitle: null }, content: [{ type: "text", text: "x" }] }] }).success,
    ).toBe(false);
    expect(
      proseMirrorDocumentSchema.safeParse({ type: "doc", content: [{ type: "blockquote", attrs: { researchClaimId: "not-a-uuid", excerpt: "x", workTitle: null }, content: [{ type: "text", text: "x" }] }] }).success,
    ).toBe(false);
  });
});
