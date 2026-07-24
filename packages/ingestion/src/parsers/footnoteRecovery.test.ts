import { describe, expect, it } from "vitest";
import { matchFootnoteMarker, recoverPageBottomFootnotes } from "./footnoteRecovery";

const FOOTER = "This content downloaded from 10.0.0.1 on Mon, 1 Jan 2001 00:00:00 AM";
const RIGHTS = "All use subject to Example Terms and Conditions";

/**
 * Synthetic, paraphrased fixture reproducing the D-24-G2 shape: page-bottom
 * numbered footnotes numbered continuously across pages, printed below the
 * body, with a repeated running header/footer. Numbers are glued to the note
 * text on some entries (a lost superscript) and space-separated on others —
 * both real shapes in scanned text. No copyrighted text is quoted.
 */
function fixturePages(): string[] {
  return [
    [
      "2 SAMPLE AUTHOR",
      "The opening body prose of the article discusses an example claim in",
      "detail before turning to a second consideration.",
      "1 First footnote, a bibliographic reference and a comment.",
      "2Second footnote glued to its marker, still a real note.",
      "3 Third footnote spanning",
      "two physical lines here.",
      FOOTER,
      RIGHTS,
    ].join("\n"),
    [
      "SAMPLE TITLE 3",
      "The body prose continues on the next page with more argument that",
      "does not start with any footnote number.",
      "4 Fourth footnote, citing 1.5.1095b19-20 in the note text.",
      "5 Fifth footnote.",
      FOOTER,
      RIGHTS,
    ].join("\n"),
    // A third page repeating the footer, so the cross-page boilerplate signal
    // has the >=3-page evidence it requires (mirrors a real multi-page doc).
    ["SAMPLE TITLE 5", "A final page of unrelated body prose for scale.", FOOTER, RIGHTS].join("\n"),
  ];
}

describe("matchFootnoteMarker", () => {
  it("matches a spaced marker and returns the note text", () => {
    expect(matchFootnoteMarker("1 First footnote text.", 1)).toBe("First footnote text.");
  });
  it("matches a marker glued directly to the note text (lost superscript)", () => {
    expect(matchFootnoteMarker("4JVE7.4.1148al8.", 4)).toBe("JVE7.4.1148al8.");
  });
  it("does not match a longer number when a shorter one is expected", () => {
    expect(matchFootnoteMarker("15AK9.4.1166b24-5.", 1)).toBeNull();
    expect(matchFootnoteMarker("1150b29-30", 1)).toBeNull();
  });
  it("matches the exact expected integer only", () => {
    expect(matchFootnoteMarker("5 Fifth footnote.", 4)).toBeNull();
    expect(matchFootnoteMarker("5 Fifth footnote.", 5)).toBe("Fifth footnote.");
  });
});

