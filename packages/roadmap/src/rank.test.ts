import { describe, expect, it } from "vitest";
import {
  KNOWN_THRESHOLD,
  collapseDuplicateCandidates,
  countByReaderLevel,
  matchesReaderLevel,
  mergeRoadmapsAcrossRoots,
  normalizeTitleForDedup,
  rankRoadmap,
  suggestReaderLevelFromCompletions,
  tiersForReaderLevel,
  type OverrideEntry,
  type ProfileEntry,
  type RoadmapCandidate,
  type RootRoadmapInput,
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

describe("matchesReaderLevel (owner directive 2026-07-26: mutually exclusive bands)", () => {
  it("universal (null) material matches every selected level", () => {
    expect(matchesReaderLevel(null, "beginner")).toBe(true);
    expect(matchesReaderLevel(null, "undergraduate")).toBe(true);
    expect(matchesReaderLevel(null, "advanced")).toBe(true);
    expect(matchesReaderLevel(null, "research")).toBe(true);
    expect(matchesReaderLevel(null, "all")).toBe(true);
  });

  it("'all' matches every material level, tagged or not", () => {
    expect(matchesReaderLevel("beginner", "all")).toBe(true);
    expect(matchesReaderLevel("advanced", "all")).toBe(true);
  });

  it("a level-tagged item matches ONLY its own exact level — no cumulative <=/>= union", () => {
    expect(matchesReaderLevel("undergraduate", "undergraduate")).toBe(true);
    // Foundational (lower) levels no longer bleed upward into a higher
    // selection — this is the semantic the directive changed.
    expect(matchesReaderLevel("beginner", "undergraduate")).toBe(false);
    expect(matchesReaderLevel("advanced", "undergraduate")).toBe(false);
    expect(matchesReaderLevel("research", "undergraduate")).toBe(false);
  });

  it("cross-band exclusion is symmetric: advanced content is absent from a beginner selection and vice versa", () => {
    expect(matchesReaderLevel("advanced", "beginner")).toBe(false);
    expect(matchesReaderLevel("beginner", "advanced")).toBe(false);
  });
});

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

  it("beginner reader level hides the contextual/optional tail (essential is universal, always shown)", () => {
    const beginner = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "beginner" });
    expect(beginner.map((i) => i.bibId)).toEqual(["e"]);
  });

  it("research reader level is its OWN exact band (essential + optional), not everything (mutually exclusive bands)", () => {
    // Owner directive 2026-07-26: research no longer accumulates every
    // lower tier. It sees essential (universal) plus its own "optional"
    // tier only — "contextual" (undergraduate's own tier) is excluded, the
    // same way undergraduate excludes "optional".
    const research = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "research" });
    expect(research.map((i) => i.bibId).sort()).toEqual(["e", "o"]);
  });

  it("undergraduate reader level shows essential (universal) + its own tier, excluding advanced/research-only tiers", () => {
    const items = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "undergraduate" });
    expect(items.map((i) => i.bibId).sort()).toEqual(["c", "e"]); // contextual in (undergrad's own tier), optional still out
  });

  it("cross-band exclusion: undergraduate's contextual tier is absent from the advanced view, and advanced's comparative tier is absent from undergraduate's", () => {
    const comparative = cand({ bibId: "cmp", title: "Comparative Work", categories: ["parallel_comparison"] });
    const undergrad = rankRoadmap([essential, contextual, comparative], empty(), noOverrides(), { readerLevel: "undergraduate" });
    expect(undergrad.map((i) => i.bibId).sort()).toEqual(["c", "e"]); // comparative (advanced's tier) excluded
    const advanced = rankRoadmap([essential, contextual, comparative], empty(), noOverrides(), { readerLevel: "advanced" });
    expect(advanced.map((i) => i.bibId).sort()).toEqual(["cmp", "e"]); // contextual (undergraduate's tier) excluded
  });

  it("the explicit 'all' override shows everything, unlike any single level band", () => {
    const items = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "all" });
    expect(items.map((i) => i.bibId).sort()).toEqual(["c", "e", "o"]);
  });

  it("essential (universal/prerequisite) material appears in every level's band, same as null resource_role.reader_level", () => {
    expect([...tiersForReaderLevel("beginner")]).toContain("essential");
    expect([...tiersForReaderLevel("undergraduate")]).toContain("essential");
    expect([...tiersForReaderLevel("advanced")]).toEqual(["essential", "comparative"]);
    expect([...tiersForReaderLevel("research")]).toEqual(["essential", "optional"]);
    const items = rankRoadmap([essential, contextual, optional], empty(), noOverrides(), { readerLevel: "research" });
    expect(items.map((item) => item.bibId)).toEqual(["e", "o"]);
  });

  it("hidden override excludes an item entirely, checked before the level band even applies", () => {
    const ov = new Map<string, OverrideEntry>([["c", { hidden: true }]]);
    // "all" so the assertion isolates the hidden-override behavior from the
    // exact-band tier filter (contextual isn't in research's own exact band —
    // see the cross-band-exclusion tests above — which would otherwise leave
    // this test unable to tell which mechanism excluded "c").
    const items = rankRoadmap([essential, contextual], empty(), ov, { readerLevel: "all" });
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
    // "all": a manualPosition (unlike manualTier) does not itself bypass the
    // level-band filter, so this must not be scoped to a level whose exact
    // band would exclude "c" for an unrelated reason.
    const items = rankRoadmap([essential, contextual], empty(), ov, { readerLevel: "all" });
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
    // "all": contextual isn't in research's own exact band (see the
    // cross-band-exclusion tests above), so scoping this to "research"
    // would leave only one item and the sequence assertion would be
    // vacuous.
    const items = rankRoadmap([contextual, essential], empty(), noOverrides(), { readerLevel: "all" });
    expect(items.map((i) => i.sequence)).toEqual([1, 2]);
    expect(items[0].bibId).toBe("e"); // essential first
  });
});

