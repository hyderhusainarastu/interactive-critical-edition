import { describe, expect, it } from "vitest";
import { canAfford, charge, makeBudget, overSoftCap, perProviderLimit, runDiscovery } from "./discover";
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
