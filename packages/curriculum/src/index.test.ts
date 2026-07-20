import { describe, expect, it } from "vitest";
import {
  KNOWN_THRESHOLD,
  STAGE_ORDER,
  assertAcyclicStages,
  buildCurriculum,
  checkpointFor,
  countByRoute,
  defaultRouteForReaderLevel,
  hasCycle,
  stageForRelationship,
  stagesForRoute,
  type CurriculumCandidate,
  type ProfileEntry,
} from "./index";

function cand(partial: Partial<CurriculumCandidate> & { learningResourceId: string; title: string }): CurriculumCandidate {
  return {
    authors: [],
    year: null,
    resourceType: "article",
    relationship: "ai_inferred",
    readerLevel: null,
    rationale: null,
    confidence: 0.6,
    ...partial,
  };
}

const empty = () => new Map<string, ProfileEntry>();

describe("stageForRelationship", () => {
  it("maps every relationship category to exactly one of the five stages", () => {
    const categories: CurriculumCandidate["relationship"][] = [
      "prerequisite",
      "conceptual_influence",
      "disagreement_polemical_target",
      "explicit_reference",
      "secondary_scholarly_recommendation",
      "historical_context",
      "interpretive_aid",
      "ai_inferred",
      "parallel_comparison",
      "optional_extension",
    ];
    for (const c of categories) {
      expect(STAGE_ORDER).toContain(stageForRelationship(c));
    }
  });

  it("puts prerequisite in the prerequisites stage, and optional_extension in extension", () => {
    expect(stageForRelationship("prerequisite")).toBe("prerequisites");
    expect(stageForRelationship("optional_extension")).toBe("extension");
  });
});

describe("stagesForRoute", () => {
  it("each route's stage set is a superset of the one before it", () => {
    const minimal = stagesForRoute("minimal");
    const university = stagesForRoute("university");
    const graduate = stagesForRoute("graduate");
    for (const s of minimal) expect(university.has(s)).toBe(true);
    for (const s of university) expect(graduate.has(s)).toBe(true);
    expect(graduate.size).toBe(5);
  });
});

describe("defaultRouteForReaderLevel", () => {
  it("beginner -> minimal, research -> graduate, everything else -> university", () => {
    expect(defaultRouteForReaderLevel("beginner")).toBe("minimal");
    expect(defaultRouteForReaderLevel("research")).toBe("graduate");
    expect(defaultRouteForReaderLevel("undergraduate")).toBe("university");
    expect(defaultRouteForReaderLevel("advanced")).toBe("university");
    expect(defaultRouteForReaderLevel(null)).toBe("university");
  });
});

