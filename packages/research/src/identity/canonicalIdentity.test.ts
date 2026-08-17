import { describe, expect, it } from "vitest";
import {
  classifyRecordRelation,
  planIdentityCollapse,
  titleSimilarity,
  type IdentityCandidate,
} from "./canonicalIdentity";

/**
 * Phase 20.6 unit coverage for the canonical-identity precedence chain:
 *   1 DOI → 2 ISBN → 3 provider id → 4 title/author/year → 5 content hash →
 *   6 fuzzy (suggestion only, never merged).
 * Every scenario the plan names is exercised at the pure level here; the
 * DB-side merge/revert behavior is covered by the worker integration tests.
 */

const base = (over: Partial<IdentityCandidate> & { id: string }): IdentityCandidate => ({
  canonicalTitle: "Ethics with Aristotle",
  authorSurname: "broadie",
  year: 1991,
  linkedWorks: 0,
  linkedResources: 0,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

describe("planIdentityCollapse — precedence chain", () => {
  it("merges DOI duplicates even when their titles disagree (precedence 1)", () => {
    const plan = planIdentityCollapse([
      base({ id: "a", canonicalTitle: "Vice and Reason", doi: "10.1111/abc.123" }),
      base({ id: "b", canonicalTitle: "Vice & Reason in Aristotle", authorSurname: "irwin", doi: "https://doi.org/10.1111/ABC.123" }),
    ]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].method).toBe("doi");
    expect([plan.merges[0].winnerId, ...plan.merges[0].loserIds].sort()).toEqual(["a", "b"]);
  });

  it("merges identical ISBNs — same ISBN means the same edition of the same work (precedence 2)", () => {
    const plan = planIdentityCollapse([
      base({ id: "a", isbn: "978-0-19-508560-0", year: null }),
      base({ id: "b", isbn: "9780195085600", canonicalTitle: "Ethics with Aristotle (paperback)", year: null }),
    ]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].method).toBe("isbn");
  });

  it("keeps different ISBNs with different years as an edition SUGGESTION, never a silent merge (edition distinction)", () => {
    const plan = planIdentityCollapse([
      base({ id: "first", isbn: "9780195085600", year: 1991 }),
      base({ id: "second", isbn: "9780195159219", year: 2002 }),
    ]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.suggestions.some((s) => s.reason.includes("different years") && s.reason.includes("editions"))).toBe(true);
  });

  it("merges on a shared canonical provider id (precedence 3)", () => {
    const plan = planIdentityCollapse([
      base({ id: "a", canonicalTitle: "Aristotle's Philosophy of Action", authorSurname: "charles", year: null, externalId: "openalex:W2031754690" }),
      base({ id: "b", canonicalTitle: "Aristotle's Philosophy of Action (Duckworth)", authorSurname: "charles", year: null, externalId: "OpenAlex:W2031754690" }),
    ]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].method).toBe("provider-id");
  });

  it("merges normalized title + author + year duplicates (precedence 4)", () => {
    const plan = planIdentityCollapse([
      base({ id: "a", canonicalTitle: "The Nicomachean Ethics", authorSurname: "aristotle", year: null }),
      base({ id: "b", canonicalTitle: "Nicomachean Ethics, The", authorSurname: "aristotle", year: null }),
    ]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].method).toBe("title-author-year");
  });

  it("does NOT merge the same title under two different authors — surfaces a suggestion instead", () => {
    const plan = planIdentityCollapse([
      base({ id: "a", canonicalTitle: "Ethics", authorSurname: "spinoza", year: null }),
      base({ id: "b", canonicalTitle: "Ethics", authorSurname: "aristotle", year: null }),
    ]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.suggestions.some((s) => s.reason.includes("different authors") && s.reason.includes("never merged automatically"))).toBe(true);
  });

  it("folds a title-only (review-derived) identity into its UNIQUE authored match, and only then", () => {
    const folded = planIdentityCollapse([
      base({ id: "review", canonicalTitle: "Ethics with Aristotle", authorSurname: null, year: null }),
      base({ id: "book", canonicalTitle: "Ethics with Aristotle", authorSurname: "broadie", year: null }),
    ]);
    expect(folded.merges).toHaveLength(1);
    expect(folded.merges[0].winnerId).toBe("book");
    expect(folded.merges[0].loserIds).toEqual(["review"]);

    const ambiguous = planIdentityCollapse([
      base({ id: "review", canonicalTitle: "Ethics", authorSurname: null, year: null }),
      base({ id: "a", canonicalTitle: "Ethics", authorSurname: "spinoza", year: null }),
      base({ id: "b", canonicalTitle: "Ethics", authorSurname: "aristotle", year: null }),
    ]);
    expect(ambiguous.merges).toHaveLength(0);
    expect(ambiguous.suggestions.some((s) => s.reason.includes("ambiguous"))).toBe(true);
  });

  it("merges identities sharing a verified uploaded content hash (precedence 5 — same uploaded bytes)", () => {
    const plan = planIdentityCollapse([
      base({ id: "a", canonicalTitle: "Vice and Reason", authorSurname: "irwin", year: null, contentHashes: ["e0a1172f3273f75f98"] }),
      base({ id: "b", canonicalTitle: "Irwin ViceReason 2001", authorSurname: null, year: null, contentHashes: ["e0a1172f3273f75f98"] }),
    ]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.merges[0].method).toBe("content-hash");
    expect(plan.merges[0].evidence).toContain("content hash");
  });

  it("reports fuzzy title similarity as SUGGESTION only — never a merge (precedence 6)", () => {
    const plan = planIdentityCollapse([
      base({ id: "a", canonicalTitle: "Aristotle's Ethical Theory", authorSurname: "hardie", year: null }),
      base({ id: "b", canonicalTitle: "Aristotle's Ethical Theory: An Introduction", authorSurname: "hardie", year: null }),
    ]);
    expect(plan.merges).toHaveLength(0);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0].reason).toContain("suggestion only");
    expect(plan.suggestions[0].similarity).toBeGreaterThanOrEqual(0.5);
    expect(plan.suggestions[0].similarity).toBeLessThan(1);
  });

  it("records the STRONGEST method that connected a group and picks a deterministic winner", () => {
    const plan = planIdentityCollapse([
      base({ id: "rich", doi: "10.1234/x", linkedWorks: 2, linkedResources: 5 }),
      base({ id: "poor", doi: "10.1234/x", linkedWorks: 0, linkedResources: 1 }),
      base({ id: "titleTwin", doi: null, year: 1991 }),
    ]);
    expect(plan.merges).toHaveLength(1);
    const merge = plan.merges[0];
    expect(merge.winnerId).toBe("rich");
    expect(merge.loserIds.sort()).toEqual(["poor", "titleTwin"]);
    expect(merge.method).toBe("doi"); // strongest method in the group, not the weakest
  });

  it("bounds fuzzy output at maxSuggestions", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      base({ id: `c${i}`, canonicalTitle: `Aristotle virtue theory topic${i}word study`, authorSurname: "ross", year: null }),
    );
    const plan = planIdentityCollapse(candidates, { maxSuggestions: 3 });
    expect(plan.merges).toHaveLength(0);
    expect(plan.suggestions.length).toBeLessThanOrEqual(3);
  });
});

