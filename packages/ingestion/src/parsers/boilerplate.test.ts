import { describe, expect, it } from "vitest";
import { collectBoilerplateLines, isEntirelyBoilerplate, stripBoilerplateAtBoundaries, stripBoilerplateLines } from "./boilerplate";

describe("stripBoilerplateLines (D-23-8)", () => {
  it("strips a JSTOR-style running footer that varies by IP, timestamp, and page number across pages", () => {
    const pages = [
      [
        "1",
        "Chapter One begins here with an opening paragraph about the subject.",
        "This content downloaded from 128.61.7.44 on Mon, 01 Jan 2024 12:00:00 UTC",
        "All use subject to https://about.jstor.org/terms",
      ].join("\n"),
      [
        "2",
        "The argument continues into a second page of unrelated prose.",
        "This content downloaded from 74.12.9.100 on Tue, 02 Feb 2024 09:15:33 UTC",
        "All use subject to https://about.jstor.org/terms",
      ].join("\n"),
      [
        "3",
        "A third page carries the conclusion of this section of the text.",
        "This content downloaded from 10.20.30.40 on Wed, 03 Mar 2024 18:45:12 UTC",
        "All use subject to https://about.jstor.org/terms",
      ].join("\n"),
    ];

    const stripped = stripBoilerplateLines(pages);

    for (const pageText of stripped) {
      expect(pageText).not.toContain("This content downloaded from");
      expect(pageText).not.toContain("All use subject to");
    }
    expect(stripped[0]).toContain("Chapter One begins here with an opening paragraph about the subject.");
    expect(stripped[1]).toContain("The argument continues into a second page of unrelated prose.");
    expect(stripped[2]).toContain("A third page carries the conclusion of this section of the text.");
  });

  it("never strips a line that appears on only one page", () => {
    const pages = [
      ["A one-off editorial aside that never recurs anywhere else in this document.", "Ordinary prose continues here."].join("\n"),
      ["Different prose entirely on the second page."].join("\n"),
      ["Different prose entirely on the third page."].join("\n"),
    ];

    const stripped = stripBoilerplateLines(pages);

    expect(stripped[0]).toContain("A one-off editorial aside that never recurs anywhere else in this document.");
  });

  it("does not strip a legitimately repeated short quote that sits in the middle of a page, not at a page boundary", () => {
    // Only a page's own first/last two non-blank lines are ever stripping
    // candidates (see BOUNDARY_WINDOW in boilerplate.ts), so a refrain
    // repeated verbatim across pages but always surrounded by other prose on
    // both sides is protected even though it meets the repeat-frequency bar
    // that would otherwise flag it.
    const REFRAIN = "Man is by nature a political animal.";
    const pages = [
      ["Opening line of page one.", "Second opening line.", REFRAIN, "Second closing line.", "Closing line of page one."].join("\n"),
      ["Opening line of page two.", "Second opening line.", REFRAIN, "Second closing line.", "Closing line of page two."].join("\n"),
      ["Opening line of page three.", "Second opening line.", REFRAIN, "Second closing line.", "Closing line of page three."].join("\n"),
    ];

    const stripped = stripBoilerplateLines(pages);

    for (const pageText of stripped) {
      expect(pageText).toContain(REFRAIN);
    }
  });

  it("leaves page texts untouched when nothing repeats across pages", () => {
    const pages = ["Page one prose.", "Page two prose.", "Page three prose."];
    expect(stripBoilerplateLines(pages)).toEqual(pages);
  });
});

