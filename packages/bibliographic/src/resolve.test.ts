import { describe, expect, it, vi } from "vitest";
import { resolveCitation } from "./index";
import { bestTitleMatch, classifyCitationForm, titleOverlap, type BibliographicSource, type ResolvedRecord } from "./types";

function fakeSource(name: ResolvedRecord["source"], record: ResolvedRecord | null): BibliographicSource {
  return { name, search: vi.fn(async () => record) };
}

/**
 * A fake source that, unlike `fakeSource`/`trackedSource` above, actually
 * runs the query through `bestTitleMatch` against a small candidate list —
 * the same shape every real adapter (`openlibrary.ts`, `crossref.ts`, ...)
 * uses. A source that returns a fixed record regardless of what `query`
 * says can never demonstrate that a corrupted query fails to resolve; this
 * one can, since it genuinely rejects a candidate the query's own text
 * doesn't sufficiently overlap.
 */
function matchingSource(name: ResolvedRecord["source"], candidates: readonly ResolvedRecord[]): BibliographicSource {
  return {
    name,
    search: vi.fn(async (query: string) => bestTitleMatch(query, candidates, (r) => r.title)),
  };
}

/** A fake source that also records its own name into a shared call-order log,
 *  so ordering (not just which one eventually matched) can be asserted. */
function trackedSource(
  name: ResolvedRecord["source"],
  record: ResolvedRecord | null,
  log: ResolvedRecord["source"][],
): BibliographicSource {
  return {
    name,
    search: vi.fn(async () => {
      log.push(name);
      return record;
    }),
  };
}

const kant: ResolvedRecord = {
  source: "openalex",
  externalId: "W1",
  title: "Critique of Pure Reason",
  authors: "Immanuel Kant",
  year: 1781,
  doi: null,
  url: "https://openalex.org/W1",
  accessStatus: "open",
  raw: {},
};

describe("titleOverlap", () => {
  it("scores a strong match high and an unrelated title ~0", () => {
    expect(titleOverlap("Critique of Pure Reason", "Critique of Pure Reason")).toBe(1);
    expect(titleOverlap("Critique of Pure Reason", "The Gay Science")).toBeLessThan(0.34);
  });

  it("ignores short stopword-ish tokens", () => {
    // "of" is dropped; overlap computed on significant words only.
    expect(titleOverlap("The Ethics of Ambiguity", "Ethics of Ambiguity")).toBeGreaterThan(0.5);
  });
});

describe("resolveCitation", () => {
  it("returns the first source that yields a confident match", async () => {
    const crossref = fakeSource("crossref", null);
    const openalex = fakeSource("openalex", kant);
    const openlibrary = fakeSource("openlibrary", null);
    const r = await resolveCitation("Kant, Critique of Pure Reason", {
      sources: [crossref, openalex, openlibrary],
    });
    expect(r?.title).toBe("Critique of Pure Reason");
    expect(openlibrary.search).not.toHaveBeenCalled(); // short-circuits after a match
  });

  it("returns null when no source matches (citation stays unresolved, not guessed)", async () => {
    const r = await resolveCitation("An obscure unmatched reference here", {
      sources: [fakeSource("crossref", null), fakeSource("openalex", null)],
    });
    expect(r).toBeNull();
  });

  it("skips a throwing source and continues to the next", async () => {
    const throwing: BibliographicSource = {
      name: "crossref",
      search: vi.fn(async () => {
        throw new Error("network down");
      }),
    };
    const r = await resolveCitation("Kant Critique of Pure Reason", {
      sources: [throwing, fakeSource("openalex", kant)],
    });
    expect(r?.title).toBe("Critique of Pure Reason");
  });

  it("rejects a too-short query without hitting any source", async () => {
    const src = fakeSource("crossref", kant);
    const r = await resolveCitation("ibid.", { sources: [src] });
    expect(r).toBeNull();
    expect(src.search).not.toHaveBeenCalled();
  });

  // Classical-citation backstop, zero provider round-trips (see `types.ts`'s
  // `looksClassical` doc comment): the primary interception happens earlier
  // (the `@ice/ingestion` extraction gate, then apps/worker's dedicated
  // classical-resolution branch), so `resolveCitation` should never even be
  // reached for one of these in practice — this proves it never spends a
  // live provider call even so.
  it("never calls any source for a Bekker locus query, resolving null before the provider loop", async () => {
    const crossref = fakeSource("crossref", kant);
    const openalex = fakeSource("openalex", kant);
    const openlibrary = fakeSource("openlibrary", kant);
    const googlebooks = fakeSource("googlebooks", kant);
    const r = await resolveCitation("Aristotle, NE 1151a20-8", {
      sources: [crossref, openalex, openlibrary, googlebooks],
    });
    expect(r).toBeNull();
    expect(crossref.search).not.toHaveBeenCalled();
    expect(openalex.search).not.toHaveBeenCalled();
    expect(openlibrary.search).not.toHaveBeenCalled();
    expect(googlebooks.search).not.toHaveBeenCalled();
  });

  it("checks classification via rawText, same as the book/journal reordering path", async () => {
    const src = fakeSource("crossref", kant);
    const r = await resolveCitation("Aristotle Nicomachean Ethics 1151a20", {
      sources: [src],
      rawText: "NE 1151a20-8",
    });
    expect(r).toBeNull();
    expect(src.search).not.toHaveBeenCalled();
  });
});

