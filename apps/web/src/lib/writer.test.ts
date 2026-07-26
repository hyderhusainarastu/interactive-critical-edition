import assert from "node:assert/strict";
import {
  buildCslFromCorpusItemFields,
  buildCslFromWorkBibliographicFields,
  buildEvidenceBlockquote,
  buildEvidenceMarker,
  proseMirrorDocumentSchema,
  proseMirrorToPlainText,
} from "./writer";

// Plain node:assert, run ad hoc via tsx — the `matchNoteToBlock.test.ts`
// convention (apps/web has no vitest wiring, tracked as D-25-6).

// -----------------------------------------------------------------------
// Phase 28.5: CSL-from-work construction honesty. A bare title must never
// be treated as a resolvable bibliographic identity — the writer_citation
// insertion path relies on `null` here to mean "show the 'citation
// unresolved' marker, write no citation row."
// -----------------------------------------------------------------------

// A bare title with no author/year/DOI/URL is NOT a resolvable identity.
assert.equal(
  buildCslFromWorkBibliographicFields({ title: "Some Book", authors: null, year: null, doi: null, url: null }),
  null,
);

// An author alone is enough real signal to resolve.
{
  const csl = buildCslFromWorkBibliographicFields({ title: "Nicomachean Ethics", authors: "Aristotle", year: null, doi: null, url: null });
  assert.ok(csl, "author-only fields should resolve to a citation");
  assert.equal(csl!.title, "Nicomachean Ethics");
  assert.deepEqual(csl!.author, [{ literal: "Aristotle" }]);
  assert.equal(csl!.issued, undefined);
}

// A year/DOI alone (no author) also resolves — never model-invented, but
// never gated on author presence specifically either.
{
  const csl = buildCslFromWorkBibliographicFields({ title: "Some Article", authors: null, year: 1999, doi: "10.1/x", url: null });
  assert.ok(csl, "year+doi fields should resolve to a citation");
  assert.equal(csl!.issued?.["date-parts"]?.[0]?.[0], 1999);
  assert.equal(csl!.DOI, "10.1/x");
}

// Corpus items: no provider-supplied signal beyond a title -> unresolved.
assert.equal(
  buildCslFromCorpusItemFields({ title: "Some Paper", authors: [], year: null, doi: null, url: null, venue: null }),
  null,
);
assert.equal(
  buildCslFromCorpusItemFields({ title: "Some Paper", authors: "not-an-array" as unknown, year: null, doi: null, url: null, venue: null }),
  null,
);

// Real provider-supplied authors resolve, and non-string entries are
// dropped rather than guessed at.
{
  const csl = buildCslFromCorpusItemFields({ title: "A Paper", authors: ["Jane Doe", 42, null, "John Roe"], year: 2020, doi: null, url: null, venue: "Journal of Things" });
  assert.ok(csl, "provider-supplied authors should resolve to a citation");
  assert.deepEqual(csl!.author, [{ literal: "Jane Doe" }, { literal: "John Roe" }]);
  assert.equal(csl!["container-title"], "Journal of Things");
}

// -----------------------------------------------------------------------
// Attr shapes: the evidence blockquote node, and the schema widening that
// keeps a document containing one from silently round-tripping to "".
// -----------------------------------------------------------------------

{
  const block = buildEvidenceBlockquote({ researchClaimId: "11111111-1111-4111-8111-111111111111", excerpt: "an incomplete practical syllogism", workTitle: "Nicomachean Ethics" });
  assert.equal(block.type, "blockquote");
  assert.deepEqual(block.attrs, { researchClaimId: "11111111-1111-4111-8111-111111111111", excerpt: "an incomplete practical syllogism", workTitle: "Nicomachean Ethics" });
  assert.deepEqual(block.content, [{ type: "text", text: "an incomplete practical syllogism" }]);
}

// `workTitle` is honestly nullable (a corpus-item-sourced claim may have no
// owned work at all).
{
  const block = buildEvidenceBlockquote({ researchClaimId: "22222222-2222-4222-8222-222222222222", excerpt: "weakness of will", workTitle: null });
  assert.equal((block.attrs as { workTitle: string | null }).workTitle, null);
}

assert.deepEqual(buildEvidenceMarker("[Citation unresolved]"), { type: "paragraph", content: [{ type: "text", text: "[Citation unresolved]" }] });

// A document containing an evidence blockquote must validate — this is the
// regression the schema widening exists to prevent. Before it, ANY document
// with a blockquote carrying `{researchClaimId, excerpt, workTitle}` attrs
// failed `.strict()` validation, and `proseMirrorToPlainText` (which
// swallows a parse failure into `""`) would have silently blanked the WHOLE
// draft, not just dropped the quote.
{
  const doc = {
    type: "doc" as const,
    content: [
      { type: "paragraph" as const, content: [{ type: "text" as const, text: "Some prose before the quote." }] },
      buildEvidenceBlockquote({ researchClaimId: "33333333-3333-4333-8333-333333333333", excerpt: "quoted evidence", workTitle: "A Work" }),
      buildEvidenceMarker("[Passage not currently locatable in the source text.]"),
    ],
  };
  const parsed = proseMirrorDocumentSchema.safeParse(doc);
  assert.equal(parsed.success, true, "a document with an evidence blockquote must validate");
  assert.equal(
    proseMirrorToPlainText(doc),
    "Some prose before the quote.\nquoted evidence\n[Passage not currently locatable in the source text.]",
  );
}

// A heading's own `{level}` attrs shape still validates unchanged.
assert.equal(
  proseMirrorDocumentSchema.safeParse({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] }] }).success,
  true,
);

// A malformed evidence-shaped attrs object (missing `researchClaimId`, not
// a valid uuid) must still be rejected — the widening is additive, not a
// blanket bypass of validation.
assert.equal(
  proseMirrorDocumentSchema.safeParse({ type: "doc", content: [{ type: "blockquote", attrs: { excerpt: "x", workTitle: null }, content: [{ type: "text", text: "x" }] }] }).success,
  false,
);
assert.equal(
  proseMirrorDocumentSchema.safeParse({ type: "doc", content: [{ type: "blockquote", attrs: { researchClaimId: "not-a-uuid", excerpt: "x", workTitle: null }, content: [{ type: "text", text: "x" }] }] }).success,
  false,
);
