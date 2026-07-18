import { describe, expect, it, vi } from "vitest";
import { resolveCitation } from "./index";
import { titleOverlap, type BibliographicSource, type ResolvedRecord } from "./types";

function fakeSource(name: ResolvedRecord["source"], record: ResolvedRecord | null): BibliographicSource {
  return { name, search: vi.fn(async () => record) };
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
});
