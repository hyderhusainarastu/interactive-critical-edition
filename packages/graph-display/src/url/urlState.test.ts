import { describe, expect, it } from "vitest";
import { toDisplayNodeId } from "./ids";
import { mulberry32, randomGraphUrlState } from "./testFixtures";
import { GraphUrlStateParseError, extractGraphUrlFilters, parseGraphUrlState, serializeGraphUrlState } from "./urlStateCodec";
import { EXPANSION_CAP } from "./disclosure";
import type { GraphUrlState } from "./urlState";

const MINIMAL_STATE: GraphUrlState = {
  context: { kind: "work", id: "w1" },
  view: "3d",
  selectedId: null,
  activeLayers: [],
  filters: {},
  expansionTrail: [],
  focus: "all",
};

describe("serializeGraphUrlState / parseGraphUrlState — round trip", () => {
  it("round-trips a minimal state", () => {
    const params = serializeGraphUrlState(MINIMAL_STATE);
    expect(parseGraphUrlState(params)).toEqual(MINIMAL_STATE);
  });

  it("round-trips a fully-populated state", () => {
    const state: GraphUrlState = {
      context: { kind: "claim", id: "claim-42" },
      view: "2d",
      selectedId: toDisplayNodeId("node-7"),
      activeLayers: ["evidence", "debate", "research"],
      filters: { search: "aristotle", readerLevel: "advanced", stage: "" },
      expansionTrail: [toDisplayNodeId("a"), toDisplayNodeId("b"), toDisplayNodeId("c")],
      focus: "expand2",
    };
    const params = serializeGraphUrlState(state);
    expect(parseGraphUrlState(params)).toEqual(state);
  });

  it("preserves an empty-string filter value as distinct from an absent filter", () => {
    const state: GraphUrlState = { ...MINIMAL_STATE, filters: { search: "" } };
    const params = serializeGraphUrlState(state);
    expect(params.has("search")).toBe(true);
    const parsed = parseGraphUrlState(params);
    expect(parsed.filters.search).toBe("");
    expect("state" in parsed.filters).toBe(false);
  });

  it("preserves expansion trail order", () => {
    const state: GraphUrlState = {
      ...MINIMAL_STATE,
      expansionTrail: [toDisplayNodeId("z"), toDisplayNodeId("a"), toDisplayNodeId("m")],
    };
    const parsed = parseGraphUrlState(serializeGraphUrlState(state));
    expect(parsed.expansionTrail.map(String)).toEqual(["z", "a", "m"]);
  });

  it("preserves active-layer order", () => {
    const state: GraphUrlState = { ...MINIMAL_STATE, activeLayers: ["research", "evidence", "claim"] };
    const parsed = parseGraphUrlState(serializeGraphUrlState(state));
    expect(parsed.activeLayers).toEqual(["research", "evidence", "claim"]);
  });

  it("truncates an expansion trail longer than EXPANSION_CAP on serialize, keeping the earliest entries", () => {
    const longTrail = Array.from({ length: EXPANSION_CAP + 5 }, (_, i) => toDisplayNodeId(`id-${i}`));
    const state: GraphUrlState = { ...MINIMAL_STATE, expansionTrail: longTrail };
    const parsed = parseGraphUrlState(serializeGraphUrlState(state));
    expect(parsed.expansionTrail).toHaveLength(EXPANSION_CAP);
    expect(parsed.expansionTrail.map(String)).toEqual(longTrail.slice(0, EXPANSION_CAP).map(String));
  });

  it("is tolerant of unrelated/unknown params on parse", () => {
    const params = serializeGraphUrlState(MINIMAL_STATE);
    params.set("utm_source", "newsletter");
    params.append("someRandomThing", "x");
    params.append("someRandomThing", "y");
    expect(parseGraphUrlState(params)).toEqual(MINIMAL_STATE);
  });

  it("defaults view and focus when absent rather than throwing", () => {
    const params = new URLSearchParams({ ctxKind: "work", ctxId: "w1" });
    const parsed = parseGraphUrlState(params);
    expect(parsed.view).toBe("3d");
    expect(parsed.focus).toBe("all");
  });

  it("defaults view and focus when the stored value is invalid rather than throwing", () => {
    const params = new URLSearchParams({ ctxKind: "work", ctxId: "w1", view: "4d", focus: "orbit" });
    const parsed = parseGraphUrlState(params);
    expect(parsed.view).toBe("3d");
    expect(parsed.focus).toBe("all");
  });

  it("drops an unrecognized layer value silently rather than throwing", () => {
    const params = new URLSearchParams({ ctxKind: "work", ctxId: "w1" });
    params.append("layer", "evidence");
    params.append("layer", "not-a-real-layer");
    const parsed = parseGraphUrlState(params);
    expect(parsed.activeLayers).toEqual(["evidence"]);
  });

  it("throws GraphUrlStateParseError when context is entirely missing", () => {
    expect(() => parseGraphUrlState(new URLSearchParams())).toThrow(GraphUrlStateParseError);
  });

  it("throws GraphUrlStateParseError when context id is an empty string", () => {
    const params = new URLSearchParams({ ctxKind: "work", ctxId: "" });
    expect(() => parseGraphUrlState(params)).toThrow(GraphUrlStateParseError);
  });

  it("throws GraphUrlStateParseError for an unrecognized context kind", () => {
    const params = new URLSearchParams({ ctxKind: "spaceship", ctxId: "w1" });
    expect(() => parseGraphUrlState(params)).toThrow(GraphUrlStateParseError);
  });
});

describe("extractGraphUrlFilters", () => {
  it("reads only the known filter keys and ignores everything else", () => {
    const params = new URLSearchParams({ search: "vico", unrelated: "ignored" });
    expect(extractGraphUrlFilters(params)).toEqual({ search: "vico" });
  });

  it("returns an empty object when no filter keys are present", () => {
    expect(extractGraphUrlFilters(new URLSearchParams())).toEqual({});
  });
});

describe("GraphUrlState round trip — property-based-style suite (many seeded generated states)", () => {
  const SEED_COUNT = 200;

  for (let seed = 0; seed < SEED_COUNT; seed++) {
    it(`round-trips generated state #${seed}`, () => {
      const rand = mulberry32(seed);
      const state = randomGraphUrlState(rand);
      const roundTripped = parseGraphUrlState(serializeGraphUrlState(state));
      expect(roundTripped).toEqual(state);
    });
  }

  it("is tolerant of extra unknown params mixed into an otherwise-valid generated state", () => {
    const rand = mulberry32(12345);
    const state = randomGraphUrlState(rand);
    const params = serializeGraphUrlState(state);
    // Mix in noise that looks like it could plausibly collide: repeated
    // unknown keys, an unknown key that shares a prefix with a real one.
    params.append("layerX", "not-a-layer-param");
    params.append("junk", "1");
    params.append("junk", "2");
    expect(parseGraphUrlState(params)).toEqual(state);
  });
});
