import { describe, expect, it } from "vitest";
import { recoverTruncatedEndnotes } from "./endnoteRecovery";

const FOOTER = "This content downloaded from 10.0.0.1 on Mon, 1 Jan 2001 00:00:00 AM";
const RIGHTS = "All use subject to Example Terms and Conditions";

/**
 * Synthetic, paraphrased fixture reproducing the exact D-20-89 shape: a body
 * paragraph whose tail runs straight into a "NOTES" heading and the first two
 * numbered entries (mirroring GROBID folding the section into body prose),
 * then a page break carrying a running header ("EXAMPLE QUARTERLY", with a
 * different page number each time — realistic journal running-head
 * convention) and a repeated footer, then entries 3-6. The running header's
 * page number ("306") deliberately lands right where entry 3 is expected, to
 * prove it is never mistaken for an actual numbered entry. No text is quoted
 * from any copyrighted source. Earlier, otherwise-irrelevant pages repeat the
 * same running header/footer so the boilerplate-repeat detector has the
 * multi-page evidence a real multi-page document would provide.
 */
function fixturePages(): string[] {
  return [
    "300 EXAMPLE QUARTERLY\nAn introductory paragraph about the example topic.",
    `302 EXAMPLE QUARTERLY\nMore unrelated body prose here for scale.\n${FOOTER}\n${RIGHTS}`,
    [
      "304 EXAMPLE QUARTERLY",
      "The argument concludes here, without further elaboration.",
      "NOTES",
      "1. A short editorial remark with no citation.",
      "2. A citation spanning across the",
      FOOTER,
      RIGHTS,
    ].join("\n"),
    [
      "306 EXAMPLE QUARTERLY",
      "page break, plus a trailing citation detail.",
      "3. First recovered citation, author and year.",
      "4. Second recovered citation, spanning",
      "two physical lines before the next entry.",
      "5. Third recovered citation.",
      "6. Fourth recovered citation.",
      FOOTER,
      RIGHTS,
    ].join("\n"),
  ];
}

