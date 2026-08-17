import { describe, expect, it } from "vitest";
import {
  claimToCandidate,
  debateToCandidate,
  filterCandidatesBySearch,
  groupCandidatesByKind,
  passageToCandidate,
  questionToCandidate,
  sortCandidatesByRecency,
  toGraphUrlContext,
  workToCandidate,
  type ContextCandidate,
} from "./contextCandidates";

describe("contextCandidates", () => {
  // --- per-kind mappers ---
  it("workToCandidate maps a work to a candidate", () => {
    const c = workToCandidate({ workId: "w1", title: "On the Soul", authorName: "Aristotle" });
    expect(c).toEqual({ kind: "work", id: "w1", title: "On the Soul", subtitle: "Aristotle", updatedAt: null });
  });

  it("null author never fabricated into a string", () => {
    const c = workToCandidate({ workId: "w2", title: "Untitled", authorName: null });
    expect(c.subtitle).toBe("");
  });

  it("passageToCandidate maps a passage to a candidate", () => {
    const c = passageToCandidate({
      id: "p1",
      workId: "w1",
      workTitle: "On the Soul",
      quote: "the soul is in a way all existing things",
      summary: "The soul's relation to form",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(c.kind).toBe("passage");
    expect(c.title).toBe("The soul's relation to form");
    expect(c.subtitle).toBe("On the Soul");
    expect(c.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("Date instances are converted to ISO strings", () => {
    const c = passageToCandidate({
      id: "p2",
      workId: "w1",
      workTitle: "On the Soul",
      quote: null,
      summary: "Whole-work note",
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(c.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("questionToCandidate maps a question to a candidate", () => {
    const c = questionToCandidate({ id: "q1", title: "Does hylomorphism survive Cartesian dualism?", summary: null, updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(c.kind).toBe("question");
    expect(c.subtitle).toBe("");
  });

  it("claimToCandidate maps a claim to a candidate", () => {
    const c = claimToCandidate({ id: "cl1", claimText: "Form and matter are inseparable in a living body.", workTitle: "On the Soul", corpusItemTitle: null, updatedAt: "2026-01-03T00:00:00.000Z" });
    expect(c.kind).toBe("claim");
    expect(c.subtitle).toBe("On the Soul");
  });

  it("claim falls back to corpus-item title when no work title exists", () => {
    const c = claimToCandidate({ id: "cl2", claimText: "x", workTitle: null, corpusItemTitle: "Imported abstract", updatedAt: "2026-01-03T00:00:00.000Z" });
    expect(c.subtitle).toBe("Imported abstract");
  });

  it("debateToCandidate maps a debate to a candidate", () => {
    const c = debateToCandidate({ id: "d1", name: "Hylomorphism vs. dualism", researchQuestion: "Is the soul separable from the body?", projectTitle: "Aristotle project", updatedAt: "2026-01-04T00:00:00.000Z" });
    expect(c.kind).toBe("debate");
    expect(c.subtitle).toBe("Is the soul separable from the body?");
  });

  it("debate falls back to project title when no research question exists", () => {
    const c = debateToCandidate({ id: "d2", name: "x", researchQuestion: null, projectTitle: "Aristotle project", updatedAt: "2026-01-04T00:00:00.000Z" });
    expect(c.subtitle).toBe("Aristotle project");
  });

  // --- toGraphUrlContext ---
  it("toGraphUrlContext", () => {
    expect(toGraphUrlContext({ kind: "work", id: "w1" })).toEqual({ kind: "work", id: "w1" });
  });

  // --- sortCandidatesByRecency ---
  it("sortCandidatesByRecency sorts newest-first with nulls last and does not mutate its input", () => {
    const a: ContextCandidate = { kind: "work", id: "a", title: "A", subtitle: "", updatedAt: "2026-01-01T00:00:00.000Z" };
    const b: ContextCandidate = { kind: "work", id: "b", title: "B", subtitle: "", updatedAt: "2026-01-03T00:00:00.000Z" };
    const c: ContextCandidate = { kind: "work", id: "c", title: "C", subtitle: "", updatedAt: null };
    const sorted = sortCandidatesByRecency([a, c, b]);
    // newest-first, nulls last
    expect(sorted.map((x) => x.id)).toEqual(["b", "a", "c"]);
    // Pure: does not mutate the input array.
    expect([a, c, b].map((x) => x.id)).toEqual(["a", "c", "b"]);
  });

  // --- filterCandidatesBySearch ---
  it("filterCandidatesBySearch", () => {
    const candidates: ContextCandidate[] = [
      { kind: "work", id: "1", title: "On the Soul", subtitle: "Aristotle", updatedAt: null },
      { kind: "work", id: "2", title: "Physics", subtitle: "Aristotle", updatedAt: null },
      { kind: "work", id: "3", title: "Meditations", subtitle: "Descartes", updatedAt: null },
    ];
    // empty query matches everything
    expect(filterCandidatesBySearch(candidates, "").map((c) => c.id)).toEqual(["1", "2", "3"]);
    // whitespace-only query matches everything
    expect(filterCandidatesBySearch(candidates, "  ").map((c) => c.id)).toEqual(["1", "2", "3"]);
    // case-insensitive subtitle match
    expect(filterCandidatesBySearch(candidates, "aristotle").map((c) => c.id)).toEqual(["1", "2"]);
    // case-insensitive title match
    expect(filterCandidatesBySearch(candidates, "SOUL").map((c) => c.id)).toEqual(["1"]);
    expect(filterCandidatesBySearch(candidates, "zzz")).toEqual([]);
  });

  // --- groupCandidatesByKind ---
  it("groupCandidatesByKind", () => {
    const candidates: ContextCandidate[] = [
      { kind: "work", id: "1", title: "A", subtitle: "", updatedAt: null },
      { kind: "claim", id: "2", title: "B", subtitle: "", updatedAt: null },
      { kind: "work", id: "3", title: "C", subtitle: "", updatedAt: null },
    ];
    const groups = groupCandidatesByKind(candidates);
    expect(groups.work.length).toBe(2);
    expect(groups.claim.length).toBe(1);
    expect(groups.passage.length).toBe(0);
    expect(groups.question.length).toBe(0);
    expect(groups.debate.length).toBe(0);
  });
});
