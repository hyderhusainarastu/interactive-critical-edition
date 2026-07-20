import { describe, expect, it } from "vitest";
import { deriveWorkIdentity, groupByWork, stripEditionMarkers, stripReviewFraming } from "./workIdentity";
import type { RawResource } from "./types";

/**
 * Every title below is one a real production run actually accepted (canary 10,
 * 2026-07-20) while researching a paper that cites eight works. All were
 * individually correct records; the failure was that the reader saw the same
 * book up to five times.
 */

const R = (p: Partial<RawResource> & { title: string }): RawResource => ({
  provider: "crossref",
  resourceType: "book",
  authors: [],
  year: null,
  url: null,
  doi: null,
  isbn: null,
  snippet: null,
  venue: null,
  popularity: null,
  raw: null,
  ...p,
});

const CITED = new Set(["broadie", "hardie", "charles", "annas", "green", "sherman", "rogers", "smith"]);
const read = (r: RawResource) => r;

describe("review framing is stripped from a title", () => {
  it.each([
    ["[Recensão a] Aristotle's Philosophy of Action", "Aristotle's Philosophy of Action"],
    ["Review: Ethics with Aristotle", "Ethics with Aristotle"],
    ["Book Review: Ethics with Aristotle", "Ethics with Aristotle"],
    ["Aristotle's Philosophy of Action. Reviewed by Jane Doe", "Aristotle's Philosophy of Action"],
    ["Ethics with Aristotle, by Sarah Broadie", "Ethics with Aristotle"],
  ])("%s", (input, expected) => {
    expect(stripReviewFraming(input).title).toBe(expected);
  });

  it("leaves an ordinary title untouched", () => {
    expect(stripReviewFraming("Aristotle's Ethical Theory").title).toBe("Aristotle's Ethical Theory");
    expect(stripReviewFraming("Aristotle's Ethical Theory").markers).toEqual([]);
  });

  it("never strips a title down to nothing", () => {
    // A pathological title must degrade to itself rather than an empty key.
    expect(stripReviewFraming("Review:").title.length).toBeGreaterThan(0);
  });
});

describe("edition markers do not fragment a work", () => {
  it.each([
    ["Aristotle's Ethical Theory, ed. 2", "Aristotle's Ethical Theory"],
    ["Aristotle's Ethical Theory, 2nd edition", "Aristotle's Ethical Theory"],
    ["Prolegomena to Ethics (revised edition)", "Prolegomena to Ethics"],
  ])("%s", (input, expected) => {
    expect(stripEditionMarkers(input).title).toBe(expected);
  });
});

describe("grouping the real canary-10 duplicates", () => {
  it("collapses Hardie's book and its editions into one work", () => {
    const records = [
      R({ title: "Aristotle's Ethical Theory", authors: ["W. F. R. Hardie"], year: 1968 }),
      R({ title: "Aristotle's Ethical Theory", authors: ["William Francis Ross Hardie"], year: 1980 }),
      R({ title: "Aristotle's Ethical Theory.", authors: ["Hardie"] }),
      R({ title: "Aristotle's Ethical Theory, ed. 2", authors: ["W.F.R. Hardie"], year: 1980 }),
    ];
    const groups = groupByWork(records, read, { citedAuthorSurnames: CITED });
    expect(groups).toHaveLength(1);
    expect(groups[0].canonicalTitle).toBe("Aristotle's Ethical Theory");
    expect(groups[0].authorSurname).toBe("hardie");
    expect(groups[0].related).toHaveLength(3);
  });

  it("attaches reviews to Charles's book rather than listing them beside it", () => {
    const records = [
      R({ title: "Aristotle's Philosophy of Action", authors: ["David Charles"], year: 1984, isbn: "9780715618783" }),
      R({ title: "Aristotle's Philosophy of Action.", authors: ["David Charles"] }),
      R({ title: "[Recensão a] Aristotle's Philosophy of Action", authors: ["A Reviewer"], doi: "10.1234/rev" }),
      R({ title: "David Charles , Aristotle's Philosophy of Action . Reviewed by Someone", authors: ["Someone"], doi: "10.1234/rev2" }),
    ];
    const groups = groupByWork(records, read, { citedAuthorSurnames: CITED });
    expect(groups).toHaveLength(1);
    const g = groups[0];
    // The book itself represents the work — not a review of it.
    expect(g.primary.authors).toContain("David Charles");
    expect(g.primary.isbn).toBe("9780715618783");
    expect(g.related.map((r) => r.role)).toContain("review");
  });

  it("keeps genuinely different works apart", () => {
    const records = [
      R({ title: "Ethics with Aristotle", authors: ["Sarah Broadie"] }),
      R({ title: "Aristotle's Ethical Theory", authors: ["W.F.R. Hardie"] }),
      R({ title: "Prolegomena to Ethics", authors: ["T. H. Green"] }),
      R({ title: "The Fabric of Character", authors: ["Nancy Sherman"] }),
    ];
    expect(groupByWork(records, read, { citedAuthorSurnames: CITED })).toHaveLength(4);
  });

  it("does not merge two works that merely share an author", () => {
    const records = [
      R({ title: "Intelligent Virtue", authors: ["Julia Annas"] }),
      R({ title: "The Morality of Happiness", authors: ["Julia Annas"] }),
    ];
    expect(groupByWork(records, read, { citedAuthorSurnames: CITED })).toHaveLength(2);
  });

  it("collapses the five Charles records the canary actually accepted", () => {
    // Including the two Japanese-language review articles, which are reviews of
    // the same book and must not appear as separate Library entries.
    const records = [
      R({ title: "Aristotle's Philosophy of Action", authors: ["David Charles"], year: 1984 }),
      R({ title: "Aristotle's Philosophy of Action.", authors: ["David Charles"] }),
      R({ title: "Aristotle's Philosophy of Action - David Charles: Aristotle's Philosophy of Action", authors: ["Reviewer"] }),
      R({ title: "David Charles , Aristotle's Philosophy of Action . Reviewed by X", authors: ["X"] }),
      R({ title: "[Recensão a] Aristotle's Philosophy of Action", authors: ["Y"] }),
    ];
    const groups = groupByWork(records, read, { citedAuthorSurnames: CITED });
    expect(groups.length).toBeLessThanOrEqual(2);
    const biggest = groups.sort((a, b) => b.related.length - a.related.length)[0];
    expect(biggest.related.length).toBeGreaterThanOrEqual(3);
  });
});

describe("work identity is explainable", () => {
  it("records why a record was treated as a review", () => {
    const id = deriveWorkIdentity(
      R({ title: "[Recensão a] Ethics with Aristotle", authors: ["Reviewer"] }),
      { citedAuthorSurnames: CITED },
    );
    expect(id.role).toBe("review");
    expect(id.evidence).toContain("bracketed review marker");
  });

  it("prefers the cited author over the reviewer when both are listed", () => {
    // Catalogues put reviewer and author in the same field. The one the citing
    // document names is the work's author.
    const id = deriveWorkIdentity(
      R({ title: "Ethics with Aristotle", authors: ["Jane Reviewer", "Sarah Broadie"] }),
      { citedAuthorSurnames: CITED },
    );
    expect(id.authorSurname).toBe("broadie");
  });

  it("is deterministic", () => {
    const rec = R({ title: "Ethics with Aristotle", authors: ["Sarah Broadie"], year: 1991 });
    expect(deriveWorkIdentity(rec, { citedAuthorSurnames: CITED })).toEqual(
      deriveWorkIdentity(rec, { citedAuthorSurnames: CITED }),
    );
  });
});
