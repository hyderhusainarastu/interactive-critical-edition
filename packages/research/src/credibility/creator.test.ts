import { describe, expect, it } from "vitest";
import { corroborateCreator, identifyCreator } from "./creator";
import type { RawResource } from "./types";

function resource(patch: Partial<RawResource> = {}): RawResource {
  return {
    provider: "crossref",
    resourceType: "article",
    title: "Vice and Reason",
    authors: ["Terence Irwin"],
    year: 2001,
    url: null,
    doi: null,
    isbn: null,
    snippet: null,
    venue: null,
    popularity: null,
    raw: null,
    ...patch,
  };
}

describe("identifyCreator", () => {
  it("reads a named person off provider metadata", () => {
    const c = identifyCreator(resource());
    expect(c.kind).toBe("person");
    expect(c.displayName).toBe("Terence Irwin");
    expect(c.verification).toBe("named");
    expect(c.evidence.join(" ")).toContain("crossref");
  });

  it("recognizes an organization rather than calling a press a person", () => {
    const c = identifyCreator(resource({ authors: ["Oxford University Press"] }));
    expect(c.kind).toBe("organization");
  });

  it("upgrades to institutional when the host is a university or publisher", () => {
    const c = identifyCreator(
      resource({ provider: "tavily", resourceType: "webpage", url: "https://philosophy.stanford.edu/x", authors: ["Jane Doe"] }),
    );
    expect(c.verification).toBe("institutional");
    expect(c.host).toContain("stanford.edu");
  });

  it("treats a handle as pseudonymous, not as a name", () => {
    const c = identifyCreator(resource({ provider: "bluesky", resourceType: "social_post", authors: ["someone.bsky.social"] }));
    expect(c.kind).toBe("channel");
    expect(c.handle).toBe("someone.bsky.social");
    expect(c.displayName).toBeNull();
    expect(c.verification).toBe("pseudonymous");
  });

  it("keeps a one-word real name a name", () => {
    // "Aristotle" has no whitespace either — the handle test must not fire.
    expect(identifyCreator(resource({ authors: ["Aristotle"] })).verification).toBe("named");
  });

  it("records anonymity as anonymity, not as a low score", () => {
    const c = identifyCreator(resource({ provider: "mastodon", resourceType: "social_post", authors: [] }));
    expect(c.verification).toBe("anonymous");
    expect(c.displayName).toBeNull();
  });

  it("distinguishes an unbylined institutional page from an anonymous post", () => {
    const c = identifyCreator(resource({ provider: "tavily", resourceType: "webpage", authors: [], url: "https://www.ox.ac.uk/page" }));
    expect(c.verification).toBe("institutional");
    expect(c.kind).toBe("organization");
  });
});

describe("corroborateCreator", () => {
  it("promotes a named creator on scholarly-record evidence", () => {
    const c = corroborateCreator(identifyCreator(resource()), { scholarlyRecordMatches: 12 });
    expect(c.verification).toBe("scholarly_record");
    expect(c.evidence.join(" ")).toContain("12 record");
  });

  it("promotes to institutional on a reported affiliation", () => {
    const c = corroborateCreator(identifyCreator(resource()), { institutionalAffiliation: "Oxford" });
    expect(c.verification).toBe("institutional");
  });

  it("never invents a creator for an anonymous source", () => {
    const anon = identifyCreator(resource({ provider: "mastodon", resourceType: "social_post", authors: [] }));
    const c = corroborateCreator(anon, { scholarlyRecordMatches: 99 });
    expect(c.verification).toBe("anonymous");
    expect(c.displayName).toBeNull();
  });

  it("leaves verification alone with no corroborating evidence", () => {
    const c = corroborateCreator(identifyCreator(resource()), {});
    expect(c.verification).toBe("named");
  });
});
