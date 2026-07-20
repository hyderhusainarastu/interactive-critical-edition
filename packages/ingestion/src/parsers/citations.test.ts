import { describe, expect, it } from "vitest";
import { extractCitations } from "./citations";

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
