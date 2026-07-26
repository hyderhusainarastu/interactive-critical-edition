import { describe, expect, it } from "vitest";
import { extractCitationMentions, extractCitations, splitNoteEntries } from "./citations";

const WITH_BIBLIOGRAPHY = `The Question of Being

Heidegger's project reopens a question the tradition had let fall dormant.

References

1. Kant, Immanuel. Critique of Pure Reason. 1781. pp. 100-200.
2. Husserl, Edmund. Logical Investigations. 1900.
Verene, Donald Phillip. Vico's Science of Imagination. Cornell University Press, 1981.
`;

const WITH_INLINE = `Vico's account of imagination has been read many ways (Verene 1981). Others
locate its roots in earlier rhetoric. Berlin (1976) offers a contrasting reading
of the same material, emphasizing historicism over poetics.

There is no formal bibliography in this excerpt.
`;

describe("extractCitations", () => {
  it("pulls entries out of a References section, numbering and page ranges stripped", () => {
    const cites = extractCitations(WITH_BIBLIOGRAPHY);
    const queries = cites.map((c) => c.query);
    expect(queries.some((q) => q.startsWith("Kant, Immanuel. Critique of Pure Reason"))).toBe(true);
    // trailing "pp. 100-200" is removed from the lookup query
    expect(cites.find((c) => c.query.includes("Critique of Pure Reason"))?.query).not.toMatch(/pp?\./i);
    expect(queries.some((q) => q.includes("Logical Investigations"))).toBe(true);
    expect(queries.some((q) => q.includes("Vico's Science of Imagination"))).toBe(true);
    expect(cites.every((c) => c.kind === "reference")).toBe(true);
  });

  it("catches inline author–year citations when there is no bibliography", () => {
    const cites = extractCitations(WITH_INLINE);
    expect(cites.length).toBeGreaterThan(0);
    expect(cites.some((c) => c.text.includes("Verene") && c.kind === "inline")).toBe(true);
    expect(cites.some((c) => c.text.includes("Berlin"))).toBe(true);
  });

  it("returns nothing for prose with no citations", () => {
    expect(extractCitations("Just some ordinary paragraphs. Nothing to cite here at all.")).toEqual([]);
  });

  it("de-duplicates and respects the max cap", () => {
    const many = "References\n\n" + Array.from({ length: 40 }, (_, i) => `Author ${i}. Some Work Title ${i}. ${1900 + i}.`).join("\n");
    const cites = extractCitations(many, 10);
    expect(cites.length).toBeLessThanOrEqual(10);
  });

  it("ignores a bare 'ibid.' as too noisy to resolve", () => {
    const cites = extractCitations("Notes\n\nibid.\n\nKant, Critique of Pure Reason, 1781.");
    expect(cites.some((c) => /^ibid/i.test(c.query))).toBe(false);
  });
});

