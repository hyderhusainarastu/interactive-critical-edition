import { describe, expect, it, vi } from "vitest";
import { generateLaneQueries, generateQueries, gradeClaims, heuristicLaneQueries, heuristicNote, heuristicQueries, quoteIsGrounded, synthesizeNote, type StructuredCaller } from "./synthesize";
import type { RawResource } from "./types";

function sampleResource(over: Partial<RawResource> = {}): RawResource {
  return {
    provider: "crossref",
    resourceType: "article",
    title: "On Virtue",
    authors: ["Jane Doe"],
    year: 2010,
    url: null,
    doi: "10.1000/x",
    isbn: null,
    snippet: null,
    venue: null,
    popularity: null,
    raw: null,
    ...over,
  };
}

describe("heuristicQueries", () => {
  it("builds title/author rounds plus a citation round", () => {
    const rounds = heuristicQueries({ title: "Being and Time", author: "Heidegger" }, ["Kant, Critique of Pure Reason"]);
    expect(rounds[0]).toContain("Being and Time");
    expect(rounds[0].some((q) => q.includes("Heidegger"))).toBe(true);
    expect(rounds[1][0]).toContain("Kant");
  });
});

describe("generateQueries", () => {
  it("falls back to heuristics when no model is available", async () => {
    const caller: StructuredCaller = { available: false, call: vi.fn() };
    const out = await generateQueries(caller, { primary: { title: "Ethics", author: "Spinoza" }, citationTexts: [], model: "m" });
    expect(out.usedModel).toBe(false);
    expect(out.rounds[0].length).toBeGreaterThan(0);
  });

  it("uses and validates the model's queries when available", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({ rounds: [["good query one", "  "], ["another decent query"]] }),
        promptTokens: 3,
        completionTokens: 4,
        model: p.model,
      })),
    };
    const out = await generateQueries(caller, { primary: { title: "Ethics" }, citationTexts: [], model: "m" });
    expect(out.usedModel).toBe(true);
    // The blank query is dropped by validation.
    expect(out.rounds[0]).toEqual(["good query one"]);
  });

  it("falls back if the model returns an unusable shape", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({ data: p.validate({ rounds: "nope" }), promptTokens: 0, completionTokens: 0, model: p.model })),
    };
    // The validate() throw propagates out of call() in this mock; generateQueries catches it.
    const out = await generateQueries(caller, { primary: { title: "Ethics" }, citationTexts: [], model: "m" });
    expect(out.usedModel).toBe(false);
  });
});

describe("quoteIsGrounded (anti-hallucination)", () => {
  const evidence = ["The soul is the form of the body, according to the treatise."];
  it("accepts a quote that really appears in the evidence", () => {
    expect(quoteIsGrounded("the soul is the form of the body", evidence)).toBe(true);
  });
  it("rejects a fabricated quote", () => {
    expect(quoteIsGrounded("the soul is immortal and eternal forever", evidence)).toBe(false);
  });
  it("rejects a too-short quote", () => {
    expect(quoteIsGrounded("soul", evidence)).toBe(false);
  });
});

describe("gradeClaims", () => {
  const evidence = ["Aristotle argues the mean between extremes defines virtue."];
  it("keeps a factual claim only when grounded AND authority is sufficient", () => {
    const out = gradeClaims([{ text: "x", claimType: "factual", quote: "the mean between extremes defines virtue" }], evidence, true);
    expect(out[0].claimType).toBe("factual");
    expect(out[0].grounded).toBe(true);
  });
  it("demotes a factual claim to interpretive when authority is insufficient", () => {
    const out = gradeClaims([{ text: "x", claimType: "factual", quote: "the mean between extremes defines virtue" }], evidence, false);
    expect(out[0].claimType).toBe("interpretive");
  });
  it("demotes a factual claim with an ungrounded quote", () => {
    const out = gradeClaims([{ text: "x", claimType: "factual", quote: "virtue is its own reward always" }], evidence, true);
    expect(out[0].claimType).toBe("interpretive");
    expect(out[0].grounded).toBe(false);
  });
  it("leaves interpretive/inferred claims as-is", () => {
    const out = gradeClaims([{ text: "y", claimType: "inferred" }], evidence, true);
    expect(out[0].claimType).toBe("inferred");
  });
});

describe("synthesizeNote", () => {
  const evidence = ["Aristotle argues the mean between extremes defines virtue."];

  it("falls back to a grounded heuristic note with no model", async () => {
    const caller: StructuredCaller = { available: false, call: vi.fn() };
    const out = await synthesizeNote(caller, {
      primary: { title: "Ethics" },
      resource: sampleResource(),
      relation: "interpretive_aid",
      evidenceTexts: evidence,
      authorityOk: true,
      model: "m",
    });
    expect(out.usedModel).toBe(false);
    expect(out.body).toContain("On Virtue");
  });

  it("returns the model note and grades its claims against the evidence", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          body: "This source clarifies the doctrine of the mean.",
          claims: [
            { text: "It defines virtue as a mean.", claimType: "factual", quote: "the mean between extremes defines virtue" },
            { text: "It invents an unfounded fact.", claimType: "factual", quote: "virtue guarantees eternal happiness" },
          ],
        }),
        promptTokens: 5,
        completionTokens: 6,
        model: p.model,
      })),
    };
    const out = await synthesizeNote(caller, {
      primary: { title: "Ethics" },
      resource: sampleResource(),
      relation: "interpretive_aid",
      evidenceTexts: evidence,
      authorityOk: true,
      model: "m",
    });
    expect(out.usedModel).toBe(true);
    expect(out.body).toContain("doctrine of the mean");
    // Grounded factual claim stays factual; the fabricated one is demoted.
    expect(out.claims[0]).toMatchObject({ claimType: "factual", grounded: true });
    expect(out.claims[1]).toMatchObject({ claimType: "interpretive", grounded: false });
  });

  it("falls back when the model returns an empty body", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({ data: p.validate({ body: "", claims: [] }), promptTokens: 0, completionTokens: 0, model: p.model })),
    };
    const out = await synthesizeNote(caller, {
      primary: { title: "Ethics" },
      resource: sampleResource(),
      relation: "historical_context",
      evidenceTexts: evidence,
      authorityOk: false,
      model: "m",
    });
    expect(out.usedModel).toBe(false);
  });
});

