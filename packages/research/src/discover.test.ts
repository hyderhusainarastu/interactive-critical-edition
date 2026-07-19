import { describe, expect, it } from "vitest";
import { canAfford, charge, makeBudget, overSoftCap, perProviderLimit, providersForLane, runDiscovery } from "./discover";
import type { AdapterResult, AdapterSearchOptions, ProviderName, RawResource, SourceAdapter } from "./types";

function res(i: number, provider: ProviderName = "crossref"): RawResource {
  return {
    provider,
    resourceType: "article",
    title: `Work ${i}`,
    authors: [`Author ${i}`],
    year: 2000 + i,
    url: null,
    doi: `10.1000/w${i}`,
    isbn: null,
    snippet: null,
    venue: null,
    popularity: null,
    raw: null,
  };
}

class MockAdapter implements SourceAdapter {
  private round = 0;
  constructor(
    readonly provider: ProviderName,
    private readonly byRound: RawResource[][],
    private readonly enabled = true,
  ) {}
  isEnabled() {
    return this.enabled;
  }
  async search(queries: string[], _opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.enabled) {
      return {
        attempt: { provider: this.provider, status: "disabled", queries: [], resultCount: 0, inspectionDepth: 0, latencyMs: 0 },
        resources: [],
      };
    }
    const resources = this.byRound[this.round] ?? [];
    this.round++;
    return {
      attempt: { provider: this.provider, status: "queried", queries, resultCount: resources.length, inspectionDepth: 1, latencyMs: 5 },
      resources,
    };
  }
}

describe("cost budget", () => {
  it("never allows a call projected past the hard cap", () => {
    const b = makeBudget(2, 5);
    expect(canAfford(b, 4.9)).toBe(true);
    expect(canAfford(b, 5.1)).toBe(false);
    charge(b, 4);
    expect(canAfford(b, 1)).toBe(true);
    expect(canAfford(b, 1.5)).toBe(false);
  });
  it("flags the soft cap so no new batches start", () => {
    const b = makeBudget(2, 5);
    expect(overSoftCap(b)).toBe(false);
    charge(b, 2);
    expect(overSoftCap(b)).toBe(true);
  });
});

describe("per-provider limits", () => {
  it("uses the plan's caps per provider class", () => {
    expect(perProviderLimit("youtube")).toBe(8);
    expect(perProviderLimit("tavily")).toBe(12);
    expect(perProviderLimit("mastodon")).toBe(6);
    expect(perProviderLimit("crossref")).toBe(25);
  });
});

describe("runDiscovery", () => {
  const ten = Array.from({ length: 10 }, (_, i) => res(i));

  it("stops on saturation after consecutive low-growth rounds", async () => {
    // Round 1 adds 10; rounds 2+ repeat the same 10 (0 new) -> saturate at round 3.
    const adapter = new MockAdapter("crossref", [ten, ten, ten, ten, ten]);
    const out = await runDiscovery({ adapters: [adapter], rounds: [["q1"], ["q2"], ["q3"], ["q4"], ["q5"]] });
    expect(out.resources).toHaveLength(10);
    expect(out.rounds).toBe(3);
    expect(out.saturationNote).toMatch(/Saturated/);
  });

  it("dedupes the same work returned across rounds and providers", async () => {
    const a = new MockAdapter("crossref", [ten]);
    const b = new MockAdapter("openalex", [ten]); // same 10 works, different provider
    const out = await runDiscovery({ adapters: [a, b], rounds: [["q1"]] });
    expect(out.resources).toHaveLength(10);
  });

  it("records exactly one aggregated attempt per provider with summed counts", async () => {
    const a = new MockAdapter("crossref", [[res(1)], [res(2)]]);
    const out = await runDiscovery({ adapters: [a], rounds: [["q1"], ["q2"]] });
    const attempt = out.attempts.find((x) => x.provider === "crossref");
    expect(out.attempts).toHaveLength(1);
    expect(attempt?.resultCount).toBe(2);
    expect(attempt?.queries).toEqual(["q1", "q2"]);
  });

  it("records a disabled adapter's attempt without calling it", async () => {
    const enabled = new MockAdapter("crossref", [[res(1)]]);
    const disabled = new MockAdapter("tavily", [[res(2)]], false);
    const out = await runDiscovery({ adapters: [enabled, disabled], rounds: [["q1"]] });
    expect(out.attempts.find((x) => x.provider === "tavily")?.status).toBe("disabled");
    // The disabled provider contributed no resources.
    expect(out.resources).toHaveLength(1);
  });

  it("drops irrelevant resources via the predicate", async () => {
    const a = new MockAdapter("crossref", [[res(1), res(2), res(3)]]);
    const out = await runDiscovery({ adapters: [a], rounds: [["q1"]], isRelevant: (r) => r.title !== "Work 2" });
    expect(out.resources.map((r) => r.title)).not.toContain("Work 2");
    expect(out.resources).toHaveLength(2);
  });
});

