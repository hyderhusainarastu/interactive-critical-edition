import { describe, expect, it } from "vitest";
import { cslToAPA, cslToBibTeX, cslToChicago, cslToRIS, formatCitationList } from "./citationFormats";
import type { CslJson } from "@/lib/writer";

/**
 * Phase 29.3: BibTeX/RIS/APA/Chicago citation-export formatters. Pure
 * functions of CSL-JSON, so no DB/network is needed. Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `feedback.test.ts`/`graphConnectivity.test.ts`).
 *
 * Expected strings below were hand-derived from the real BibTeX/RIS/APA 7/
 * Chicago 17 (author-date) conventions, not just "whatever the code
 * currently prints" — several were double-checked against a style manual
 * while writing this file, and one (a dangling ", " in Chicago's
 * family-only author formatting, e.g. "Aristotle,") was a real bug this
 * process caught and fixed in `citationFormats.ts` before these assertions
 * were finalized.
 */

const book: CslJson = {
  type: "book",
  title: "Nicomachean Ethics",
  author: [{ family: "Aristotle" }],
  issued: { "date-parts": [[1999]] },
  publisher: "Hackett Publishing",
  ISBN: "978-0-87220-464-5",
};

const article: CslJson = {
  type: "article-journal",
  title: "Vice and the Voluntary",
  author: [{ family: "Roochnik", given: "David" }],
  issued: { "date-parts": [[2007]] },
  "container-title": "The Review of Metaphysics",
  volume: "60",
  issue: "3",
  page: "537-561",
  DOI: "10.2307/20130382",
};

const chapter: CslJson = {
  type: "chapter",
  title: "Akrasia and the Structure of the Soul",
  author: [{ family: "Kosman", given: "L. A." }],
  issued: { "date-parts": [[1980]] },
  "container-title": "Essays on Aristotle's Ethics",
  page: "103-116",
  // Deliberately no publisher: exercises the BibTeX missing-required-field
  // comment for a real, plausible gap (a chapter citation with a book title
  // but no captured publisher).
};

const webpage: CslJson = {
  type: "webpage",
  title: "Aristotle's Ethics",
  author: [{ family: "Kraut", given: "Richard" }],
  URL: "https://plato.stanford.edu/entries/aristotle-ethics/",
  // Deliberately no issued/year: exercises "omit, never invent" — no
  // "(n.d.)" or "undefined" leaking into APA/Chicago output.
};

const unicodeAuthors: CslJson = {
  type: "article-journal",
  title: "Über die Tugendlehre",
  author: [
    { family: "Müller", given: "Anne-Kathrin" },
    { family: "Søndergaard", given: "Bjørn" },
  ],
  issued: { "date-parts": [[2015]] },
  "container-title": "Zeitschrift für Philosophie",
  volume: "12",
};

const specialChars: CslJson = {
  type: "article-journal",
  title: "Cost & Benefit: A Study of 50% Efficiency #1",
  author: [{ literal: "Anonymous Collective" }],
  issued: { "date-parts": [[2020]] },
  "container-title": "Journal of Odd Symbols",
};

const barebones: CslJson = {
  type: "book",
  title: "Untitled Treatise",
  // No author, no publisher, no year at all: exercises multiple
  // simultaneous missing required BibTeX fields in one comment line.
};

const doiWithPrefix: CslJson = {
  type: "article-journal",
  title: "Prefix Handling Test",
  DOI: "https://doi.org/10.1000/xyz123",
};

// --- BibTeX --------------------------------------------------------------

describe("cslToBibTeX", () => {
  it("book: no missing-field comment, correct @book entry", () => {
    expect(cslToBibTeX(book)).toBe(
      "@book{Aristotle1999Nicomachean,\n" +
        "  title = {Nicomachean Ethics},\n" +
        "  author = {Aristotle},\n" +
        "  publisher = {Hackett Publishing},\n" +
        "  year = {1999},\n" +
        "  isbn = {978-0-87220-464-5},\n" +
        "}",
    );
  });

  it("journal article: single-hyphen page range becomes BibTeX's double-hyphen range", () => {
    expect(cslToBibTeX(article)).toBe(
      "@article{Roochnik2007Vice,\n" +
        "  title = {Vice and the Voluntary},\n" +
        "  author = {Roochnik, David},\n" +
        "  journal = {The Review of Metaphysics},\n" +
        "  year = {2007},\n" +
        "  volume = {60},\n" +
        "  number = {3},\n" +
        "  pages = {537--561},\n" +
        "  doi = {10.2307/20130382},\n" +
        "}",
    );
  });

  it("chapter missing publisher: honest missing-field comment, entry still emitted with what's present", () => {
    expect(cslToBibTeX(chapter)).toBe(
      "% Missing required BibTeX field(s) for this incollection entry: publisher\n" +
        "@incollection{Kosman1980Akrasia,\n" +
        "  title = {Akrasia and the Structure of the Soul},\n" +
        "  author = {Kosman, L. A.},\n" +
        "  booktitle = {Essays on Aristotle's Ethics},\n" +
        "  year = {1980},\n" +
        "  pages = {103--116},\n" +
        "}",
    );
  });

  it("book with only a title: multiple missing fields named honestly, key falls back to the title alone", () => {
    expect(cslToBibTeX(barebones)).toBe(
      "% Missing required BibTeX field(s) for this book entry: author, publisher, year\n" +
        "@book{Untitled,\n" +
        "  title = {Untitled Treatise},\n" +
        "}",
    );
  });

  it("LaTeX special characters (&, %, #) are escaped; a literal (organization) author name is used as-is", () => {
    expect(cslToBibTeX(specialChars)).toBe(
      "@article{AnonymousCollective2020Cost,\n" +
        "  title = {Cost \\& Benefit: A Study of 50\\% Efficiency \\#1},\n" +
        "  author = {Anonymous Collective},\n" +
        "  journal = {Journal of Odd Symbols},\n" +
        "  year = {2020},\n" +
        "}",
    );
  });
});