describe("normalizeTitleForDedup", () => {
  it("collapses case and punctuation so the same work titled differently matches", () => {
    expect(normalizeTitleForDedup("Vice and Reason")).toBe(normalizeTitleForDedup("Vice and Reason."));
    expect(normalizeTitleForDedup("Critique of Pure Reason (1781)")).toBe(
      normalizeTitleForDedup("Critique of Pure Reason 1781"),
    );
  });

  it("does not treat two different empty/blank titles as the same key (fallback must not merge them)", () => {
    expect(normalizeTitleForDedup("")).toBe("");
  });
});

describe("collapseDuplicateCandidates (D-22-2: duplicate collapse)", () => {
  it("merges two catalog rows for the same work (an edition + a review of it) into one candidate", () => {
    const primaryEdition = cand({
      bibId: "book-2001-edition",
      title: "Vice and Reason",
      categories: ["prerequisite"],
      confidence: 0.7,
      centrality: 2,
      depth: 1,
      inLibrary: true,
    });
    const reviewRecord = cand({
      bibId: "review-of-book",
      title: "Vice and Reason.", // same work, trailing punctuation difference
      categories: ["secondary_scholarly_recommendation"],
      confidence: 0.9,
      centrality: 1,
      depth: 2,
      inLibrary: false,
    });

    const collapsed = collapseDuplicateCandidates([primaryEdition, reviewRecord]);
    expect(collapsed).toHaveLength(1);
    const merged = collapsed[0];
    // The in-library row wins as the surfaced identity (matches the
    // Reader/Library's own precedent of preferring an owned work).
    expect(merged.bibId).toBe("book-2001-edition");
    expect(merged.mergedBibIds).toEqual(["review-of-book"]);
    // Categories from both rows are preserved (union), confidence/centrality
    // reflect the combined evidence rather than only the primary's own.
    expect(merged.categories.sort()).toEqual(["prerequisite", "secondary_scholarly_recommendation"]);
    expect(merged.confidence).toBe(0.9);
    expect(merged.centrality).toBe(3);

    // Feeding the collapsed candidates through the real ranker proves the
    // roadmap itself now shows exactly one item, not two, for this work.
    const items = rankRoadmap(collapsed, empty(), noOverrides());
    expect(items).toHaveLength(1);
    expect(items[0].bibId).toBe("book-2001-edition");
    expect(items[0].mergedCount).toBe(1);
  });

  it("leaves distinct works alone (no false-positive merging)", () => {
    const kant = cand({ bibId: "kant", title: "Critique of Pure Reason" });
    const husserl = cand({ bibId: "husserl", title: "Logical Investigations" });
    const collapsed = collapseDuplicateCandidates([kant, husserl]);
    expect(collapsed.map((c) => c.bibId).sort()).toEqual(["husserl", "kant"]);
    expect(collapsed.every((c) => (c.mergedBibIds ?? []).length === 0)).toBe(true);
  });

  it("never merges two records that both have a blank/untitled title into one item", () => {
    const a = cand({ bibId: "a", title: "" });
    const b = cand({ bibId: "b", title: "" });
    const collapsed = collapseDuplicateCandidates([a, b]);
    expect(collapsed).toHaveLength(2);
  });
});

