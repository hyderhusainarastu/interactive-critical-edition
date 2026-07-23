import { describe, expect, it } from "vitest";
import type { CandidateAssessment } from "./relevance";
import { isSpecificallyGroundedCitation, selectForFullInspection, type RankableCandidate } from "./selection";

const AUTHORITY_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

function assessment(over: Partial<CandidateAssessment["signals"]> = {}): CandidateAssessment {
  return {
    verdict: "accepted",
    confidence: 1,
    reasons: ["explicit_citation_match"],
    normalizedKey: null,
    venueReliable: true,
    signals: {
      lane: "explicit_citation",
      topicOverlap: 0,
      coreConceptMatches: [],
      matchedTerms: [],
      groundingSignals: ["explicit_citation"],
      isExplicitCitation: true,
      explicitCitationSource: null,
      authorCollision: false,
      givenNameCollision: false,
      venueLooksOffDiscipline: false,
      ...over,
    },
  };
}

function candidate(id: string, authority: string, explicitCitationSource: CandidateAssessment["signals"]["explicitCitationSource"]): RankableCandidate & { id: string } {
  return { id, authority, assessment: assessment({ explicitCitationSource }) };
}

describe("isSpecificallyGroundedCitation", () => {
  it("is true for a resolved-citation key match", () => {
    expect(isSpecificallyGroundedCitation(assessment({ explicitCitationSource: "key" }))).toBe(true);
  });
  it("is true for a matched reference-list entry", () => {
    expect(isSpecificallyGroundedCitation(assessment({ explicitCitationSource: "citation_text" }))).toBe(true);
  });
  it("is false for the broader title-phrase-in-prose match", () => {
    expect(isSpecificallyGroundedCitation(assessment({ explicitCitationSource: "title_phrase" }))).toBe(false);
  });
  it("is false for a non-citation candidate", () => {
    expect(isSpecificallyGroundedCitation(assessment({ explicitCitationSource: null, isExplicitCitation: false }))).toBe(false);
  });
});

describe("selectForFullInspection — the Nicomachean-Ethics-edition-flood fixture (floors §2.2)", () => {
  // The audit's exact scenario: dozens of interchangeable, high-authority
  // editions of the primary text (grounded only via the broad title-phrase
  // rule) alongside a handful of real, specifically-grounded secondary
  // sources with LOWER authority. A naive authority-only sort drops the real
  // targets; this selection must not.
  const neEditions = Array.from({ length: 130 }, (_, i) => candidate(`ne-edition-${i}`, "A", "title_phrase"));
  const realTargets = [
    candidate("dahl-1984", "C", "citation_text"),
    candidate("brickhouse-2003", "C", "citation_text"),
    candidate("broadie-1991", "B", "key"),
  ];
  const accepted = [...neEditions, ...realTargets];

  it("never drops a specifically-grounded target, even when the flood alone exceeds the inspection budget", () => {
    const ranked = selectForFullInspection(accepted, AUTHORITY_ORDER, 120);
    const rankedIds = new Set(ranked.map((r) => r.id));
    for (const target of realTargets) expect(rankedIds.has(target.id)).toBe(true);
  });

  it("would have been dropped by a naive authority-only sort — proving the fixture actually exercises the fix", () => {
    // The regression this guards: sorting ALL accepted candidates by
    // authority alone and slicing to the budget. Every specifically-grounded
    // target here is authority B/C, ranked behind 130 authority-A editions,
    // so a authority-only sort drops every one of them at a 120-item budget.
    const naive = [...accepted]
      .sort((a, b) => AUTHORITY_ORDER[a.authority] - AUTHORITY_ORDER[b.authority])
      .slice(0, 120);
    const naiveIds = new Set(naive.map((r) => r.id));
    for (const target of realTargets) expect(naiveIds.has(target.id)).toBe(false);
  });

  it("fills the remaining budget with the generic group, sorted by authority, after seating every specific target", () => {
    const ranked = selectForFullInspection(accepted, AUTHORITY_ORDER, 120);
    expect(ranked).toHaveLength(120);
    const genericPortion = ranked.filter((r) => !realTargets.some((t) => t.id === r.id));
    expect(genericPortion).toHaveLength(120 - realTargets.length);
    // All surviving generic items are still authority A (nothing weaker
    // could have made it in ahead of them within the same generic group).
    expect(genericPortion.every((r) => r.authority === "A")).toBe(true);
  });

  it("never truncates the specific group even when it alone exceeds maxFullInspections", () => {
    const hugeSpecificGroup = Array.from({ length: 200 }, (_, i) => candidate(`specific-${i}`, "E", "citation_text"));
    const ranked = selectForFullInspection([...hugeSpecificGroup, ...neEditions], AUTHORITY_ORDER, 120);
    expect(ranked.length).toBeGreaterThanOrEqual(200);
    for (const item of hugeSpecificGroup) expect(ranked.some((r) => r.id === item.id)).toBe(true);
  });

  it("leaves ordinary (non-flooded) selection behavior unchanged: authority sort when nothing is specifically grounded", () => {
    const plain = [candidate("a", "C", null), candidate("b", "A", null), candidate("c", "B", null)];
    const ranked = selectForFullInspection(plain, AUTHORITY_ORDER, 120);
    expect(ranked.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});