// D-20-81: book-form and reference-work citations reliably failed
// resolution because the provider order was journal-centric (Crossref
// first, always). These tests cover the classifier, the widened
// best-of-N candidate scan, and the reordering it drives.
describe("classifyCitationForm", () => {
  it("classifies a quoted-title citation as journal-form", () => {
    // The NOTE_QUOTED shape from @ice/ingestion's extractCitations.
    expect(
      classifyCitationForm(
        'Brickhouse, Thomas C. and Nicholas D. Smith, "Does Aristotle Have a Consistent Account of Vice?" Review of Metaphysics 57 2003',
      ),
    ).toBe("journal");
  });

  it("classifies a venue-word citation as journal-form even without quotes", () => {
    expect(classifyCitationForm("Annas, Julia, Plato and Aristotle on Friendship, Mind 86 1977")).toBe("journal");
  });

  it("classifies a publisher-bearing book citation as book-form", () => {
    // The NOTE_BOOK shape, or a structural bibliography entry never
    // wrapped in parens (so cleanQuery's collapse never touched it).
    expect(classifyCitationForm("Bostock, David. Aristotle's Ethics. Oxford: Oxford University Press, 2000.")).toBe(
      "book",
    );
  });

  it("classifies a lexicon/critical-edition citation as book-form", () => {
    expect(classifyCitationForm("Liddell, H.G. and R. Scott, A Greek-English Lexicon, Clarendon Press")).toBe("book");
    expect(classifyCitationForm("Bywater, Ingram, ed., Aristotelis Ethica Nicomachea, Clarendon Press")).toBe("book");
  });

  it("classifies a plain author-year query with no signal as unknown", () => {
    expect(classifyCitationForm("Kant, Critique of Pure Reason")).toBe("unknown");
  });

  // Bekker/Stephanus classical-citation backstop (see `types.ts`'s
  // `looksClassical` doc comment): duplicated, narrower detection than
  // `@ice/ingestion`'s full recognizer, checked FIRST so a locus citation is
  // never mistaken for book- or journal-form.
  it("classifies a Bekker locus citation as classical, ahead of book/journal", () => {
    expect(classifyCitationForm("NE 1103a15")).toBe("classical");
    expect(classifyCitationForm("Pol. 1252a1")).toBe("classical");
  });

  it("classifies a Stephanus (Plato) locus citation as classical", () => {
    expect(classifyCitationForm("Plato, Rep. 514a")).toBe("classical");
  });

  it("does not classify an abbreviation-shaped word or a bare number alone as classical (needs both signals)", () => {
    expect(classifyCitationForm("NE plans for next quarter")).not.toBe("classical");
    expect(classifyCitationForm("Bostock, David. Aristotle's Ethics. Oxford: Oxford University Press, 2000.")).toBe("book");
  });
});