describe("classifyRecordRelation — record-to-work vocabulary", () => {
  const work = { canonicalTitle: "Ethics with Aristotle", authorSurname: "broadie", year: 1991, isbn: "9780195085600" };

  it("identifies the same work by DOI, outranking everything else", () => {
    const result = classifyRecordRelation(
      { title: "Completely different-looking title", doi: "10.1234/same" },
      { canonicalTitle: "Ethics with Aristotle", doi: "10.1234/same" },
    );
    expect(result).toMatchObject({ relation: "same_work", confident: true });
  });

  it("identifies the same edition by identical ISBN", () => {
    const result = classifyRecordRelation({ title: "Ethics with Aristotle (OUP)", isbn: "978-0195085600" }, work);
    expect(result).toMatchObject({ relation: "same_work", confident: true });
    expect(result.evidence).toContain("ISBN");
  });

  it("classifies a review as review_of_work — attached, never the work itself", () => {
    const result = classifyRecordRelation({ title: "[Recensão a] Ethics with Aristotle", authors: ["A Reviewer"] }, work);
    expect(result).toMatchObject({ relation: "review_of_work", confident: true });
  });

  it("classifies a translation correctly", () => {
    const result = classifyRecordRelation(
      { title: "Ethics with Aristotle, translated by Maria Rossi", authors: ["Maria Rossi"] },
      work,
    );
    expect(result).toMatchObject({ relation: "translation_of_work", confident: true });
  });

  it("classifies a commentary on the work", () => {
    const result = classifyRecordRelation({ title: "A Commentary on Ethics with Aristotle", authors: ["W. D. Ross"] }, work);
    expect(result).toMatchObject({ relation: "commentary_on_work", confident: true });
  });

  it("classifies a chapter within the work", () => {
    const result = classifyRecordRelation({ title: "Ethics with Aristotle, Chapter 4", authors: ["Sarah Broadie"] }, work);
    expect(result).toMatchObject({ relation: "chapter_within_work", confident: true });
  });

  it("classifies an edition-marker record as different_edition of the same work", () => {
    const result = classifyRecordRelation({ title: "Ethics with Aristotle, 2nd edition", authors: ["Sarah Broadie"] }, work);
    expect(result).toMatchObject({ relation: "different_edition", confident: true });
  });

  it("classifies same title/author with different years as different_edition", () => {
    const result = classifyRecordRelation({ title: "Ethics with Aristotle", authors: ["Sarah Broadie"], year: 2002 }, work);
    expect(result).toMatchObject({ relation: "different_edition", confident: true });
  });

  it("marks an article ABOUT the work as article_about_work, and only ever as a non-confident suggestion", () => {
    const result = classifyRecordRelation(
      { title: "Virtue and Habituation in Ethics with Aristotle Reconsidered", resourceType: "article", authors: ["J. Smith"] },
      work,
    );
    expect(result).toMatchObject({ relation: "article_about_work", confident: false });
  });

  it("refuses to connect a same-title record under a different author", () => {
    const result = classifyRecordRelation({ title: "Ethics with Aristotle", authors: ["Somebody Else"] }, work);
    expect(result).toMatchObject({ relation: "distinct", confident: false });
  });

  it("returns distinct for an unrelated record", () => {
    const result = classifyRecordRelation({ title: "A History of Rome", authors: ["T. Mommsen"] }, work);
    expect(result).toMatchObject({ relation: "distinct", confident: false });
  });
});

describe("titleSimilarity", () => {
  it("is 1 for identical normalized titles and 0 for disjoint ones", () => {
    expect(titleSimilarity("The Nicomachean Ethics", "Nicomachean Ethics")).toBe(1);
    expect(titleSimilarity("Nicomachean Ethics", "History Rome")).toBe(0);
  });
});
