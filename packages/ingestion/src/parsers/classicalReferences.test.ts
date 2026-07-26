import { describe, expect, it } from "vitest";
import { BEKKER_WORK_RANGES, isLocusDominated, recognizeClassicalReference, splitLeadingClause } from "./classicalReferences";

describe("recognizeClassicalReference — the real production fixture", () => {
  it("recognizes 'Af?;7.8.1151a20-8.' as Nicomachean Ethics via the standalone page-range path (1151 falls in [1094, 1181])", () => {
    // "Af?;" is what a corrupted "NE" (or similar abbreviation) survived PDF
    // extraction as — the recognizer must never rely on it, only on the
    // Bekker number itself, which extraction left intact.
    const match = recognizeClassicalReference("Af?;7.8.1151a20-8.");
    expect(match).toEqual({
      author: "aristotle",
      work: "Nicomachean Ethics",
      query: "Aristotle, Nicomachean Ethics",
      locus: "1151a20-8",
    });
  });

  it("the same fixture is locus-dominated (its abbreviation survived as junk, not real prose)", () => {
    expect(isLocusDominated("Af?;7.8.1151a20-8.")).toBe(true);
  });
});

describe("recognizeClassicalReference — clean full-form abbreviation cases", () => {
  it("recognizes an NE citation", () => {
    expect(recognizeClassicalReference("NE 1103a15")).toEqual({
      author: "aristotle",
      work: "Nicomachean Ethics",
      query: "Aristotle, Nicomachean Ethics",
      locus: "1103a15",
    });
  });

  it("recognizes a Pol. citation (trailing-period abbreviation)", () => {
    expect(recognizeClassicalReference("Pol. 1252a1")).toEqual({
      author: "aristotle",
      work: "Politics",
      query: "Aristotle, Politics",
      locus: "1252a1",
    });
  });

  it("recognizes a Plato Republic citation via Stephanus numbering (never recognizable standalone — see the module doc comment)", () => {
    expect(recognizeClassicalReference("Plato, Rep. 514a")).toEqual({
      author: "plato",
      work: "Republic",
      query: "Plato, Republic",
      locus: "514a",
    });
  });

  it("recognizes Eth. Nic. as an alternate Nicomachean Ethics abbreviation", () => {
    expect(recognizeClassicalReference("see Eth. Nic. VII.3, 1151a20")?.work).toBe("Nicomachean Ethics");
  });
});

describe("recognizeClassicalReference — negative cases", () => {
  it("does not recognize a genuine modern book citation with no locus at all (Nussbaum)", () => {
    const nussbaum = "For arguments closer to my own, see M. Nussbaum, The Fragility of Goodness (Cambridge: Cambridge University Press, 1986).";
    expect(recognizeClassicalReference(nussbaum)).toBeNull();
  });

  it("modern-work veto: a quoted article title that merely mentions a Bekker number is not a classical citation", () => {
    // A real secondary-source citation, not a primary one — the quoted
    // title plus modern year both independently trigger the veto.
    const secondary = 'Smith, "A Note on Bekker 1106a14," Journal of Ancient Philosophy 12 (2015).';
    expect(recognizeClassicalReference(secondary)).toBeNull();
  });

  it("boundary suppression: a standalone locus at page 1181 is ambiguous between Nicomachean Ethics and Magna Moralia and is never guessed", () => {
    expect(recognizeClassicalReference("3.1181a5.")).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(recognizeClassicalReference("")).toBeNull();
    expect(recognizeClassicalReference("   ")).toBeNull();
  });

  it("returns null for ordinary prose with no locus and no abbreviation", () => {
    expect(recognizeClassicalReference("Aristotle argues that virtue is a mean between two vices.")).toBeNull();
  });

  it("does not recognize a standalone locus whose page falls outside every curated range", () => {
    // Page 9999 doesn't exist in the Bekker corpus.
    expect(recognizeClassicalReference("see discussion at 9999a1.")).toBeNull();
  });

  it("does not recognize a short, low-page-number locus standalone (precision guard against ordinary prose like 'page 45a')", () => {
    expect(recognizeClassicalReference("continued on page 45a.")).toBeNull();
  });
});

describe("recognizeClassicalReference — standalone requires the locus to anchor the end of the segment", () => {
  it("does not recognize a Bekker-shaped number that is not at the end of the segment (no corroborating abbreviation)", () => {
    expect(recognizeClassicalReference("1151a20 is discussed at length by several commentators")).toBeNull();
  });

  it("still recognizes it once the same locus anchors the end", () => {
    expect(recognizeClassicalReference("Several commentators discuss 1151a20")?.work).toBe("Nicomachean Ethics");
  });
});