describe("note-style citations (footnote apparatus, no reference list)", () => {
  // Measured on a real production run: a 2001 philosophy article cited
  // entirely in numbered footnotes yielded ZERO citations, because both the
  // reference-section pass and the author–year pass assume conventions it does
  // not use. GROBID could not help — it found 4 notes of roughly forty and no
  // bibliography, there being no bibliography to find.
  const irwinNotes = [
    'A more carefully defended statement of the view that Aristotle is inconsistent appears in Julia Annas, "Plato and Aristotle on Friendship and Altruism," Mind 86 (1977), pp. 532-554.',
    "Her argument is criticized by Sarah Broadie, Ethics with Aristotle (Oxford: Oxford University Press, 1991), p. 177n41.",
    "See W.F.R. Hardie, Aristotle's Ethical Theory, ed. 2 (Oxford: Oxford University Press, 1980), ch. 3.",
    "David Charles, Aristotle's Philosophy of Action (London: Duckworth, 1984).",
  ].join("\n\n");

  it("extracts a journal citation with a quoted title", () => {
    const found = extractCitations(irwinNotes);
    expect(found.some((c) => /Annas/.test(c.query) && /Friendship and Altruism/.test(c.query))).toBe(true);
  });

  it("extracts a book citation with a publisher parenthetical", () => {
    const found = extractCitations(irwinNotes);
    expect(found.some((c) => /Broadie/.test(c.query) && /Ethics with Aristotle/.test(c.query))).toBe(true);
    expect(found.some((c) => /Charles/.test(c.query) && /Philosophy of Action/.test(c.query))).toBe(true);
  });

  it("strips the signal word that introduces a note citation", () => {
    const found = extractCitations(irwinNotes);
    const hardie = found.find((c) => /Hardie/.test(c.query));
    expect(hardie).toBeDefined();
    // "See W.F.R. Hardie, …" — the cue must not be treated as part of the author.
    expect(hardie!.query.startsWith("See ")).toBe(false);
    expect(hardie!.query).toMatch(/^W\.F\.R\. Hardie/);
  });

  it("classifies note citations as reference entries, not loose mentions", () => {
    const found = extractCitations(irwinNotes);
    expect(found.filter((c) => c.kind === "reference").length).toBeGreaterThanOrEqual(4);
  });

  it("finds note citations anywhere in the text, not only before a heading", () => {
    // Footnotes sit at page bottoms, so extracted text interleaves them with
    // body prose — they are not confined to a trailing section.
    const interleaved = `Some body prose about virtue.\n\n${irwinNotes}\n\nMore body prose about vice.`;
    expect(extractCitations(interleaved).length).toBeGreaterThanOrEqual(4);
  });

  it("does not mistake ordinary prose with a year for a citation", () => {
    const prose = "Aristotle argues in the Ethics that virtue is a mean, and Broadie discusses this at length.";
    const found = extractCitations(prose);
    expect(found.some((c) => /Broadie/.test(c.query))).toBe(false);
  });
});

describe("note citations survive line wrapping", () => {
  it("finds a citation whose title wraps across a line break", () => {
    // Real extracted text is per-page and keeps its line breaks. Matching the
    // raw text lost citations purely to a newline inside the title.
    const wrapped =
      "Her argument is criticized by Sarah Broadie, Ethics with\nAristotle (Oxford: Oxford University Press, 1991), p. 177n41.";
    const found = extractCitations(wrapped);
    expect(found.some((c) => /Broadie/.test(c.query) && /Ethics with Aristotle/.test(c.query))).toBe(true);
  });

  it("collapses the wrapped citation to a single-line query", () => {
    const wrapped = "David Charles, Aristotle's Philosophy\nof Action (London: Duckworth, 1984).";
    const q = extractCitations(wrapped).find((c) => /Charles/.test(c.query));
    expect(q).toBeDefined();
    expect(q!.query).not.toContain("\n");
    expect(q!.query).toContain("Aristotle's Philosophy of Action");
  });
});

describe("citation query strings are shaped for catalogue lookup", () => {
  it("collapses a publisher imprint to its year", () => {
    // Imprint tokens swamp the title in catalogue search. Measured against
    // real note citations, searching the full string found 1 of 9 cited works.
    const found = extractCitations("Sarah Broadie, Ethics with Aristotle (Oxford: Oxford University Press, 1991), p. 177n41.");
    const q = found.find((c) => /Broadie/.test(c.query));
    expect(q).toBeDefined();
    expect(q!.query).toBe("Sarah Broadie, Ethics with Aristotle 1991");
    expect(q!.query).not.toMatch(/University Press/);
    // The verbatim text is preserved separately for gate matching.
    expect(q!.text).toMatch(/Oxford University Press/);
  });

  it("keeps a journal citation's volume and year", () => {
    const q = extractCitations('Julia Annas, "Plato and Aristotle on Friendship and Altruism," Mind 86 (1977), pp. 532-554.')
      .find((c) => /Annas/.test(c.query));
    expect(q!.query).toContain("Mind 86");
    expect(q!.query).toContain("1977");
  });
});

describe("inline citations are never emitted malformed", () => {
  it("unwraps a parenthesised citation but leaves a narrative one intact", () => {
    const found = extractCitations("As argued (Kant 1781), the point stands. Irwin (2001) disagrees.");
    const kant = found.find((c) => /Kant/.test(c.query));
    expect(kant?.query).toBe("Kant 1781");
    const irwin = found.find((c) => /Irwin/.test(c.query));
    // The verbatim text keeps the parenthetical; the lookup query collapses it
    // to the bare year, which is what a catalogue search wants.
    expect(irwin?.text).toBe("Irwin (2001)");
    expect(irwin?.query).toBe("Irwin 2001");
  });

  it("never produces an unbalanced parenthesis", () => {
    // The paren-strip meant for "(Kant 1781)" was also stripping the closing
    // paren of a narrative year: "Ethics (2001)" became "Ethics (2001", which
    // then went out as a search query.
    const found = extractCitations(
      "Published in The Journal of Ethics (2001). See also Broadie (1991) and (Annas 1977).",
    );
    for (const c of found) {
      const opens = (c.query.match(/\(/g) ?? []).length;
      const closes = (c.query.match(/\)/g) ?? []).length;
      expect(opens, `unbalanced: ${c.query}`).toBe(closes);
    }
  });
});