describe("rankRoadmap — manually added items surface distinctly (D-22-3: manual add)", () => {
  it("marks a manually added candidate and explains it was added by the reader, not detected", () => {
    const manual = cand({
      bibId: "manual-1",
      title: "A Reader-Chosen Reference",
      categories: [],
      addedManually: true,
    });
    const items = rankRoadmap([manual], empty(), noOverrides(), { readerLevel: "all" });
    expect(items).toHaveLength(1);
    expect(items[0].addedManually).toBe(true);
    expect(items[0].reason).toMatch(/added by you/i);
  });
});

describe("countByReaderLevel", () => {
  const essential = cand({ bibId: "e", title: "Essential Prereq", categories: ["prerequisite"] });
  const contextual = cand({ bibId: "c", title: "Context Work", categories: ["historical_context"] });
  const optional = cand({ bibId: "o", title: "Optional Extra", categories: ["optional_extension"] });

  it("matches what selecting each level's own exact band would actually show, plus 'all' (mutually exclusive bands)", () => {
    const counts = countByReaderLevel([essential, contextual, optional], empty(), noOverrides());
    expect(counts).toEqual({
      beginner: 1, // essential (universal) only — no candidate tagged beginner's own tier here
      undergraduate: 2, // essential + contextual (undergraduate's own tier)
      advanced: 1, // essential only — no comparative candidate in this fixture
      research: 2, // essential + optional (research's own tier)
      all: 3, // unfiltered
    });
  });
});