// ---- Lane-scoped discovery (Phase 8 relevance closeout) ----

describe("lane-scoped discovery", () => {
  it("routes each lane only to providers that can serve it", () => {
    expect([...providersForLane("video_podcast")]).toEqual(expect.arrayContaining(["youtube"]));
    expect([...providersForLane("video_podcast")]).not.toContain("crossref");
    expect([...providersForLane("public_discussion")]).toEqual(expect.arrayContaining(["mastodon", "bluesky"]));
    expect([...providersForLane("scholarly_debate")]).toEqual(expect.arrayContaining(["crossref", "openalex"]));
    expect([...providersForLane("scholarly_debate")]).not.toContain("youtube");
    // Primary texts are catalogued as books far more often than as articles.
    expect([...providersForLane("primary_prerequisite")]).toEqual(expect.arrayContaining(["openlibrary", "googlebooks"]));
  });

  it("only queries the adapters a lane routes to", async () => {
    const calls: string[] = [];
    const spy = (provider: ProviderName): SourceAdapter => ({
      provider,
      isEnabled: () => true,
      async search(queries) {
        calls.push(provider);
        return {
          attempt: { provider, status: "queried", queries, resultCount: 0, inspectionDepth: 0, latencyMs: 1 },
          resources: [],
        };
      },
    });
    const adapters = [spy("crossref"), spy("youtube"), spy("bluesky")];
    await runDiscovery({ adapters, rounds: [{ lane: "scholarly_debate", queries: ["aristotle vice"] }] });
    expect(calls).toEqual(["crossref"]);
  });

  it("tags each resource with the lane that first surfaced it", async () => {
    const make = (provider: ProviderName, title: string, doi: string): SourceAdapter => ({
      provider,
      isEnabled: () => true,
      async search(queries) {
        return {
          attempt: { provider, status: "queried", queries, resultCount: 1, inspectionDepth: 0, latencyMs: 1 },
          resources: [
            {
              provider, resourceType: "article", title, authors: [], year: null, url: null,
              doi, isbn: null, snippet: null, venue: null, popularity: null, raw: null,
            },
          ],
        };
      },
    });
    const r = await runDiscovery({
      adapters: [make("crossref", "Aristotle on Vice", "10.1080/09608788.2015.1022855")],
      rounds: [
        { lane: "explicit_citation", queries: ["irwin vice and reason"] },
        { lane: "scholarly_debate", queries: ["aristotle vice"] },
      ],
    });
    // Found in the explicit-citation lane first; the later lane must not
    // overwrite the more specific attribution.
    expect(r.laneByKey.get("doi:10.1080/09608788.2015.1022855")).toBe("explicit_citation");
  });

  it("records an honest attempt for adapters no lane consulted", async () => {
    const never: SourceAdapter = {
      provider: "youtube",
      isEnabled: () => true,
      async search() {
        throw new Error("must not be called");
      },
    };
    const used: SourceAdapter = {
      provider: "crossref",
      isEnabled: () => true,
      async search(queries) {
        return {
          attempt: { provider: "crossref", status: "queried", queries, resultCount: 0, inspectionDepth: 0, latencyMs: 1 },
          resources: [],
        };
      },
    };
    const r = await runDiscovery({ adapters: [used, never], rounds: [{ lane: "scholarly_debate", queries: ["x y z"] }] });
    const yt = r.attempts.find((a) => a.provider === "youtube");
    // Silence must never be mistaken for "nothing was found".
    expect(yt).toBeDefined();
    expect(yt?.status).toBe("unavailable");
  });

  it("still accepts plain (lane-less) rounds", async () => {
    const a: SourceAdapter = {
      provider: "crossref",
      isEnabled: () => true,
      async search(queries) {
        return {
          attempt: { provider: "crossref", status: "queried", queries, resultCount: 0, inspectionDepth: 0, latencyMs: 1 },
          resources: [],
        };
      },
    };
    const r = await runDiscovery({ adapters: [a], rounds: [["one two three"]] });
    expect(r.rounds).toBe(1);
    expect(r.laneByKey.size).toBe(0);
  });
});
