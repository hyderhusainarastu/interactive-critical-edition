import { describe, expect, it } from "vitest";
import { claimRoot, debateRoot, passageRoot, questionRoot } from "./resolveContextRoot";

describe("resolveContextRoot", () => {
  it("builds a passage root node with its work-reader destination and work-title breadcrumb", () => {
    const { node, label, breadcrumb } = passageRoot({ id: "p1", workId: "w1", workTitle: "On the Soul", summary: "The soul as form" });
    expect(String(node.id)).toBe("passage:p1");
    expect(node.displayKind).toBe("passage");
    expect(node.sourceEntity).toEqual({ kind: "passage_annotation", id: "p1" });
    expect(node.destination).toBe("/works/w1/reader");
    expect(label).toBe("The soul as form");
    expect(breadcrumb).toBe("On the Soul");
  });

  it("builds a question root node, never fabricating a string from a null summary", () => {
    const { node, breadcrumb } = questionRoot({ id: "q1", title: "Does form require matter?", summary: null });
    expect(String(node.id)).toBe("question:q1");
    expect(node.displayKind).toBe("question");
    expect(node.destination).toBe("/research/q1");
    // null summary never fabricated into a string
    expect(breadcrumb).toBe("");
  });

  it("builds a claim root node, falling back to the corpus-item title for the breadcrumb", () => {
    const { node, breadcrumb } = claimRoot({ id: "c1", claimText: "Form and matter are inseparable.", workTitle: null, corpusItemTitle: "Imported abstract" });
    expect(String(node.id)).toBe("claim:c1");
    expect(node.displayKind).toBe("claim");
    expect(node.destination).toBe("/research/claims/c1");
    // falls back to corpus-item title
    expect(breadcrumb).toBe("Imported abstract");
  });

  it("builds a debate root node with its project-scoped destination and research-question breadcrumb", () => {
    const { node, breadcrumb } = debateRoot({ id: "d1", projectId: "proj1", name: "Hylomorphism vs. dualism", researchQuestion: "Is the soul separable?" });
    expect(String(node.id)).toBe("debate:d1");
    expect(node.displayKind).toBe("debate");
    expect(node.destination).toBe("/research/proj1/debates/d1");
    expect(breadcrumb).toBe("Is the soul separable?");
  });
});