describe("isEntirelyBoilerplate (D-23-8, GROBID apparatus path)", () => {
  // The real GROBID-mis-segmented footer block: two physical footer lines that
  // repeat across every JSTOR page, space-joined by GROBID into one run-on note.
  const pages = [
    ["Prose about the subject on page one.", "This content downloaded from 128.197.26.12 on Wed, 20 Aug 2014 13:16:00 PM", "All use subject to https://about.jstor.org/terms"].join("\n"),
    ["Prose about the subject on page two.", "This content downloaded from 74.12.9.100 on Tue, 02 Feb 2024 09:15:33 UTC", "All use subject to https://about.jstor.org/terms"].join("\n"),
    ["Prose about the subject on page three.", "This content downloaded from 10.20.30.40 on Wed, 03 Mar 2024 18:45:12 UTC", "All use subject to https://about.jstor.org/terms"].join("\n"),
  ];
  const keys = collectBoilerplateLines(pages);

  it("flags a footer-ONLY block GROBID space-joined into one run-on note", () => {
    const footerBlock = "This content downloaded from 128.197.26.12 on Wed, 20 Aug 2014 13:16:00 PM All use subject to https://about.jstor.org/terms";
    expect(isEntirelyBoilerplate(footerBlock, keys)).toBe(true);
  });

  it("never flags a genuine citation/footnote block", () => {
    const real = "See J. Annas, 'Plato and Aristotle on Love and Friendship', Mind 86 (1977), 532-54.";
    expect(isEntirelyBoilerplate(real, keys)).toBe(false);
  });

  it("keeps a block whole when a footer is merged into real citation content", () => {
    // Whole-block only: removal does not leave the block empty, so it is kept
    // entirely (never partially truncated) — the caller must not drop it.
    const merged = "This content downloaded from 10.20.30.40 on Wed, 03 Mar 2024 18:45:12 UTC See Bostock, Aristotle's Ethics (Oxford 2000), 173.";
    expect(isEntirelyBoilerplate(merged, keys)).toBe(false);
  });

  it("does not flag anything when no boilerplate was learned (empty key set)", () => {
    expect(isEntirelyBoilerplate("This content downloaded from 1.2.3.4 on Mon, 1 Jan 2001 00:00:00 UTC", new Set())).toBe(false);
  });

  it("does not drop an unrelated numeric block on the digit-normalizer alone (repetition signal required)", () => {
    // "12 34 56" normalizes to placeholders but matches no learned footer line,
    // so it is NOT treated as furniture — the drop is repetition-driven, never
    // shape-driven.
    expect(isEntirelyBoilerplate("12 34 56", keys)).toBe(false);
  });
});

describe("stripBoilerplateAtBoundaries (D-24-G1, GROBID body path)", () => {
  const pages = [
    ["Prose about the subject on page one.", "This content downloaded from 128.197.26.12 on Wed, 20 Aug 2014 13:16:00 PM", "All use subject to https://about.jstor.org/terms"].join("\n"),
    ["Prose about the subject on page two.", "This content downloaded from 74.12.9.100 on Tue, 02 Feb 2024 09:15:33 UTC", "All use subject to https://about.jstor.org/terms"].join("\n"),
    ["Prose about the subject on page three.", "This content downloaded from 10.20.30.40 on Wed, 03 Mar 2024 18:45:12 UTC", "All use subject to https://about.jstor.org/terms"].join("\n"),
  ];
  const keys = collectBoilerplateLines(pages);

  it("strips a footer GROBID space-joined onto the START of a real body block, keeping the prose", () => {
    const block = "This content downloaded from 74.12.9.100 on Tue, 02 Feb 2024 09:15:33 UTC All use subject to https://about.jstor.org/terms The vicious soul is described here in detail.";
    expect(stripBoilerplateAtBoundaries(block, keys)).toBe("The vicious soul is described here in detail.");
  });

  it("strips a footer GROBID space-joined onto the END of a real body block", () => {
    const block = "The argument reaches its conclusion in this paragraph. This content downloaded from 10.20.30.40 on Wed, 03 Mar 2024 18:45:12 UTC All use subject to https://about.jstor.org/terms";
    expect(stripBoilerplateAtBoundaries(block, keys)).toBe("The argument reaches its conclusion in this paragraph.");
  });

  it("never removes prose from the interior of a block", () => {
    const block = "A body paragraph with no furniture at all stays exactly as it was.";
    expect(stripBoilerplateAtBoundaries(block, keys)).toBe(block);
  });

  it("returns the input unchanged when no boilerplate was learned", () => {
    const block = "This content downloaded from 1.2.3.4 on Mon, 1 Jan 2001 00:00:00 UTC then some prose.";
    expect(stripBoilerplateAtBoundaries(block, new Set())).toBe(block);
  });
});