describe("mergeRoadmapsAcrossRoots (Phase 22.7: multi-root roadmap projection)", () => {
  const root = (rootWorkId: string, candidates: RoadmapCandidate[], overrides: Map<string, OverrideEntry> = noOverrides()): RootRoadmapInput => ({
    rootWorkId,
    candidates,
    overrides,
  });

  it("collapses a prerequisite shared by two roots into ONE item, unions categories, tracks both roots", () => {
    const kantA = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["prerequisite"], centrality: 2 });
    const kantB = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["conceptual_influence"], centrality: 2 });
    const merged = mergeRoadmapsAcrossRoots([root("work:A", [kantA]), root("work:B", [kantB])], empty());

    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].bibId).toBe("kant");
    // Unioned categories → strongest (prerequisite) drives the tier.
    expect(merged.items[0].tier).toBe("essential");
    expect(merged.items[0].category).toBe("prerequisite");
    // Both selected roots are recorded as having reached it.
    expect(merged.rootWorkIdsByBib.get("kant")).toEqual(["work:A", "work:B"]);
  });

  it("keeps genuinely distinct works from different roots, each scoped to its own root", () => {
    const kant = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["prerequisite"] });
    const hume = cand({ bibId: "hume", title: "A Treatise of Human Nature", categories: ["conceptual_influence"] });
    const merged = mergeRoadmapsAcrossRoots([root("work:A", [kant]), root("work:B", [hume])], empty());

    expect(merged.items.map((i) => i.bibId).sort()).toEqual(["hume", "kant"]);
    expect(merged.rootWorkIdsByBib.get("kant")).toEqual(["work:A"]);
    expect(merged.rootWorkIdsByBib.get("hume")).toEqual(["work:B"]);
  });

  it("chooses a deterministic primary when two roots reach the same work via different records (edition wins over review)", () => {
    const edition = cand({ bibId: "b-edition", title: "Vice and Reason", categories: ["prerequisite"], inLibrary: true, centrality: 2, depth: 1 });
    const review = cand({ bibId: "b-review", title: "Vice and Reason.", categories: ["secondary_scholarly_recommendation"], centrality: 1, depth: 2 });
    const merged = mergeRoadmapsAcrossRoots([root("work:A", [edition]), root("work:B", [review])], empty());

    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].bibId).toBe("b-edition"); // in-library row is the deterministic primary
    expect(merged.mergedBibIdsByBib.get("b-edition")).toEqual(["b-review"]);
    expect(merged.rootWorkIdsByBib.get("b-edition")).toEqual(["work:A", "work:B"]);
  });

  it("scoped-hide (§2.4): an item hidden under one root but reached un-hidden by another still appears", () => {
    const kantA = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["prerequisite"] });
    const kantB = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["prerequisite"] });
    const merged = mergeRoadmapsAcrossRoots(
      [root("work:A", [kantA], new Map([["kant", { hidden: true }]])), root("work:B", [kantB])],
      empty(),
    );
    expect(merged.items.map((i) => i.bibId)).toEqual(["kant"]);
    expect(merged.hiddenItems).toHaveLength(0);
  });

  it("scoped-hide (§2.4): an item hidden under EVERY reaching root goes to the composed restore list", () => {
    const kantA = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["prerequisite"] });
    const kantB = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["prerequisite"] });
    const merged = mergeRoadmapsAcrossRoots(
      [
        root("work:A", [kantA], new Map([["kant", { hidden: true }]])),
        root("work:B", [kantB], new Map([["kant", { hidden: true }]])),
      ],
      empty(),
    );
    expect(merged.items).toHaveLength(0);
    expect(merged.hiddenItems.map((h) => h.bibId)).toEqual(["kant"]);
    expect(merged.hiddenItems[0].title).toBe("Critique of Pure Reason");
  });

  it("applies a manual tier pin from a shown root during composition", () => {
    const optionalA = cand({ bibId: "o", title: "Optional Extra", categories: ["optional_extension"] });
    const merged = mergeRoadmapsAcrossRoots(
      [root("work:A", [optionalA], new Map([["o", { manualTier: "essential" }]]))],
      empty(),
      { mode: "concise" }, // optional would normally be filtered out of concise mode
    );
    expect(merged.items.map((i) => i.bibId)).toEqual(["o"]);
    expect(merged.items[0].tier).toBe("essential");
    expect(merged.items[0].overridden).toBe(true);
  });

  it("respects the shared profile when ranking the merged union", () => {
    const kant = cand({ bibId: "kant", title: "Critique of Pure Reason", categories: ["prerequisite"] });
    const husserl = cand({ bibId: "husserl", title: "Logical Investigations", categories: ["prerequisite"] });
    const profile = new Map<string, ProfileEntry>([["kant", { score: 80 }]]);
    const merged = mergeRoadmapsAcrossRoots([root("work:A", [kant, husserl])], profile);
    // Known Kant sinks below still-unknown Husserl.
    const order = merged.items.map((i) => i.bibId);
    expect(order.indexOf("husserl")).toBeLessThan(order.indexOf("kant"));
    expect(merged.items.find((i) => i.bibId === "kant")!.known).toBe(true);
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