describe("structurally anchored citation mentions", () => {
  it("preserves source type, parser confidence, and page/block anchor", () => {
    const found = extractCitationMentions([
      { sourceType: "bibliography", text: "Sarah Broadie, Ethics with Aristotle (Oxford: OUP, 1991).", textBlockId: "bib-1", pageIndex: 9, blockOrder: 2, parserConfidence: 0.98 },
      { sourceType: "footnote", text: "See Julia Annas, Plato and Aristotle on Friendship (1977).", textBlockId: "note-1", pageIndex: 3, blockOrder: 8, marker: "12" },
      { sourceType: "endnote", text: "David Charles, Aristotle's Philosophy of Action (1984).", textBlockId: "end-1", pageIndex: 14, blockOrder: 1, marker: "3" },
      { sourceType: "inline", text: "Aristotle's Nicomachean Ethics (Irwin 1985) frames the discussion.", textBlockId: "body-1", pageIndex: 4, blockOrder: 5 },
    ]);

    expect(found.map((citation) => citation.sourceType)).toEqual(expect.arrayContaining(["bibliography", "footnote", "endnote", "inline"]));
    expect(found.find((citation) => citation.sourceType === "footnote")?.anchor).toMatchObject({ textBlockId: "note-1", pageIndex: 3, blockOrder: 8, marker: "12" });
    expect(found.find((citation) => citation.sourceType === "bibliography")?.parserConfidence).toBe(0.98);
    expect(found.some((citation) => citation.query.includes("Nicomachean Ethics"))).toBe(true);
  });

  it("keeps an unresolved structural entry instead of dropping it for missing metadata", () => {
    const found = extractCitationMentions([
      { sourceType: "bibliography", text: "A. Unknown, A Work the catalog does not contain.", textBlockId: "bib-unresolved", pageIndex: 22, blockOrder: 4 },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sourceType: "bibliography", text: "A. Unknown, A Work the catalog does not contain." });
    expect(found[0].anchor).toMatchObject({ textBlockId: "bib-unresolved", pageIndex: 22 });
  });
});