describe("recoverPageBottomFootnotes", () => {
  it("recovers page-bottom footnotes numbered continuously across pages", () => {
    const notes = recoverPageBottomFootnotes({ pageTexts: fixturePages(), structuredMarkers: new Set() });
    expect(notes.map((n) => n.marker)).toEqual(["1", "2", "3", "4", "5"]);
    expect(notes[0].text).toContain("First footnote");
    expect(notes[1].text).toContain("Second footnote glued");
    expect(notes[2].text).toBe("Third footnote spanning two physical lines here.");
    expect(notes[3].text).toContain("1.5.1095b19-20"); // in-note Bekker number is kept
  });

  it("attributes each entry to the page its numbered line begins on", () => {
    const notes = recoverPageBottomFootnotes({ pageTexts: fixturePages(), structuredMarkers: new Set() });
    expect(notes.find((n) => n.marker === "3")?.pageIndex).toBe(0);
    expect(notes.find((n) => n.marker === "4")?.pageIndex).toBe(1);
  });

  it("never swallows the next page's body prose as footnote continuation", () => {
    const notes = recoverPageBottomFootnotes({ pageTexts: fixturePages(), structuredMarkers: new Set() });
    const three = notes.find((n) => n.marker === "3");
    expect(three?.text).not.toContain("body prose continues");
  });

  it("skips markers GROBID already produced structurally", () => {
    const notes = recoverPageBottomFootnotes({
      pageTexts: fixturePages(),
      structuredMarkers: new Set([1, 2]),
    });
    expect(notes.map((n) => n.marker)).toEqual(["3", "4", "5"]);
  });

  it("single-gap forward resync skips ONE unreadable marker mid-region", () => {
    // Footnote 2's marker is corrupted to a mojibake token; the sequence must
    // resume at 3 rather than merging 3.. into note 1.
    const pages = [
      [
        "1 First footnote here.",
        '"W? corrupted marker line for note two.',
        "3 Third footnote, recovered after the skip.",
        "4 Fourth footnote.",
      ].join("\n"),
    ];
    const notes = recoverPageBottomFootnotes({ pageTexts: pages, structuredMarkers: new Set() });
    expect(notes.map((n) => n.marker)).toEqual(["1", "3", "4"]);
    expect(notes.find((n) => n.marker === "3")?.text).toContain("Third footnote");
    expect(notes.find((n) => n.marker === "4")?.text).toBe("Fourth footnote.");
  });

  it("a Bekker-number continuation line never triggers a false resync", () => {
    // Note 1's continuation begins with "3.10..." while expecting 2; the
    // forward resync only fires for exactly expected+1, so this stays note 1.
    const pages = [
      [
        "1 First footnote, De Anima 3.9.433a1-3,",
        "3.10.433b5-8, and further discussion.",
        "2 Second footnote.",
        "3 Third footnote.",
      ].join("\n"),
    ];
    const notes = recoverPageBottomFootnotes({ pageTexts: pages, structuredMarkers: new Set() });
    expect(notes.map((n) => n.marker)).toEqual(["1", "2", "3"]);
    expect(notes[0].text).toContain("3.10.433b5-8");
  });

  it("returns nothing for a document with too few numbered entries to trust", () => {
    expect(
      recoverPageBottomFootnotes({ pageTexts: ["1 lone note", "just body prose"], structuredMarkers: new Set() }),
    ).toEqual([]);
  });

  describe("body-containment guard (D-24-G2 precision fix)", () => {
    // Numbered SECTION HEADINGS read to the scan exactly like a footnote series.
    const sectionPages = [
      [
        "1. Introduction",
        "This paper introduces the central example and sets out the argument in detail.",
        "2. Background",
        "The background section reviews the prior literature on the example at length.",
        "3. Method",
        "The method section describes the procedure used to evaluate the example claim.",
      ].join("\n"),
    ];
    const sectionBodies = [
      "This paper introduces the central example and sets out the argument in detail.",
      "The background section reviews the prior literature on the example at length.",
      "The method section describes the procedure used to evaluate the example claim.",
    ];

    // An in-body ENUMERATED LIST is the same trap.
    const listPages = [
      [
        "The author lists several considerations as follows.",
        "1. The first consideration concerns the nature of the example under study.",
        "2. The second consideration concerns its relation to the prior argument.",
        "3. The third consideration concerns the consequences for the conclusion.",
      ].join("\n"),
    ];
    const listBodies = [listPages[0].replace(/\n/g, " ")];

    it("WITHOUT the guard, section headings fabricate footnotes (the bug)", () => {
      const notes = recoverPageBottomFootnotes({ pageTexts: sectionPages, structuredMarkers: new Set() });
      expect(notes.length).toBe(3); // red: three fabricated notes duplicating body prose
    });

    it("WITH the guard, numbered section headings recover ZERO notes", () => {
      const notes = recoverPageBottomFootnotes({
        pageTexts: sectionPages,
        structuredMarkers: new Set(),
        bodyBlockTexts: sectionBodies,
      });
      expect(notes).toEqual([]);
    });

    it("WITHOUT the guard, an in-body enumerated list fabricates footnotes (the bug)", () => {
      const notes = recoverPageBottomFootnotes({ pageTexts: listPages, structuredMarkers: new Set() });
      expect(notes.length).toBe(3);
    });

    it("WITH the guard, an in-body enumerated list recovers ZERO notes", () => {
      const notes = recoverPageBottomFootnotes({
        pageTexts: listPages,
        structuredMarkers: new Set(),
        bodyBlockTexts: listBodies,
      });
      expect(notes).toEqual([]);
    });

    it("keeps a genuine footnote whose text is absent from every body block", () => {
      const pages = [
        [
          "1 Unless otherwise indicated, all references are to the standard edition.",
          "2 See the discussion of the example in the secondary literature cited above.",
          "3 Compare the parallel passage noted earlier in the argument of the paper.",
        ].join("\n"),
      ];
      const notes = recoverPageBottomFootnotes({
        pageTexts: pages,
        structuredMarkers: new Set(),
        bodyBlockTexts: ["A body paragraph that shares no full line with any of these notes."],
      });
      expect(notes.map((n) => n.marker)).toEqual(["1", "2", "3"]);
    });
  });
});