describe("heuristicNote", () => {
  it("states the relation and source without inventing facts", () => {
    const r: RawResource = {
      provider: "crossref",
      resourceType: "article",
      title: "On Virtue",
      authors: ["Jane Doe"],
      year: 2010,
      url: null,
      doi: "10.1000/x",
      isbn: null,
      snippet: null,
      venue: null,
      popularity: null,
      raw: null,
    };
    const note = heuristicNote(r, "secondary_scholarly_recommendation");
    expect(note).toContain("On Virtue");
    expect(note).toContain("Jane Doe");
    expect(note).toContain("crossref");
  });
});

// ---- Lane-specific query generation (Phase 8 relevance closeout) ----

describe("lane-specific query generation", () => {
  const primary = { title: "Vice and Reason", author: "Terence Irwin" };

  it("emits explicit citations first, so the strongest claim wins attribution", () => {
    const lanes = heuristicLaneQueries(primary, ["Julia Annas, Plato and Aristotle on Friendship and Altruism, Mind 86 (1977)."], ["vice", "prohairesis"]);
    expect(lanes[0].lane).toBe("explicit_citation");
  });

  it("omits lanes it cannot write a useful query for rather than padding", () => {
    // No author and no citations: author-corpus and explicit-citation lanes
    // have nothing real to ask, so they must not appear.
    const lanes = heuristicLaneQueries({ title: "Vice and Reason" }, [], []);
    const names = lanes.map((l) => l.lane);
    expect(names).not.toContain("explicit_citation");
    expect(names).not.toContain("author_corpus");
    expect(names).toContain("scholarly_debate");
  });

  it("covers the public-source lanes so a low-yield manual search cannot disable them", () => {
    const names = heuristicLaneQueries(primary, [], ["vice"]).map((l) => l.lane);
    expect(names).toEqual(expect.arrayContaining(["lecture_course", "video_podcast", "blog_newsletter", "public_discussion"]));
  });

  it("falls back to deterministic lanes when no model is available", async () => {
    const caller = { available: false, call: async () => { throw new Error("unused"); } };
    const r = await generateLaneQueries(caller as never, { primary, citationTexts: [], model: "m" });
    expect(r.usedModel).toBe(false);
    expect(r.lanes.length).toBeGreaterThan(0);
  });

  it("drops invented lanes from model output instead of coercing them", async () => {
    const caller = {
      available: true,
      call: async (p: { validate: (parsed: unknown) => unknown }) =>
        ({
          data: p.validate({
            lanes: [
              { lane: "scholarly_debate", queries: ["aristotle vice reason"] },
              { lane: "totally_made_up_lane", queries: ["nonsense"] },
            ],
          }),
          promptTokens: 10,
          completionTokens: 5,
          model: "m",
        }),
    };
    const r = await generateLaneQueries(caller as never, { primary, citationTexts: [], model: "m" });
    expect(r.usedModel).toBe(true);
    expect(r.lanes.map((l) => l.lane)).not.toContain("totally_made_up_lane");
    expect(r.lanes.map((l) => l.lane)).toContain("scholarly_debate");
  });

  it("keeps deterministic lanes the model omitted", async () => {
    const caller = {
      available: true,
      call: async (p: { validate: (parsed: unknown) => unknown }) =>
        ({
          data: p.validate({ lanes: [{ lane: "scholarly_debate", queries: ["only this one"] }] }),
          promptTokens: 1,
          completionTokens: 1,
          model: "m",
        }),
    };
    const r = await generateLaneQueries(caller as never, {
      primary,
      citationTexts: ["Annas, Plato and Aristotle on Friendship and Altruism, Mind 86 (1977)."],
      model: "m",
    });
    // The explicit-citation lane comes from the document itself and must
    // survive whatever the model chose to emit.
    expect(r.lanes.map((l) => l.lane)).toContain("explicit_citation");
  });
});

describe("lane query merge — the document's own citations always survive", () => {
  it("keeps document-derived citation queries when the model emits the same lane", async () => {
    // Regression: the merge dropped the heuristic lane whenever the model
    // emitted a lane of the same name. In production that silently discarded
    // every real citation query and left explicit-citation recall at zero.
    const caller = {
      available: true,
      call: async (p: { validate: (parsed: unknown) => unknown }) => ({
        data: p.validate({
          lanes: [{ lane: "explicit_citation", queries: ["works cited by Vice and Reason"] }],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: "m",
      }),
    };
    const citation = 'Julia Annas, "Plato and Aristotle on Friendship and Altruism," Mind 86 (1977)';
    const r = await generateLaneQueries(caller as never, {
      primary: { title: "Vice and Reason", author: "Terence Irwin" },
      citationTexts: [citation],
      model: "m",
    });
    const lane = r.lanes.find((l) => l.lane === "explicit_citation");
    expect(lane).toBeDefined();
    expect(lane!.queries.some((q) => q.includes("Annas"))).toBe(true);
    // The model's query is kept too — it supplements rather than replaces.
    expect(lane!.queries.some((q) => q.includes("works cited by"))).toBe(true);
    // Document-derived queries come first.
    expect(lane!.queries[0]).toContain("Annas");
  });
});
