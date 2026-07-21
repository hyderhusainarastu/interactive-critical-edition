import { describe, expect, it } from "vitest";
import {
  KNOWN_THRESHOLD,
  countByReaderLevel,
  rankRoadmap,
  suggestReaderLevelFromCompletions,
  type OverrideEntry,
  type ProfileEntry,
  type RoadmapCandidate,
} from "./index";

function cand(partial: Partial<RoadmapCandidate> & { bibId: string; title: string }): RoadmapCandidate {
  return {
    authors: null,
    year: null,
    categories: ["ai_inferred"],
    confidence: 0.6,
    centrality: 1,
    depth: 1,
    isBook: true,
    inLibrary: false,
    ...partial,
  };
}

const empty = () => new Map<string, ProfileEntry>();
const noOverrides = () => new Map<string, OverrideEntry>();

describe("rankRoadmap — Heidegger acceptance case (plan §13 step 9)", () => {
  const kant = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["conceptual_influence"] });
  const husserl = cand({ bibId: "husserl", title: "Logical Investigations", categories: ["conceptual_influence"] });
  const camus = cand({ bibId: "camus", title: "The Myth of Sisyphus", categories: ["parallel_comparison"] });

  it("ranks Kant and Husserl (influences) above Camus (a mere parallel)", () => {
    const items = rankRoadmap([camus, kant, husserl], empty(), noOverrides());
    const order = items.map((i) => i.bibId);
    expect(order.indexOf("kant")).toBeLessThan(order.indexOf("camus"));
    expect(order.indexOf("husserl")).toBeLessThan(order.indexOf("camus"));
    expect(items.find((i) => i.bibId === "kant")!.tier).toBe("high");
    expect(items.find((i) => i.bibId === "camus")!.tier).toBe("comparative");
  });

  it("breaks ties by graph centrality (Kant referenced by more works ranks above Husserl)", () => {
    const items = rankRoadmap(
      [husserl, { ...kant, centrality: 3 }],
      empty(),
      noOverrides(),
    );
    expect(items[0].bibId).toBe("kant");
  });

  it("surfaces a transitive prerequisite reached at depth 2, above comparatives", () => {
    const hume = cand({ bibId: "hume", title: "A Treatise of Human Nature", categories: ["prerequisite"], depth: 2 });
    const items = rankRoadmap([camus, kant, hume], empty(), noOverrides());
    // Hume is essential (prerequisite) even though it's two hops away.
    expect(items[0].bibId).toBe("hume");
    expect(items[0].tier).toBe("essential");
  });

  it("marking a work known measurably changes the roadmap (demotes it to review-only, below unknown peers)", () => {
    const profile = new Map<string, ProfileEntry>([["kant", { score: 80 }]]);
    const items = rankRoadmap([kant, husserl], profile, noOverrides());
    const order = items.map((i) => i.bibId);
    // Kant was above Husserl by centrality tie/localeCompare before; now
    // "known", it sinks below the still-unknown Husserl.
    expect(order.indexOf("husserl")).toBeLessThan(order.indexOf("kant"));
    expect(items.find((i) => i.bibId === "kant")!.known).toBe(true);
    expect(items.find((i) => i.bibId === "kant")!.reason).toMatch(/review only/i);
  });

  it("a completed reading is treated as known too", () => {
    const profile = new Map<string, ProfileEntry>([["kant", { status: "completed" }]]);
    const items = rankRoadmap([kant, husserl], profile, noOverrides());
    expect(items.find((i) => i.bibId === "kant")!.known).toBe(true);
  });

  it("KNOWN_THRESHOLD boundary: 59 is not known, 60 is", () => {
    expect(rankRoadmap([kant], new Map([["kant", { score: KNOWN_THRESHOLD - 1 }]]), noOverrides())[0].known).toBe(false);
    expect(rankRoadmap([kant], new Map([["kant", { score: KNOWN_THRESHOLD }]]), noOverrides())[0].known).toBe(true);
  });
});

describe("rankRoadmap — Vico/Verene acceptance case", () => {
  it("a secondary interpretive aid ranks above generic historical context", () => {
    const verene = cand({
      bibId: "verene",
      title: "Vico's Science of Imagination",
      categories: ["secondary_scholarly_recommendation"],
    });
    const context = cand({ bibId: "ctx", title: "The Enlightenment", categories: ["historical_context"] });
    const items = rankRoadmap([context, verene], empty(), noOverrides());
    const order = items.map((i) => i.bibId);
    expect(order.indexOf("verene")).toBeLessThan(order.indexOf("ctx"));
  });
});

