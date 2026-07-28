import assert from "node:assert/strict";
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
} from "./contextChooser";

/** `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/contextChooser.test.ts` */

// --- per-kind mappers ---
{
  const c = workToCandidate({ workId: "w1", title: "On the Soul", authorName: "Aristotle" });
  assert.deepEqual(c, { kind: "work", id: "w1", title: "On the Soul", subtitle: "Aristotle", updatedAt: null });
}
{
  const c = workToCandidate({ workId: "w2", title: "Untitled", authorName: null });
  assert.equal(c.subtitle, "", "null author never fabricated into a string");
}
{
  const c = passageToCandidate({
    id: "p1",
    workId: "w1",
    workTitle: "On the Soul",
    quote: "the soul is in a way all existing things",
    summary: "The soul's relation to form",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(c.kind, "passage");
  assert.equal(c.title, "The soul's relation to form");
  assert.equal(c.subtitle, "On the Soul");
  assert.equal(c.updatedAt, "2026-01-01T00:00:00.000Z");
}
{
  const c = passageToCandidate({
    id: "p2",
    workId: "w1",
    workTitle: "On the Soul",
    quote: null,
    summary: "Whole-work note",
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(c.updatedAt, "2026-02-01T00:00:00.000Z", "Date instances are converted to ISO strings");
}
{
  const c = questionToCandidate({ id: "q1", title: "Does hylomorphism survive Cartesian dualism?", summary: null, updatedAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(c.kind, "question");
  assert.equal(c.subtitle, "");
}
{
  const c = claimToCandidate({ id: "cl1", claimText: "Form and matter are inseparable in a living body.", workTitle: "On the Soul", corpusItemTitle: null, updatedAt: "2026-01-03T00:00:00.000Z" });
  assert.equal(c.kind, "claim");
  assert.equal(c.subtitle, "On the Soul");
}
{
  const c = claimToCandidate({ id: "cl2", claimText: "x", workTitle: null, corpusItemTitle: "Imported abstract", updatedAt: "2026-01-03T00:00:00.000Z" });
  assert.equal(c.subtitle, "Imported abstract", "falls back to corpus-item title when no work title exists");
}
{
  const c = debateToCandidate({ id: "d1", name: "Hylomorphism vs. dualism", researchQuestion: "Is the soul separable from the body?", projectTitle: "Aristotle project", updatedAt: "2026-01-04T00:00:00.000Z" });
  assert.equal(c.kind, "debate");
  assert.equal(c.subtitle, "Is the soul separable from the body?");
}
{
  const c = debateToCandidate({ id: "d2", name: "x", researchQuestion: null, projectTitle: "Aristotle project", updatedAt: "2026-01-04T00:00:00.000Z" });
  assert.equal(c.subtitle, "Aristotle project", "falls back to project title when no research question exists");
}
console.log("per-kind mappers: OK");

// --- toGraphUrlContext ---
assert.deepEqual(toGraphUrlContext({ kind: "work", id: "w1" }), { kind: "work", id: "w1" });
console.log("toGraphUrlContext: OK");

// --- sortCandidatesByRecency ---
{
  const a: ContextCandidate = { kind: "work", id: "a", title: "A", subtitle: "", updatedAt: "2026-01-01T00:00:00.000Z" };
  const b: ContextCandidate = { kind: "work", id: "b", title: "B", subtitle: "", updatedAt: "2026-01-03T00:00:00.000Z" };
  const c: ContextCandidate = { kind: "work", id: "c", title: "C", subtitle: "", updatedAt: null };
  const sorted = sortCandidatesByRecency([a, c, b]);
  assert.deepEqual(sorted.map((x) => x.id), ["b", "a", "c"], "newest-first, nulls last");
  // Pure: does not mutate the input array.
  assert.deepEqual([a, c, b].map((x) => x.id), ["a", "c", "b"]);
}
console.log("sortCandidatesByRecency: OK");

// --- filterCandidatesBySearch ---
{
  const candidates: ContextCandidate[] = [
    { kind: "work", id: "1", title: "On the Soul", subtitle: "Aristotle", updatedAt: null },
    { kind: "work", id: "2", title: "Physics", subtitle: "Aristotle", updatedAt: null },
    { kind: "work", id: "3", title: "Meditations", subtitle: "Descartes", updatedAt: null },
  ];
  assert.deepEqual(filterCandidatesBySearch(candidates, "").map((c) => c.id), ["1", "2", "3"], "empty query matches everything");
  assert.deepEqual(filterCandidatesBySearch(candidates, "  ").map((c) => c.id), ["1", "2", "3"], "whitespace-only query matches everything");
  assert.deepEqual(filterCandidatesBySearch(candidates, "aristotle").map((c) => c.id), ["1", "2"], "case-insensitive subtitle match");
  assert.deepEqual(filterCandidatesBySearch(candidates, "SOUL").map((c) => c.id), ["1"], "case-insensitive title match");
  assert.deepEqual(filterCandidatesBySearch(candidates, "zzz"), []);
}
console.log("filterCandidatesBySearch: OK");

// --- groupCandidatesByKind ---
{
  const candidates: ContextCandidate[] = [
    { kind: "work", id: "1", title: "A", subtitle: "", updatedAt: null },
    { kind: "claim", id: "2", title: "B", subtitle: "", updatedAt: null },
    { kind: "work", id: "3", title: "C", subtitle: "", updatedAt: null },
  ];
  const groups = groupCandidatesByKind(candidates);
  assert.equal(groups.work.length, 2);
  assert.equal(groups.claim.length, 1);
  assert.equal(groups.passage.length, 0);
  assert.equal(groups.question.length, 0);
  assert.equal(groups.debate.length, 0);
}
console.log("groupCandidatesByKind: OK");

console.log("contextChooser.test.ts: all assertions passed");
