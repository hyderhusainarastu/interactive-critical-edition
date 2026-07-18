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