describe("isLocusDominated", () => {
  it("is false for ordinary prose with no locus", () => {
    expect(isLocusDominated("This is an ordinary sentence with no citation content at all.")).toBe(false);
  });

  it("is false for a real citation-shaped fallback candidate long enough to carry its own prose", () => {
    expect(isLocusDominated("A. Unknown, A Work the catalog does not contain.")).toBe(false);
  });

  it("is true for a bare abbreviation plus locus with nothing else", () => {
    expect(isLocusDominated("NE 1151a20-8.")).toBe(true);
  });
});

describe("splitLeadingClause", () => {
  it("splits the real fused masthead fixture at the locus clause's own period", () => {
    const fused =
      "NE 7.8.1150b29-30 and 1151a5-7. The Review of Metaphysics 57 (September 2003): 3-23. Copyright ? 2003 by The Review of Metaphysics";
    expect(splitLeadingClause(fused)).toEqual({
      leading: "NE 7.8.1150b29-30 and 1151a5-7.",
      remainder: "The Review of Metaphysics 57 (September 2003): 3-23. Copyright ? 2003 by The Review of Metaphysics",
    });
  });

  it("recognizes the leading clause alone as Nicomachean Ethics once split (proves the fix's core mechanism)", () => {
    const fused =
      "NE 7.8.1150b29-30 and 1151a5-7. The Review of Metaphysics 57 (September 2003): 3-23. Copyright ? 2003 by The Review of Metaphysics";
    const split = splitLeadingClause(fused)!;
    expect(recognizeClassicalReference(split.leading)).toEqual({
      author: "aristotle",
      work: "Nicomachean Ethics",
      query: "Aristotle, Nicomachean Ethics",
      locus: "1150b29-30",
    });
    // The whole fused segment is still vetoed if tried directly — the fix's
    // value is entirely in trying the leading clause FIRST.
    expect(recognizeClassicalReference(fused)).toBeNull();
  });

  it("does not split a decimal-shaped locus (no whitespace after the internal periods)", () => {
    expect(splitLeadingClause("NE 7.8.1150b29-30")).toBeNull();
  });

  it("does not split on an abbreviation period followed by a lowercase cue word (only the terminal period is a boundary, and it leaves no remainder)", () => {
    expect(splitLeadingClause("As discussed, cf. the 2015 survey of the secondary literature.")).toBeNull();
  });

  it("returns null when the only period is the segment's own terminal period (single clause)", () => {
    expect(splitLeadingClause("Pol. 1252a1.")).toBeNull();
    expect(
      splitLeadingClause('Smith, "A Note on Bekker 1106a14," Journal of Ancient Philosophy 12 (2015).'),
    ).toBeNull();
  });

  it("returns null for a segment with no period at all", () => {
    expect(splitLeadingClause("NE 1103a15")).toBeNull();
  });
});

describe("classical recognition — leading-clause veto direction is preserved", () => {
  it("a modern secondary-source citation whose OWN clause carries the locus and the year stays vetoed even when a second clause follows", () => {
    // The year lives in the SAME clause as the locus here (unlike the fused
    // masthead fixture, where the year is in a separate trailing clause) —
    // splitLeadingClause must not tear the veto-triggering year away from
    // the locus it's meant to protect.
    const segment =
      '"A Note on Bekker 1106a14," Journal of Ancient Philosophy 12 (2015): 45-67. Republished with permission from the Journal of Ancient Philosophy.';
    const split = splitLeadingClause(segment);
    expect(split).not.toBeNull();
    expect(recognizeClassicalReference(split!.leading)).toBeNull();
    expect(recognizeClassicalReference(segment)).toBeNull();
  });
});

describe("BEKKER_WORK_RANGES", () => {
  it("spans from Categories (1a) to Poetics (1462b), per the traditional edition", () => {
    expect(BEKKER_WORK_RANGES[0]).toMatchObject({ work: "Categories", startPage: 1 });
    expect(BEKKER_WORK_RANGES[BEKKER_WORK_RANGES.length - 1]).toMatchObject({ work: "Poetics", endPage: 1462 });
  });

  it("documents the deliberate Nicomachean Ethics / Magna Moralia boundary overlap at page 1181", () => {
    const ne = BEKKER_WORK_RANGES.find((r) => r.work === "Nicomachean Ethics")!;
    const mm = BEKKER_WORK_RANGES.find((r) => r.work === "Magna Moralia")!;
    expect(ne.endPage).toBe(1181);
    expect(mm.startPage).toBe(1181);
  });
});