describe("classical (Bekker/Stephanus) citation extraction gate", () => {
  // The real production defect this closes: a footnote citing Aristotle by
  // Bekker number alone, whose short abbreviation was corrupted by PDF
  // extraction into mojibake, used to clear the generic ">= 8 chars"
  // fallback bar and get persisted as a junk Library row —
  // "Needs bibliographic resolution — Af?;7.8.1151a20-8.".
  it("recognizes the real fixture as a canonical Aristotle citation, not a junk fallback candidate, in a footnote", () => {
    const found = extractCitationMentions([
      { sourceType: "footnote", text: "Af?;7.8.1151a20-8.", textBlockId: "note-classical-1", pageIndex: 6, blockOrder: 3, marker: "12" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sourceType: "footnote",
      query: "Aristotle, Nicomachean Ethics",
      classical: { author: "aristotle", work: "Nicomachean Ethics" },
    });
    // The verbatim text is preserved, exactly as every other extraction path.
    expect(found[0].text).toBe("Af?;7.8.1151a20-8.");
    expect(found[0].query).not.toMatch(/Needs bibliographic resolution/);
  });

  it("also recognizes a classical locus citation in a bibliography-sourced entry", () => {
    const found = extractCitationMentions([
      { sourceType: "bibliography", text: "NE 1103a15, on moral virtue as a state of character.", textBlockId: "bib-classical-1", pageIndex: 1, blockOrder: 1 },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ query: "Aristotle, Nicomachean Ethics", classical: { work: "Nicomachean Ethics" } });
  });

  it("suppresses a locus-dominated segment entirely when no specific work can be identified (never a junk candidate)", () => {
    // A corrupted abbreviation plus a locus that falls on the Nicomachean
    // Ethics / Magna Moralia boundary — recognizeClassicalReference declines
    // to guess, and isLocusDominated's own gate keeps this from falling
    // through to the ordinary junk fallback either, since there's almost no
    // real prose in the segment once the locus is stripped.
    const found = extractCitationMentions([
      { sourceType: "footnote", text: "Xz?;3.1181a5.", textBlockId: "note-classical-2", pageIndex: 6, blockOrder: 4, marker: "13" },
    ]);
    expect(found).toHaveLength(0);
  });

  it("leaves a genuine, unrelated modern unresolved citation untouched (existing fallback still applies)", () => {
    const found = extractCitationMentions([
      { sourceType: "footnote", text: "The Archive of Lost Virtues, anonymous manuscript.", textBlockId: "note-modern-1", pageIndex: 2, blockOrder: 1, marker: "5" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].classical).toBeUndefined();
    expect(found[0].query).toContain("Archive of Lost Virtues");
  });

  it("does not treat a segment with a modern year alongside a Bekker-shaped locus as classical (modern-work veto reaches the extraction gate)", () => {
    // Neither NOTE_QUOTED nor NOTE_BOOK matches this shape, so it reaches
    // the classical-recognition fallback branch directly; the modern year
    // vetoes it there, and it falls through to the ordinary low-confidence
    // ">= 8 chars" fallback (also present in the text) instead of being
    // mistaken for a primary citation of Aristotle.
    const found = extractCitationMentions([
      {
        sourceType: "footnote",
        text: "As discussed in connection with 1151a20, cf. the 2015 survey of the secondary literature.",
        textBlockId: "note-veto-1",
        pageIndex: 4,
        blockOrder: 2,
        marker: "9",
      },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].classical).toBeUndefined();
    expect(found[0].query).not.toBe("Aristotle, Nicomachean Ethics");
  });

  // Real production defect (canary follow-up, 2026-07-26): GROBID glued the
  // Brickhouse article's own page-1 journal masthead onto genuine
  // footnote-3 content. The leading clause is a perfectly legible NE locus
  // citation; the masthead's "2003" used to veto recognition of the WHOLE
  // segment (`recognizeClassicalReference` sees the year, not just the
  // locus clause), falling through to a junk "Needs bibliographic
  // resolution" fallback stub instead.
  it("recognizes a classical locus citation trapped in the leading clause of a footnote fused with a journal masthead, and drops the masthead entirely", () => {
    const fused =
      "NE 7.8.1150b29-30 and 1151a5-7. The Review of Metaphysics 57 (September 2003): 3-23. Copyright ? 2003 by The Review of Metaphysics";
    const found = extractCitationMentions([
      { sourceType: "footnote", text: fused, textBlockId: "note-fused-masthead", pageIndex: 1, blockOrder: 3, marker: "3" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sourceType: "footnote",
      query: "Aristotle, Nicomachean Ethics",
      classical: { author: "aristotle", work: "Nicomachean Ethics" },
    });
    // The masthead is dropped entirely: the persisted text is only the
    // leading locus clause, never the whole fused segment, and it is never
    // emitted as a second, separate junk candidate.
    expect(found[0].text).toBe("NE 7.8.1150b29-30 and 1151a5-7.");
    expect(found[0].text).not.toContain("Review of Metaphysics");
    expect(found[0].query).not.toMatch(/Needs bibliographic resolution/);
  });

  it("still vetoes a genuine modern secondary-source citation whose own clause carries the locus and year, even with a second clause glued on afterward", () => {
    // Distinguishes the fused-masthead case above: here the year lives in
    // the SAME clause as the locus (a real article citing itself by a
    // Bekker number in its own title), so the leading-clause-first attempt
    // must not accidentally strip the veto away.
    const text =
      '"A Note on Bekker 1106a14," Journal of Ancient Philosophy 12 (2015): 45-67. Republished with permission from the Journal of Ancient Philosophy.';
    const found = extractCitationMentions([
      { sourceType: "footnote", text, textBlockId: "note-veto-clause", pageIndex: 4, blockOrder: 2, marker: "9" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].classical).toBeUndefined();
    expect(found[0].query).not.toBe("Aristotle, Nicomachean Ethics");
  });

  it("leaves a clean locus-only footnote (no glued second clause) unchanged", () => {
    const found = extractCitationMentions([
      { sourceType: "footnote", text: "Af?;7.8.1151a20-8.", textBlockId: "note-classical-1", pageIndex: 6, blockOrder: 3, marker: "12" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      query: "Aristotle, Nicomachean Ethics",
      classical: { author: "aristotle", work: "Nicomachean Ethics" },
    });
    expect(found[0].text).toBe("Af?;7.8.1151a20-8.");
  });
});

describe("footnote unbundling (real strings audited from the baseline_test fixture)", () => {
  // Extracted verbatim (whitespace-flattened) from a real local GROBID
  // :8070 run against baseline-test/AristotlesAccountoftheVicious.pdf's TEI,
  // endnote 2: two independent citations (Kosman, then Nussbaum) joined by
  // connective prose, no semicolon at all. GROBID does not segment this
  // document's "NOTES" section as <note> elements (it lands as ordinary body
  // prose), but the bundling failure mode reproduced here is independent of
  // that and belongs squarely to the citation/apparatus parsing layer: a
  // multi-citation footnote/endnote block handed to `extractCitationMentions`
  // with `sourceType: "footnote"`/`"endnote"` exhibits it regardless of how
  // the block was segmented upstream.
  const KOSMAN_CLAUSE =
    'For an argument that, at least in what became the standard sense of the phrase, Aristotelian science does not "save the phenomena," see A. Kosman, "Saving the Phenomena: Realism and Instrumentalism in Aristotle\'s Theory of Science," in Aristotle and Contemporary Science, ed. D. Sfendoni-Mentzou (New York: Peter Lang Publishing, 2000), pp. 54-72.';
  const NUSSBAUM_CLAUSE_COMPLETE =
    "For arguments closer to my own, see M. Nussbaum, The Fragility of Goodness (Cambridge: Cambridge University Press, 1986).";
  // The actual GROBID/PDF extraction genuinely truncates endnotes 3-20 in this
  // fixture (an unrelated, upstream `packages/ingestion` extraction gap, out
  // of scope here) — the real Nussbaum clause never reaches its own year or
  // closing parenthesis.
  const NUSSBAUM_CLAUSE_REAL_TRUNCATED = "For arguments closer to my own, see M. Nussbaum, The Fragility of Goodness (Cambridge: Cambridge";

  it("Kosman's citation alone does not match either note-citation regex (a real, independent shape gap — a chapter-in-edited-volume citation with a quoted title AND a full descriptive imprint parenthetical, not a bundling defect)", () => {
    // Documents the honest audit finding: unbundling this note does not, by
    // itself, rescue Kosman — recorded so this isn't mistaken for a splitter
    // bug later.
    expect(extractCitations(KOSMAN_CLAUSE)).toEqual([]);
  });

  it("splits the real endnote 2 into two segments when both halves are complete (hypothetical: no upstream truncation)", () => {
    const bundled = `${KOSMAN_CLAUSE} ${NUSSBAUM_CLAUSE_COMPLETE}`;
    const segments = splitNoteEntries(bundled);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toContain("Kosman");
    expect(segments[1]).toContain("Nussbaum");
  });

  it("recovers Kosman as its own low-confidence mention once split out, instead of being silently dropped because Nussbaum's half matches the regex", () => {
    const bundled = `${KOSMAN_CLAUSE} ${NUSSBAUM_CLAUSE_COMPLETE}`;
    const found = extractCitationMentions([
      { sourceType: "footnote", text: bundled, textBlockId: "note-2", pageIndex: 14, blockOrder: 3, marker: "2" },
    ]);
    expect(found.some((m) => m.text.includes("Kosman"))).toBe(true);
    expect(found.some((m) => /Nussbaum/.test(m.query) && /1986/.test(m.query))).toBe(true);
    // Neither entry is a merged blob containing both authors.
    for (const m of found) {
      expect(m.text.includes("Kosman") && m.text.includes("Nussbaum")).toBe(false);
    }
  });

  it("declines to split the REAL truncated endnote 2 (Nussbaum's fragment carries no year and is not itself citation-shaped) — conservative, not a regression", () => {
    const bundledReal = `${KOSMAN_CLAUSE} ${NUSSBAUM_CLAUSE_REAL_TRUNCATED}`;
    expect(splitNoteEntries(bundledReal)).toEqual([bundledReal]);
    // Falls back to the pre-existing single-blob behavior rather than
    // fabricating a confident split out of an incomplete fragment.
    const found = extractCitationMentions([
      { sourceType: "footnote", text: bundledReal, textBlockId: "note-2", pageIndex: 14, blockOrder: 3, marker: "2" },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].text).toContain("Kosman");
    expect(found[0].text).toContain("Nussbaum");
  });
});

describe("footnote unbundling (synthetic, targeting the fallback path directly)", () => {
  it("gives each half of a semicolon-joined bundled note its own low-confidence mention instead of one merged blob", () => {
    // Neither half matches NOTE_QUOTED/NOTE_BOOK on its own (no parenthesised
    // year), but each independently carries a bare year and is therefore
    // citation-shaped enough to split confidently. Post-23.5d the semicolon
    // boundary itself requires a citation cue immediately after it ("see
    // also"), not just a bare "and" — see the cue-discipline repair tests
    // below for the case this distinction exists to fix.
    const bundled = "Compare the treatment in Smith, Ancient Ethics Revisited 1972; see also Jones, Modern Commentary 1980.";
    const found = extractCitationMentions([
      { sourceType: "footnote", text: bundled, textBlockId: "note-9", pageIndex: 1, blockOrder: 1, marker: "9" },
    ]);
    expect(found).toHaveLength(2);
    expect(found.some((m) => m.text.includes("Smith") && !m.text.includes("Jones"))).toBe(true);
    expect(found.some((m) => m.text.includes("Jones") && !m.text.includes("Smith"))).toBe(true);
  });

  it("splits two complete, independently-regex-matching citations joined by a semicolon into exactly two mentions (no duplication)", () => {
    // Post-23.5d: "and David Charles" alone no longer qualifies as a boundary
    // (no cue), so this fixture now carries its own "see also" cue on the
    // second half rather than relying only on the leading "See" at the start.
    const bundled =
      "See W.F.R. Hardie, Aristotle's Ethical Theory (Oxford: Oxford University Press, 1980); see also David Charles, Aristotle's Philosophy of Action (London: Duckworth, 1984).";
    const found = extractCitationMentions([
      { sourceType: "footnote", text: bundled, textBlockId: "note-3", pageIndex: 5, blockOrder: 2, marker: "3" },
    ]);
    const hardie = found.filter((m) => /Hardie/.test(m.query));
    const charles = found.filter((m) => /Charles/.test(m.query));
    expect(hardie).toHaveLength(1);
    expect(charles).toHaveLength(1);
    expect(found).toHaveLength(2);
  });
});

describe("footnote unbundling — adversarial non-split cases", () => {
  it("does not split a semicolon that falls inside a quoted title", () => {
    const text = 'See A. Kosman, "Saving the Phenomena; Realism and Instrumentalism," Journal of Philosophy 80 (1990), pp. 1-20.';
    expect(splitNoteEntries(text)).toEqual([text]);
  });

  it("does not split an 'op. cit.' reference", () => {
    const text = "See Broadie, op. cit., p. 45; see also Annas, op. cit., ch. 2.";
    expect(splitNoteEntries(text)).toEqual([text]);
  });

  it("does not split a semicolon-separated page-range list", () => {
    const text = "Sarah Broadie, Ethics with Aristotle (Oxford: Oxford University Press, 1991), pp. 54-72; 88-91; 103-110.";
    expect(splitNoteEntries(text)).toEqual([text]);
  });

  it("does not split ordinary connective prose that merely follows a citation-cue verb ('see also X, who ...')", () => {
    // "Broadie, who argues" starts with a capitalized surname + comma, which
    // satisfies the boundary regex's citation-START signal, but the resulting
    // half is not itself citation-shaped (no year, next word not capitalized)
    // — this is exactly the case the looksLikeCitation gate exists to catch.
    const text = "The point is discussed at length; see also Broadie, who argues instead that virtue is a mean.";
    expect(splitNoteEntries(text)).toEqual([text]);
  });

  it("does not split plain prose with no citation-cue verb at all", () => {
    const text = "The argument fails for a simple reason. Aristotle, however, thought otherwise about akrasia.";
    expect(splitNoteEntries(text)).toEqual([text]);
  });

  it("returns the input unchanged when there is nothing to split", () => {
    const text = "Sarah Broadie, Ethics with Aristotle (Oxford: Oxford University Press, 1991).";
    expect(splitNoteEntries(text)).toEqual([text]);
  });
});

describe("footnote unbundling — 23.5d cue-discipline repair (semicolon boundary now requires a citation cue)", () => {
  // The verifier's rejection of the first 23.5d fix: SPLIT_BOUNDARY's
  // semicolon alternative had no citation-cue requirement (unlike the period
  // alternative, which already required one), and `looksLikeCitation` alone
  // is too permissive to compensate — a capitalized appositive satisfies its
  // Surname-comma-Capital shape, and a year anywhere in the second clause
  // satisfies its year check, even when neither half is a citation. The
  // exact adversarial string reported by the verifier is not reproduced
  // verbatim here (it was not carried into this task's prompt as literal
  // text); the case below is modeled directly on the verifier's own
  // description of its shape: "Name1, <capitalized appositive>, <prose>;
  // Name2, <clause with a year>, <prose>."
  it("does not split ordinary scholarly-discourse prose shaped like 'Name1, <capitalized appositive>, <prose>; Name2, <clause with a year>, <prose>.' (the verifier's adversarial construction)", () => {
    const text =
      "Barnes, A Careful Reader of the Nicomachean Ethics, insists that courage is a mean; Owen, A Historian of Greek Philosophy Writing in 1961, offers a similar reading of the same passage.";
    // Sanity check on the construction itself: both halves would satisfy the
    // permissive `looksLikeCitation` gate on their own (capitalized
    // appositive on the left, an embedded year on the right), which is
    // exactly why the fix has to live in the boundary regex, not the gate.
    expect(text.split(";")[0].trim()).toMatch(/^[A-Z][A-Za-z.'-]+,\s+[A-Z]/);
    expect(text.split(";")[1]).toMatch(/\b(19|20)\d{2}\b/);
    expect(splitNoteEntries(text)).toEqual([text]);
  });

  it("does not split appositive-with-embedded-year prose lacking any citation cue (a second case in the same class)", () => {
    const text =
      "Barnes, A Scholar Active Since 1975, argues that courage is a mean; Owen, A Reader of the Same Passage, offers a similar view of the text.";
    expect(splitNoteEntries(text)).toEqual([text]);
  });

  it("still splits a genuinely cue-bearing 'see X; compare Y' citation pair (both sides carry their own cue)", () => {
    const text =
      "See A. Kosman, Saving the Phenomena (New York: Peter Lang, 2000); compare M. Nussbaum, The Fragility of Goodness (Cambridge: Cambridge University Press, 1986).";
    const segments = splitNoteEntries(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toContain("Kosman");
    expect(segments[1]).toContain("Nussbaum");

    const found = extractCitationMentions([
      { sourceType: "footnote", text, textBlockId: "note-cue-pair", pageIndex: 1, blockOrder: 1, marker: "cue" },
    ]);
    expect(found.some((m) => /Kosman/.test(m.query))).toBe(true);
    expect(found.some((m) => /Nussbaum/.test(m.query) && /1986/.test(m.query))).toBe(true);
  });

  it("confirms 'see' remains a recognized CITATION_CUE and the real endnote-2 Kosman+Nussbaum case (period boundary, unaffected by the semicolon fix) still splits", () => {
    const KOSMAN_CLAUSE =
      'For an argument that, at least in what became the standard sense of the phrase, Aristotelian science does not "save the phenomena," see A. Kosman, "Saving the Phenomena: Realism and Instrumentalism in Aristotle\'s Theory of Science," in Aristotle and Contemporary Science, ed. D. Sfendoni-Mentzou (New York: Peter Lang Publishing, 2000), pp. 54-72.';
    const NUSSBAUM_CLAUSE_COMPLETE =
      "For arguments closer to my own, see M. Nussbaum, The Fragility of Goodness (Cambridge: Cambridge University Press, 1986).";
    const bundled = `${KOSMAN_CLAUSE} ${NUSSBAUM_CLAUSE_COMPLETE}`;
    const segments = splitNoteEntries(bundled);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toContain("Kosman");
    expect(segments[1]).toContain("Nussbaum");
  });
});