describe("rankRoadmap — modes, filters, overrides", () => {
  const essential = cand({ bibId: "e", title: "Essential Prereq", categories: ["prerequisite"] });
  const contextual = cand({ bibId: "c", title: "Context Work", categories: ["historical_context"] });
  const optional = cand({ bibId: "o", title: "Optional Extra", categories: ["optional_extension"] });

  it("concise mode keeps only essential + high", () => {
    const items = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { mode: "concise" });
    expect(items.map((i) => i.bibId)).toEqual(["e"]);
  });

  it("beginner reader level hides the contextual/optional tail; research shows all", () => {
    const beginner = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "beginner" });
    expect(beginner.map((i) => i.bibId)).toEqual(["e"]);
    const research = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "research" });
    expect(research.map((i) => i.bibId).sort()).toEqual(["c", "e", "o"]);
  });

  it("undergraduate reader level matches the old three-level intermediate exactly (no regression on backfill)", () => {
    const items = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "undergraduate" });
    expect(items.map((i) => i.bibId).sort()).toEqual(["c", "e"]); // contextual in, optional still out
  });

  it("the explicit 'all' override shows everything, same as research", () => {
    const items = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "all" });
    expect(items.map((i) => i.bibId).sort()).toEqual(["c", "e", "o"]);
  });

  it("hidden override excludes an item entirely", () => {
    const ov = new Map<string, OverrideEntry>([["c", { hidden: true }]]);
    const items = rankRoadmap([essential, contextual], empty(), ov, { readerLevel: "research" });
    expect(items.map((i) => i.bibId)).toEqual(["e"]);
  });

  it("manual tier override reclassifies and re-ranks an item, and shows through filters", () => {
    const ov = new Map<string, OverrideEntry>([["o", { manualTier: "essential" }]]);
    // optional would normally be filtered out of concise mode; the pin shows it.
    const items = rankRoadmap([contextual, optional], empty(), ov, { mode: "concise" });
    expect(items.map((i) => i.bibId)).toEqual(["o"]);
    expect(items[0].tier).toBe("essential");
    expect(items[0].overridden).toBe(true);
  });

  it("manual position pins an item to an exact slot", () => {
    const ov = new Map<string, OverrideEntry>([["c", { manualPosition: 1 }]]);
    const items = rankRoadmap([essential, contextual], empty(), ov, { readerLevel: "research" });
    expect(items[0].bibId).toBe("c"); // pinned first despite lower tier
  });

  it("time budget marks lower-priority items over budget without dropping them", () => {
    const a = cand({ bibId: "a", title: "A", categories: ["prerequisite"], isBook: true }); // 600 min
    const b = cand({ bibId: "b", title: "B", categories: ["conceptual_influence"], isBook: true }); // 600 min
    const items = rankRoadmap([a, b], empty(), noOverrides(), { maxMinutes: 600 });
    expect(items).toHaveLength(2);
    expect(items[0].overBudget).toBe(false);
    expect(items[1].overBudget).toBe(true);
  });

  it("assigns a stable 1-based sequence", () => {
    const items = rankRoadmap([contextual, essential], empty(), noOverrides(), { readerLevel: "research" });
    expect(items.map((i) => i.sequence)).toEqual([1, 2]);
    expect(items[0].bibId).toBe("e"); // essential first
  });
});

describe("countByReaderLevel", () => {
  const essential = cand({ bibId: "e", title: "Essential Prereq", categories: ["prerequisite"] });
  const contextual = cand({ bibId: "c", title: "Context Work", categories: ["historical_context"] });
  const optional = cand({ bibId: "o", title: "Optional Extra", categories: ["optional_extension"] });

  it("matches what selecting each level would actually show, plus 'all'", () => {
    const counts = countByReaderLevel([essential, contextual, optional], empty(), noOverrides());
    expect(counts).toEqual({
      beginner: 1, // essential only
      undergraduate: 2, // + contextual
      advanced: 2, // no comparative candidate in this fixture
      research: 3, // everything
      all: 3,
    });
  });
});

describe("suggestReaderLevelFromCompletions", () => {
  it("suggests nothing below the minimum-completions threshold", () => {
    expect(suggestReaderLevelFromCompletions(["advanced"], "beginner")).toBeNull();
  });

  it("suggests a higher level once enough completions accumulate at it", () => {
    expect(suggestReaderLevelFromCompletions(["advanced", "advanced"], "beginner")).toBe("advanced");
  });

  it("never suggests the reader's current level or anything at/below it", () => {
    expect(suggestReaderLevelFromCompletions(["undergraduate", "undergraduate"], "undergraduate")).toBeNull();
    expect(suggestReaderLevelFromCompletions(["beginner", "beginner", "beginner"], "advanced")).toBeNull();
  });

  it("prefers the strongest (highest) signal when multiple levels qualify", () => {
    const completed = ["advanced", "advanced", "research", "research"] as const;
    expect(suggestReaderLevelFromCompletions([...completed], "beginner")).toBe("research");
  });

  it("treats a null current level (never chosen) the same as beginner-and-below", () => {
    expect(suggestReaderLevelFromCompletions(["undergraduate", "undergraduate"], null)).toBe("undergraduate");
  });

  it("ignores items with no recorded reader level", () => {
    expect(suggestReaderLevelFromCompletions([null, null, null, null], "beginner")).toBeNull();
  });
});