// --- RIS -------------------------------------------------------------------

describe("cslToRIS", () => {
  it("emits a BOOK entry with its publisher and ISBN", () => {
    expect(cslToRIS(book)).toBe(
      ["TY  - BOOK", "TI  - Nicomachean Ethics", "AU  - Aristotle", "PY  - 1999", "PB  - Hackett Publishing", "SN  - 978-0-87220-464-5", "ER  - "].join("\n"),
    );
  });

  it("emits a JOUR entry splitting the page range into SP/EP", () => {
    expect(cslToRIS(article)).toBe(
      [
        "TY  - JOUR",
        "TI  - Vice and the Voluntary",
        "AU  - Roochnik, David",
        "PY  - 2007",
        "JO  - The Review of Metaphysics",
        "VL  - 60",
        "IS  - 3",
        "SP  - 537",
        "EP  - 561",
        "DO  - 10.2307/20130382",
        "ER  - ",
      ].join("\n"),
    );
  });

  it("no year: PY line omitted entirely, not emitted empty", () => {
    expect(cslToRIS(webpage)).toBe(
      ["TY  - ELEC", "TI  - Aristotle's Ethics", "AU  - Kraut, Richard", "UR  - https://plato.stanford.edu/entries/aristotle-ethics/", "ER  - "].join("\n"),
    );
  });

  it("one AU line per author, unicode passed through untouched", () => {
    expect(cslToRIS(unicodeAuthors)).toBe(
      [
        "TY  - JOUR",
        "TI  - Über die Tugendlehre",
        "AU  - Müller, Anne-Kathrin",
        "AU  - Søndergaard, Bjørn",
        "PY  - 2015",
        "JO  - Zeitschrift für Philosophie",
        "VL  - 12",
        "ER  - ",
      ].join("\n"),
    );
  });
});

// --- APA ---------------------------------------------------------------

describe("cslToAPA", () => {
  it("formats a book", () => {
    expect(cslToAPA(book)).toBe("Aristotle (1999). Nicomachean Ethics. Hackett Publishing.");
  });

  it("formats a journal article with volume, issue, pages and DOI", () => {
    expect(cslToAPA(article)).toBe(
      "Roochnik, D. (2007). Vice and the Voluntary. The Review of Metaphysics, 60(3), 537-561. https://doi.org/10.2307/20130382",
    );
  });

  it("formats a chapter", () => {
    expect(cslToAPA(chapter)).toBe("Kosman, L. A. (1980). Akrasia and the Structure of the Soul. Essays on Aristotle's Ethics, 103-116.");
  });

  it("no year and no publisher/container: both omitted rather than a fabricated '(n.d.)' or empty container", () => {
    expect(cslToAPA(webpage)).toBe("Kraut, R. Aristotle's Ethics. https://plato.stanford.edu/entries/aristotle-ethics/");
  });

  it("hyphenated given name keeps its hyphen across the two initials", () => {
    expect(cslToAPA(unicodeAuthors)).toBe("Müller, A.-K., & Søndergaard, B. (2015). Über die Tugendlehre. Zeitschrift für Philosophie, 12.");
  });

  it("no author and no year: both omitted (never 'Unknown Author' / '(n.d.)'); an already-prefixed DOI is not double-prefixed", () => {
    expect(cslToAPA(doiWithPrefix)).toBe("Prefix Handling Test. https://doi.org/10.1000/xyz123");
  });
});

// --- Chicago (author-date) ----------------------------------------------

describe("cslToChicago", () => {
  it("a family-only author (no given name) never leaves a dangling comma", () => {
    expect(cslToChicago(book)).toBe("Aristotle 1999. “Nicomachean Ethics.” Hackett Publishing.");
  });

  it("formats a journal article with volume, issue, pages and DOI", () => {
    expect(cslToChicago(article)).toBe(
      "Roochnik, David 2007. “Vice and the Voluntary.” The Review of Metaphysics 60 (3): 537-561. https://doi.org/10.2307/20130382.",
    );
  });

  it("a chapter's container is prefixed with 'In '", () => {
    expect(cslToChicago(chapter)).toBe("Kosman, L. A. 1980. “Akrasia and the Structure of the Soul.” In Essays on Aristotle's Ethics: 103-116.");
  });

  it("no year: omitted, not '(n.d.)'", () => {
    expect(cslToChicago(webpage)).toBe("Kraut, Richard “Aristotle's Ethics.” https://plato.stanford.edu/entries/aristotle-ethics/.");
  });

  it("two authors: first family-first, second given-first, joined by ', and '", () => {
    expect(cslToChicago(unicodeAuthors)).toBe("Müller, Anne-Kathrin, and Bjørn Søndergaard 2015. “Über die Tugendlehre.” Zeitschrift für Philosophie 12.");
  });
});

// --- formatCitationList (combining / empty-list edge) ---------------------

describe("formatCitationList", () => {
  it("empty citation list produces an empty string, not a malformed entry", () => {
    expect(formatCitationList([], "bibtex")).toBe("");
    expect(formatCitationList([], "ris")).toBe("");
    expect(formatCitationList([], "apa")).toBe("");
    expect(formatCitationList([], "chicago")).toBe("");
  });

  it("multiple citations are double-newline separated, in input order", () => {
    const combined = formatCitationList([book, article], "bibtex");
    expect(combined).toBe(`${cslToBibTeX(book)}\n\n${cslToBibTeX(article)}`);
  });
});