describe("checkpointFor", () => {
  it("is deterministic and non-empty for every category", () => {
    const a = checkpointFor("prerequisite");
    const b = checkpointFor("prerequisite");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("buildCurriculum", () => {
  const prereq = cand({ learningResourceId: "r1", title: "Prior Analytics", relationship: "prerequisite" });
  const influence = cand({ learningResourceId: "r2", title: "The Republic", relationship: "conceptual_influence" });
  const core = cand({ learningResourceId: "r3", title: "A Commentary", relationship: "explicit_reference" });
  const context = cand({ learningResourceId: "r4", title: "Historical Notes", relationship: "historical_context" });
  const extension = cand({ learningResourceId: "r5", title: "A Comparable Work", relationship: "parallel_comparison" });
  const all = [prereq, influence, core, context, extension];

  it("minimal route only shows prerequisites + core_engagement stages", () => {
    const result = buildCurriculum(all, empty(), "minimal");
    const stageNames = result.stages.map((s) => s.stage);
    expect(stageNames).toEqual(["prerequisites", "core_engagement"]);
    expect(result.stages.flatMap((s) => s.items).map((i) => i.learningResourceId).sort()).toEqual(["r1", "r3"]);
  });

  it("graduate route shows all five stages with all items", () => {
    const result = buildCurriculum(all, empty(), "graduate");
    expect(result.stages.map((s) => s.stage)).toEqual(STAGE_ORDER);
    expect(result.stages.flatMap((s) => s.items)).toHaveLength(5);
  });

  it("caps items per stage and flags truncation", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      cand({ learningResourceId: `p${i}`, title: `Prereq ${i}`, relationship: "prerequisite" }),
    );
    const result = buildCurriculum(many, empty(), "minimal");
    const prereqStage = result.stages.find((s) => s.stage === "prerequisites")!;
    expect(prereqStage.items).toHaveLength(3); // minimal cap
    expect(prereqStage.truncated).toBe(true);
  });

  it("known items (score >= threshold) are review-only, not removed", () => {
    const profile = new Map<string, ProfileEntry>([["r1", { score: KNOWN_THRESHOLD }]]);
    const result = buildCurriculum(all, profile, "graduate");
    const prereqStage = result.stages.find((s) => s.stage === "prerequisites")!;
    expect(prereqStage.items).toHaveLength(1);
    expect(prereqStage.items[0].known).toBe(true);
  });

  it("completed reading status also marks an item known", () => {
    const profile = new Map<string, ProfileEntry>([["r3", { status: "completed" }]]);
    const result = buildCurriculum(all, profile, "graduate");
    const coreStage = result.stages.find((s) => s.stage === "core_engagement")!;
    expect(coreStage.items[0].known).toBe(true);
  });

  it("known items sort after unknown items within a stage", () => {
    const two = [
      cand({ learningResourceId: "k1", title: "A", relationship: "prerequisite" }),
      cand({ learningResourceId: "k2", title: "B", relationship: "prerequisite" }),
    ];
    const profile = new Map<string, ProfileEntry>([["k1", { score: 90 }]]);
    const result = buildCurriculum(two, profile, "graduate");
    const items = result.stages.find((s) => s.stage === "prerequisites")!.items;
    expect(items.map((i) => i.learningResourceId)).toEqual(["k2", "k1"]);
  });

  it("difficulty falls back to a stage default when the role carries no reader level", () => {
    const result = buildCurriculum([prereq], empty(), "graduate");
    expect(result.stages[0].items[0].difficulty).toBeTruthy();
  });

  it("difficulty uses the resource role's own reader level when set", () => {
    const withLevel = cand({ learningResourceId: "r9", title: "X", relationship: "prerequisite", readerLevel: "research" });
    const result = buildCurriculum([withLevel], empty(), "graduate");
    expect(result.stages[0].items[0].difficulty).toBe("research");
  });
});

describe("countByRoute", () => {
  it("matches buildCurriculum's own item counts for every route (no drift)", () => {
    const candidates = [
      cand({ learningResourceId: "r1", title: "A", relationship: "prerequisite" }),
      cand({ learningResourceId: "r2", title: "B", relationship: "optional_extension" }),
    ];
    const profile = empty();
    const counts = countByRoute(candidates, profile);
    for (const route of ["minimal", "university", "graduate"] as const) {
      const built = buildCurriculum(candidates, profile, route);
      const total = built.stages.reduce((n, s) => n + s.items.length, 0);
      expect(counts[route]).toBe(total);
    }
  });
});

describe("hasCycle / assertAcyclicStages", () => {
  it("detects no cycle in a simple chain", () => {
    expect(hasCycle([{ id: "a", dependsOn: [] }, { id: "b", dependsOn: ["a"] }])).toBe(false);
  });

  it("detects a synthetic cycle", () => {
    expect(
      hasCycle([
        { id: "a", dependsOn: ["b"] },
        { id: "b", dependsOn: ["a"] },
      ]),
    ).toBe(true);
  });

  it("real curriculum output is always acyclic (stage order is a total order)", () => {
    const all2 = [
      cand({ learningResourceId: "r1", title: "A", relationship: "prerequisite" }),
      cand({ learningResourceId: "r2", title: "B", relationship: "conceptual_influence" }),
      cand({ learningResourceId: "r3", title: "C", relationship: "explicit_reference" }),
      cand({ learningResourceId: "r4", title: "D", relationship: "historical_context" }),
      cand({ learningResourceId: "r5", title: "E", relationship: "optional_extension" }),
    ];
    const result = buildCurriculum(all2, empty(), "graduate");
    const items = result.stages.flatMap((s) => s.items);
    expect(() => assertAcyclicStages(items)).not.toThrow();
  });
});
