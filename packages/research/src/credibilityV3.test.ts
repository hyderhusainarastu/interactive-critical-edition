import { describe, expect, it } from "vitest";
import {
  assessCredibilityV3,
  learningOrderingScore,
  orderingScore,
  pedagogicalValue,
  processLabel,
  publicationRigor,
} from "./credibilityV3";
import type { RawResource } from "./types";

function resource(patch: Partial<RawResource> = {}): RawResource {
  return {
    provider: "crossref",
    resourceType: "article",
    title: "Vice and Reason",
    authors: ["Terence Irwin"],
    year: 2001,
    url: null,
    doi: "10.1111/example",
    isbn: null,
    snippet: null,
    venue: "Journal of Ethics",
    popularity: null,
    raw: null,
    ...patch,
  };
}

const lecture = resource({
  provider: "youtube",
  resourceType: "video",
  title: "Aristotle on vice — an introduction",
  authors: ["Jane Doe"],
  doi: null,
  venue: null,
  url: "https://www.youtube.com/watch?v=abc",
});

describe("publicationRigor", () => {
  it("claims peer review only where the record implies it", () => {
    expect(publicationRigor(resource()).peerReviewed).toBe(true);
    expect(publicationRigor(resource({ doi: null })).peerReviewed).toBeNull();
    expect(publicationRigor(lecture).peerReviewed).toBe(false);
  });

  it("says unknown rather than no for a catalogue record", () => {
    const r = publicationRigor(resource({ provider: "openlibrary", resourceType: "book", doi: null, isbn: "978" }));
    expect(r.peerReviewed).toBeNull();
    expect(r.why).toContain("not peer");
  });
});

describe("pedagogicalValue", () => {
  it("rewards material that presents itself as teaching", () => {
    expect(pedagogicalValue(resource({ title: "An Introduction to Aristotle's Ethics" })).score).toBeGreaterThan(0.8);
    expect(pedagogicalValue(resource({ title: "The Cambridge Companion to Aristotle" })).score).toBeGreaterThan(0.8);
  });

  it("scores a specialist intervention low without calling it bad", () => {
    const p = pedagogicalValue(resource({ title: "A Note on Bekker 1106a14, Reconsidered" }));
    expect(p.score).toBeLessThan(0.4);
    expect(p.why).toContain("already in the debate");
  });
});

describe("assessCredibilityV3", () => {
  it("separates the dimensions instead of collapsing them", () => {
    // The case the whole design exists for: an expert lecture and a narrow
    // paper must NOT be ordered by a single notion of "good".
    const paper = assessCredibilityV3(resource(), { relevance: 0.9, evidenceStrength: 0.5 });
    const talk = assessCredibilityV3(lecture, { relevance: 0.9, evidenceStrength: 0.5 });

    expect(paper.dimensions.publicationRigor).toBeGreaterThan(talk.dimensions.publicationRigor);
    expect(talk.dimensions.pedagogicalValue).toBeGreaterThan(paper.dimensions.pedagogicalValue);
    // ...and each is legible on its own, not only through the roll-up.
    expect(paper.rationale).toContain("publication rigor");
    expect(talk.rationale).toContain("pedagogical value");
  });

  it("labels a lecture honestly as not peer-reviewed while still accepting it", () => {
    expect(processLabel(lecture)).toBe("Not peer-reviewed");
    expect(assessCredibilityV3(lecture, { relevance: 0.9, evidenceStrength: 0.4 }).dimensions.pedagogicalValue)
      .toBeGreaterThan(0.5);
  });

  it("records an unidentified creator as an absence of evidence, not a verdict", () => {
    const anon = assessCredibilityV3(
      resource({ provider: "mastodon", resourceType: "social_post", authors: [], doi: null, venue: null }),
      { relevance: 0.5, evidenceStrength: 0.1 },
    );
    expect(anon.dimensions.creatorExpertise).toBe(0);
    expect(anon.rationale).toContain("absence of evidence");
  });

  it("carries popularity as a reported fact with its unit", () => {
    const a = assessCredibilityV3(resource({ popularity: 240 }), { relevance: 0.8, evidenceStrength: 0.5 });
    expect(a.popularity).toEqual({ value: 240, kind: "citations", provider: "crossref" });
    const v = assessCredibilityV3({ ...lecture, popularity: 1_000_000 }, { relevance: 0.8, evidenceStrength: 0.5 });
    expect(v.popularity.kind).toBe("views");
  });

  it("POPULARITY NEVER MOVES A SCORE — the rule most likely to erode later", () => {
    const unpopular = assessCredibilityV3(resource({ popularity: 0 }), { relevance: 0.8, evidenceStrength: 0.5 });
    const viral = assessCredibilityV3(resource({ popularity: 5_000_000 }), { relevance: 0.8, evidenceStrength: 0.5 });
    expect(viral.dimensions).toEqual(unpopular.dimensions);
    expect(orderingScore(viral.dimensions)).toBe(orderingScore(unpopular.dimensions));
    expect(learningOrderingScore(viral.dimensions)).toBe(learningOrderingScore(unpopular.dimensions));
    expect(viral.authority).toBe(unpopular.authority);
  });

  it("orders for learning differently than for research, on the same data", () => {
    const paper = assessCredibilityV3(resource({ title: "A Note on Bekker 1106a14, Reconsidered" }), {
      relevance: 0.9,
      evidenceStrength: 0.5,
    });
    const talk = assessCredibilityV3(lecture, { relevance: 0.9, evidenceStrength: 0.5 });

    expect(orderingScore(paper.dimensions)).toBeGreaterThan(orderingScore(talk.dimensions));
    expect(learningOrderingScore(talk.dimensions)).toBeGreaterThan(learningOrderingScore(paper.dimensions));
  });

  it("puts a rigorous introduction above a lecture, and junk below both", () => {
    // Guards the learning ordering against over-correcting: teaching value
    // outweighs a specialist paper, but never replaces rigor outright.
    const intro = assessCredibilityV3(resource({ title: "An Introduction to Aristotle's Ethics" }), {
      relevance: 0.9,
      evidenceStrength: 0.5,
    });
    const talk = assessCredibilityV3(lecture, { relevance: 0.9, evidenceStrength: 0.5 });
    const anonymous = assessCredibilityV3(
      resource({ provider: "mastodon", resourceType: "social_post", authors: [], doi: null, venue: null, title: "aristotle thread" }),
      { relevance: 0.9, evidenceStrength: 0.5 },
    );

    const rank = learningOrderingScore;
    expect(rank(intro.dimensions)).toBeGreaterThan(rank(talk.dimensions));
    expect(rank(talk.dimensions)).toBeGreaterThan(rank(anonymous.dimensions));
  });

  it("keeps relevance and evidence strength as supplied, clamped to 0..1", () => {
    const a = assessCredibilityV3(resource(), { relevance: 1.7, evidenceStrength: -0.4 });
    expect(a.dimensions.relevance).toBe(1);
    expect(a.dimensions.evidenceStrength).toBe(0);
  });
});