describe("recoverTruncatedEndnotes (D-20-89)", () => {
  it("recovers every entry GROBID's structural output produced nothing for", () => {
    const recovered = recoverTruncatedEndnotes({
      pageTexts: fixturePages(),
      structuredMarkers: new Set(),
    });
    const byMarker = Object.fromEntries(recovered.map((r) => [r.marker, r.text]));
    expect(Object.keys(byMarker).sort((a, b) => Number(a) - Number(b))).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(byMarker["1"]).toBe("A short editorial remark with no citation.");
  });

  it("joins a multi-line entry across a page break without the running header/footer polluting it", () => {
    const recovered = recoverTruncatedEndnotes({
      pageTexts: fixturePages(),
      structuredMarkers: new Set(),
    });
    const entry2 = recovered.find((r) => r.marker === "2")!;
    expect(entry2.text).toBe("A citation spanning across the page break, plus a trailing citation detail.");
    expect(entry2.text).not.toContain("EXAMPLE QUARTERLY");
    expect(entry2.text).not.toContain(FOOTER);
    expect(entry2.text).not.toContain(RIGHTS);

    const entry4 = recovered.find((r) => r.marker === "4")!;
    expect(entry4.text).toBe("Second recovered citation, spanning two physical lines before the next entry.");

    const entry6 = recovered.find((r) => r.marker === "6")!;
    expect(entry6.text).toBe("Fourth recovered citation.");
  });

  it("never mistakes a page-number-prefixed running header (repeated across pages) for the next expected marker", () => {
    // "306 EXAMPLE QUARTERLY" sits right where entry 3 is expected; if the
    // scan treated any leading digits as a marker, it would corrupt or
    // truncate the real sequence. It must not appear as its own entry, and
    // entry 3 itself must still be recovered correctly.
    const recovered = recoverTruncatedEndnotes({
      pageTexts: fixturePages(),
      structuredMarkers: new Set(),
    });
    expect(recovered.some((r) => r.marker === "306")).toBe(false);
    const entry3 = recovered.find((r) => r.marker === "3")!;
    expect(entry3.text).toBe("First recovered citation, author and year.");
  });

  it("still never misreads a digit-prefixed line as a marker even when it is NOT repeated enough to be flagged as boilerplate", () => {
    // A page-number-prefixed line appearing only once has no repeat evidence
    // at all, so the boilerplate detector alone would not catch it — the
    // exact-integer marker match ("expected + '.'") is the real safety net
    // here, independent of repetition. "20 SOME JOURNAL" must not be
    // confused with the expected marker "2" (only "2." would qualify), and
    // must not derail or truncate the rest of the sequence.
    const recovered = recoverTruncatedEndnotes({
      pageTexts: [
        [
          "Body text concludes.",
          "NOTES",
          "1. First entry.",
          "20 SOME JOURNAL",
          "2. Second entry.",
          "3. Third entry.",
        ].join("\n"),
      ],
      structuredMarkers: new Set(),
    });
    expect(recovered.some((r) => r.marker === "20")).toBe(false);
    expect(recovered.map((r) => r.marker)).toEqual(["1", "2", "3"]);
    // Unstripped, unrecognized noise is folded into the entry it fell inside
    // (still real document text, not fabricated) rather than silently
    // discarded — the never-guess discipline favors keeping ambiguous real
    // text over discarding it outright. It lands on entry 1 here because
    // marker "2." has not been seen yet when this line is scanned.
    const entry1 = recovered.find((r) => r.marker === "1")!;
    expect(entry1.text).toBe("First entry. 20 SOME JOURNAL");
    const entry2 = recovered.find((r) => r.marker === "2")!;
    expect(entry2.text).toBe("Second entry.");
    const entry3 = recovered.find((r) => r.marker === "3")!;
    expect(entry3.text).toBe("Third entry.");
  });

  it("only returns markers GROBID's structural output did not already produce", () => {
    const recovered = recoverTruncatedEndnotes({
      pageTexts: fixturePages(),
      structuredMarkers: new Set([1, 2]),
    });
    expect(recovered.map((r) => r.marker).sort()).toEqual(["3", "4", "5", "6"]);
  });

  it("recovers nothing when GROBID already covered every marker in the list", () => {
    const recovered = recoverTruncatedEndnotes({
      pageTexts: fixturePages(),
      structuredMarkers: new Set([1, 2, 3, 4, 5, 6]),
    });
    expect(recovered).toEqual([]);
  });

  it("recovers nothing when there is no NOTES/ENDNOTES heading at all", () => {
    const recovered = recoverTruncatedEndnotes({
      pageTexts: ["Just ordinary prose.\nNo apparatus heading anywhere in this document."],
      structuredMarkers: new Set(),
    });
    expect(recovered).toEqual([]);
  });

  it("recovers nothing from a heading followed by fewer than 3 sequential entries (weak evidence)", () => {
    const recovered = recoverTruncatedEndnotes({
      pageTexts: ["Some body text.\nNOTES\n1. Only one real entry follows the heading."],
      structuredMarkers: new Set(),
    });
    expect(recovered).toEqual([]);
  });

  it("also matches an ENDNOTES heading, not only NOTES", () => {
    const recovered = recoverTruncatedEndnotes({
      pageTexts: [
        [
          "Body text concludes.",
          "ENDNOTES",
          "1. First endnote.",
          "2. Second endnote.",
          "3. Third endnote.",
        ].join("\n"),
      ],
      structuredMarkers: new Set(),
    });
    expect(recovered.map((r) => r.marker)).toEqual(["1", "2", "3"]);
  });

  // --- Adversarial precision cases added by the D-20-89 verifier. Each
  // asserts NO (or minimal, conservative) recovery on an innocent document,
  // proving the gate holds to the project's precision-over-recall discipline.
  describe("adversarial false-positive resistance (verifier)", () => {
    it("ignores a table-of-contents 'Notes' entry carrying a page number (heading regex is whole-line strict)", () => {
      const recovered = recoverTruncatedEndnotes({
        pageTexts: [
          [
            "Contents",
            "Introduction .... 1",
            "Notes .... 214",
            "1. Chapter One .... 5",
            "2. Chapter Two .... 40",
            "3. Chapter Three .... 88",
          ].join("\n"),
        ],
        structuredMarkers: new Set(),
      });
      expect(recovered).toEqual([]);
    });

    it("does not fire on a numbered reference list under a References/Bibliography heading (only NOTES/ENDNOTES trigger)", () => {
      for (const heading of ["References", "Bibliography", "Works Cited"]) {
        const recovered = recoverTruncatedEndnotes({
          pageTexts: [
            [
              "The argument concludes here.",
              heading,
              "1. Author A, A Book Title. Publisher, 1990.",
              "2. Author B, Another Title. Publisher, 1995.",
              "3. Author C, A Third Title. Publisher, 2001.",
            ].join("\n"),
          ],
          structuredMarkers: new Set(),
        });
        expect(recovered).toEqual([]);
      }
    });

    it("does not fire on a 'Notes on Method'-style heading with extra words on the line", () => {
      const recovered = recoverTruncatedEndnotes({
        pageTexts: [
          ["Body prose.", "Notes on Method", "1. First point.", "2. Second point.", "3. Third point."].join("\n"),
        ],
        structuredMarkers: new Set(),
      });
      expect(recovered).toEqual([]);
    });

    it("recovers nothing from a non-sequential numbered list under NOTES (breaks after fewer than 3 in-order entries)", () => {
      const recovered = recoverTruncatedEndnotes({
        pageTexts: [
          ["Body.", "NOTES", "1. alpha", "2. beta", "5. gamma", "6. delta"].join("\n"),
        ],
        structuredMarkers: new Set(),
      });
      expect(recovered).toEqual([]);
    });

    it("recovers nothing when exactly two sequential entries follow the heading", () => {
      const recovered = recoverTruncatedEndnotes({
        pageTexts: [["Body.", "NOTES", "1. alpha", "2. beta"].join("\n")],
        structuredMarkers: new Set(),
      });
      expect(recovered).toEqual([]);
    });

    it("recovers nothing when a NOTES heading is the final line with no following entries", () => {
      const recovered = recoverTruncatedEndnotes({
        pageTexts: [["Body text here concludes the section.", "NOTES"].join("\n")],
        structuredMarkers: new Set(),
      });
      expect(recovered).toEqual([]);
    });

    it("does not treat a roman-numeral list as recoverable arabic markers (no sequential 1./2./3. found)", () => {
      const recovered = recoverTruncatedEndnotes({
        pageTexts: [
          ["Body.", "NOTES", "i. first", "ii. second", "iii. third"].join("\n"),
        ],
        structuredMarkers: new Set(),
      });
      expect(recovered).toEqual([]);
    });

    it("recovers exactly three sequential entries at the MIN_ENTRIES_TO_TRUST boundary", () => {
      const recovered = recoverTruncatedEndnotes({
        pageTexts: [["Body.", "NOTES", "1. one", "2. two", "3. three"].join("\n")],
        structuredMarkers: new Set(),
      });
      expect(recovered.map((r) => r.marker)).toEqual(["1", "2", "3"]);
    });
  });
});