describe("bestTitleMatch", () => {
  it("picks the highest-overlap candidate that clears the threshold, not just the first", () => {
    const items = [
      { title: "Some unrelated review essay" }, // rank 1, low overlap
      { title: "A different weakness-of-will survey" }, // rank 2, low overlap
      { title: "Does Aristotle Have a Consistent Account of Vice?" }, // rank 3, true match
    ];
    const match = bestTitleMatch(
      "Does Aristotle Have a Consistent Account of Vice",
      items,
      (i) => i.title,
    );
    expect(match?.title).toBe("Does Aristotle Have a Consistent Account of Vice?");
  });

  it("still rejects every candidate when none clears the threshold (guard not loosened)", () => {
    const items = [{ title: "The Gay Science" }, { title: "Being and Time" }, { title: "Fear and Trembling" }];
    expect(bestTitleMatch("Critique of Pure Reason", items, (i) => i.title)).toBeNull();
  });

  it("skips items with no title at all", () => {
    const items = [{ title: undefined }, { title: "Critique of Pure Reason" }];
    expect(bestTitleMatch("Critique of Pure Reason", items, (i) => i.title)?.title).toBe("Critique of Pure Reason");
  });
});

describe("resolveCitation — D-20-81 provider ordering by citation form", () => {
  it("queries book catalogues before Crossref/OpenAlex for a book-form citation", async () => {
    const log: ResolvedRecord["source"][] = [];
    const bostock: ResolvedRecord = {
      source: "openlibrary",
      externalId: "/works/OL1W",
      title: "Aristotle's Ethics",
      authors: "David Bostock",
      year: 2000,
      doi: null,
      url: "https://openlibrary.org/works/OL1W",
      accessStatus: "metadata_only",
      raw: {},
    };
    const crossref = trackedSource("crossref", null, log);
    const openalex = trackedSource("openalex", null, log);
    const openlibrary = trackedSource("openlibrary", bostock, log);
    const googlebooks = trackedSource("googlebooks", null, log);

    const r = await resolveCitation("Bostock, David. Aristotle's Ethics. Oxford: Oxford University Press, 2000.", {
      sources: [crossref, openalex, openlibrary, googlebooks],
    });

    expect(r?.title).toBe("Aristotle's Ethics");
    // Book-form order is openlibrary, googlebooks, openalex, crossref — the
    // match at openlibrary short-circuits before crossref/openalex are ever
    // asked at all (old order would have burned both first).
    expect(log).toEqual(["openlibrary"]);
    expect(crossref.search).not.toHaveBeenCalled();
    expect(openalex.search).not.toHaveBeenCalled();
  });

  it("falls through book-order to Google Books when Open Library has no record (Bywater/Liddell & Scott shape)", async () => {
    const log: ResolvedRecord["source"][] = [];
    const bywater: ResolvedRecord = {
      source: "googlebooks",
      externalId: "9780198140260",
      title: "Aristotelis Ethica Nicomachea",
      authors: "Ingram Bywater",
      year: 1894,
      doi: null,
      url: "https://books.google.com/books?id=xyz",
      accessStatus: "metadata_only",
      raw: {},
    };
    const crossref = trackedSource("crossref", null, log);
    const openalex = trackedSource("openalex", null, log);
    const openlibrary = trackedSource("openlibrary", null, log);
    const googlebooks = trackedSource("googlebooks", bywater, log);

    const r = await resolveCitation("Bywater, Ingram, ed., Aristotelis Ethica Nicomachea, Clarendon Press", {
      sources: [crossref, openalex, openlibrary, googlebooks],
    });

    expect(r?.title).toBe("Aristotelis Ethica Nicomachea");
    expect(log).toEqual(["openlibrary", "googlebooks"]);
    expect(crossref.search).not.toHaveBeenCalled();
    expect(openalex.search).not.toHaveBeenCalled();
  });

  it("keeps Crossref first, unchanged, for a journal-form citation", async () => {
    const log: ResolvedRecord["source"][] = [];
    const brickhouse: ResolvedRecord = {
      source: "crossref",
      externalId: "10.5840/xyz",
      title: "Does Aristotle Have a Consistent Account of Vice?",
      authors: "Thomas C. Brickhouse, Nicholas D. Smith",
      year: 2003,
      doi: "10.5840/xyz",
      url: "https://doi.org/10.5840/xyz",
      accessStatus: "subscription",
      raw: {},
    };
    const crossref = trackedSource("crossref", brickhouse, log);
    const openalex = trackedSource("openalex", null, log);
    const openlibrary = trackedSource("openlibrary", null, log);
    const googlebooks = trackedSource("googlebooks", null, log);

    const r = await resolveCitation(
      'Brickhouse, Thomas C. and Nicholas D. Smith, "Does Aristotle Have a Consistent Account of Vice?" Review of Metaphysics 57 2003',
      { sources: [crossref, openalex, openlibrary, googlebooks] },
    );

    expect(r?.title).toBe("Does Aristotle Have a Consistent Account of Vice?");
    expect(log).toEqual(["crossref"]);
  });

  it("keeps the default Crossref-first order for a form-ambiguous query (regression)", async () => {
    const log: ResolvedRecord["source"][] = [];
    const crossref = trackedSource("crossref", null, log);
    const openalex = trackedSource("openalex", kant, log);
    const openlibrary = trackedSource("openlibrary", null, log);

    const r = await resolveCitation("Kant, Critique of Pure Reason", {
      sources: [crossref, openalex, openlibrary],
    });

    expect(r?.title).toBe("Critique of Pure Reason");
    expect(log).toEqual(["crossref", "openalex"]);
    expect(openlibrary.search).not.toHaveBeenCalled();
  });

  it("never drops a provider — book-form still falls back to Crossref/OpenAlex if book catalogues miss", async () => {
    const log: ResolvedRecord["source"][] = [];
    const openlibrary = trackedSource("openlibrary", null, log);
    const googlebooks = trackedSource("googlebooks", null, log);
    const openalex = trackedSource("openalex", null, log);
    const crossref = trackedSource("crossref", kant, log);

    const r = await resolveCitation("Some Book Title, University Press, 1990", {
      sources: [crossref, openalex, openlibrary, googlebooks],
    });

    expect(r?.title).toBe("Critique of Pure Reason");
    expect(log).toEqual(["openlibrary", "googlebooks", "openalex", "crossref"]);
  });

  it("classifies via opts.rawText when cleanQuery already stripped the book-form signal from the query (the real NOTE_BOOK shape)", async () => {
    // @ice/ingestion's cleanQuery deliberately collapses a footnote-style
    // citation's publisher parenthetical down to just its year (its own
    // comment: "publisher tokens swamp the title"), so the normalizedQuery
    // that actually reaches resolveCitation in production has NO book-form
    // marker left at all for a generically-titled work like this one —
    // only the verbatim rawText still carries "Press".
    const log: ResolvedRecord["source"][] = [];
    const bostock: ResolvedRecord = {
      source: "openlibrary",
      externalId: "/works/OL1W",
      title: "Aristotle's Ethics",
      authors: "David Bostock",
      year: 2000,
      doi: null,
      url: "https://openlibrary.org/works/OL1W",
      accessStatus: "metadata_only",
      raw: {},
    };
    const crossref = trackedSource("crossref", null, log);
    const openalex = trackedSource("openalex", null, log);
    const openlibrary = trackedSource("openlibrary", bostock, log);
    const googlebooks = trackedSource("googlebooks", null, log);

    const cleanedQuery = "David Bostock, Aristotle's Ethics 2000"; // no "Press" survives
    const rawText = "David Bostock, Aristotle's Ethics (Oxford: Oxford University Press, 2000)";

    const r = await resolveCitation(cleanedQuery, {
      sources: [crossref, openalex, openlibrary, googlebooks],
      rawText,
    });

    expect(r?.title).toBe("Aristotle's Ethics");
    expect(log).toEqual(["openlibrary"]);
    expect(crossref.search).not.toHaveBeenCalled();
    expect(openalex.search).not.toHaveBeenCalled();
  });

  // D-20-84: on the real baseline_test Roochnik "Vicious Man" fixture,
  // GROBID's own biblStruct segmentation fused the ADJACENT Brickhouse
  // journal-article citation into the Liddell & Scott lexicon entry through
  // two distinct channels — its <note> residual field carried Brickhouse's
  // essay title verbatim, and its own <author> field carried a bare
  // ("Brickhouse", no forename) echo of Brickhouse's name. Both are fixed in
  // `@ice/ingestion`'s `parseTei` (see grobid.test.ts's D-20-84 fixtures).
  // These two tests use `matchingSource`, which runs the query through the
  // real `bestTitleMatch` guard (unlike `fakeSource`/`trackedSource` above,
  // which return a fixed record regardless of query content) — so they
  // demonstrate the actual resolution outcome, not just provider ordering.
  const liddellScott: ResolvedRecord = {
    source: "openlibrary",
    externalId: "/works/OL2W",
    title: "Liddell and Scott's Greek-English Lexicon",
    authors: "Henry George Liddell, Robert Scott",
    year: 1940,
    doi: null,
    url: "https://openlibrary.org/works/OL2W",
    accessStatus: "metadata_only",
    raw: {},
  };

  it("fails to resolve the pre-fix, fully-contaminated Liddell & Scott query (both channels present)", async () => {
    // Both contamination channels present: the <note>-field essay title AND
    // the bare-surname author bleed — the actual query text this citation
    // would have produced before ANY part of D-20-84 was fixed.
    const query =
      "These translations are all found in the standard Greek-English Lexicon of Brickhouse Liddell and Scott 18 Does Aristotle Have a Consistent Account of Vice? 20";
    const r = await resolveCitation(query, {
      sources: [
        matchingSource("crossref", []),
        matchingSource("openalex", []),
        matchingSource("openlibrary", [liddellScott]),
        matchingSource("googlebooks", []),
      ],
    });
    // The real candidate exists in the catalogue, but the query is too
    // polluted with the wrong work's words for `bestTitleMatch` to accept it
    // — exactly the "unresolvable regardless of provider order" defect.
    expect(r).toBeNull();
  });

  it("resolves the post-fix (contamination-free) Liddell & Scott lexicon query via the book-catalogue order", async () => {
    const log: ResolvedRecord["source"][] = [];
    const crossref = trackedSource("crossref", null, log);
    const openalex = trackedSource("openalex", null, log);
    const openlibrary: BibliographicSource = {
      name: "openlibrary",
      search: vi.fn(async (query: string) => {
        log.push("openlibrary");
        return bestTitleMatch(query, [liddellScott], (r) => r.title);
      }),
    };
    const googlebooks = trackedSource("googlebooks", null, log);

    // The actual query text `@ice/ingestion`'s fixed `parseTei` now produces
    // for this same real citation — no Brickhouse title, no Brickhouse
    // author, no double-year date artifact.
    const query = "These translations are all found in the standard Greek-English Lexicon of Liddell and Scott 18 20";
    const r = await resolveCitation(query, { sources: [crossref, openalex, openlibrary, googlebooks] });

    expect(r?.title).toBe("Liddell and Scott's Greek-English Lexicon");
    // "Greek-English"/"Lexicon" route this through the book-catalogue order,
    // same as the clean equivalent citation form already covered above.
    expect(log).toEqual(["openlibrary"]);
    expect(crossref.search).not.toHaveBeenCalled();
    expect(openalex.search).not.toHaveBeenCalled();
  });

  it("still returns null (stays honestly unresolved) when every reordered source misses", async () => {
    const r = await resolveCitation("Bostock, David. Aristotle's Ethics. Oxford: Oxford University Press, 2000.", {
      sources: [fakeSource("crossref", null), fakeSource("openalex", null), fakeSource("openlibrary", null)],
    });
    expect(r).toBeNull();
  });
});
