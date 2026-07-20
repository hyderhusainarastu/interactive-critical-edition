import { describe, expect, it, vi } from "vitest";
import { synthesizeConcepts } from "./concepts";
import type { StructuredCaller } from "./synthesize";

const TEXT_SAMPLE =
  "Aristotle discusses akrasia, weakness of will, in the Nicomachean Ethics, contrasting it with " +
  "sophrosyne, temperance, as understood in the Peripatetic tradition.";

describe("synthesizeConcepts", () => {
  it("returns nothing (not a guess) with no model available", async () => {
    const caller: StructuredCaller = { available: false, call: vi.fn() };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.usedModel).toBe(false);
    expect(out.concepts).toEqual([]);
  });

  it("returns nothing when there is no text to extract from", async () => {
    const caller: StructuredCaller = { available: true, call: vi.fn() };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: "   ", model: "m" });
    expect(caller.call).not.toHaveBeenCalled();
    expect(out.concepts).toEqual([]);
  });

  it("accepts a well-formed concept and derives a deterministic slug", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          concepts: [
            {
              label: "Akrasia",
              kind: "concept",
              summary: "Weakness of will — acting against one's own better judgment.",
              role: "central",
              confidence: 0.9,
              evidence: "Discussed at length in Book VII.",
            },
          ],
        }),
        promptTokens: 100,
        completionTokens: 50,
        model: "m",
      })),
    };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.usedModel).toBe(true);
    expect(out.concepts).toEqual([
      {
        slug: "akrasia",
        kind: "concept",
        label: "Akrasia",
        summary: "Weakness of will — acting against one's own better judgment.",
        role: "central",
        confidence: 0.9,
        evidence: "Discussed at length in Book VII.",
      },
    ]);
  });

  it("drops a candidate missing a label, summary, or evidence", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          concepts: [
            { label: "", kind: "concept", summary: "x", role: "central", confidence: 0.5, evidence: "y" },
            { label: "x", kind: "concept", summary: "", role: "central", confidence: 0.5, evidence: "y" },
            { label: "x", kind: "concept", summary: "y", role: "central", confidence: 0.5, evidence: "" },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: "m",
      })),
    };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.concepts).toEqual([]);
  });

  it("demotes an unrecognized kind to 'concept' and an unrecognized role to 'mentioned'", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          concepts: [
            { label: "Stoicism", kind: "not-a-real-kind", summary: "s", role: "not-a-real-role", confidence: 0.5, evidence: "e" },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: "m",
      })),
    };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.concepts).toHaveLength(1);
    expect(out.concepts[0].kind).toBe("concept");
    expect(out.concepts[0].role).toBe("mentioned");
  });

  it("clamps confidence to [0, 1]", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          concepts: [
            { label: "A", kind: "concept", summary: "s", role: "central", confidence: 5, evidence: "e" },
            { label: "B", kind: "concept", summary: "s", role: "central", confidence: -5, evidence: "e" },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: "m",
      })),
    };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.concepts.map((c) => c.confidence)).toEqual([1, 0]);
  });

  it("dedups repeated concepts within one response by slug, keeping the first occurrence", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          concepts: [
            { label: "Akrasia", kind: "concept", summary: "first", role: "central", confidence: 0.9, evidence: "e1" },
            { label: "akrasia", kind: "concept", summary: "second", role: "mentioned", confidence: 0.4, evidence: "e2" },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: "m",
      })),
    };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.concepts).toHaveLength(1);
    expect(out.concepts[0].summary).toBe("first");
  });

  it("caps the number of concepts at maxConcepts", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          concepts: Array.from({ length: 20 }, (_, i) => ({
            label: `Concept ${i}`,
            kind: "concept",
            summary: "s",
            role: "mentioned",
            confidence: 0.5,
            evidence: "e",
          })),
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: "m",
      })),
    };
    const out = await synthesizeConcepts(caller, {
      primary: { title: "Ethics" },
      textSample: TEXT_SAMPLE,
      model: "m",
      maxConcepts: 3,
    });
    expect(out.concepts).toHaveLength(3);
  });

  it("falls back to an empty result on a thrown/malformed model response", async () => {
    const caller: StructuredCaller = { available: true, call: vi.fn(async () => { throw new Error("bad model output"); }) };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.usedModel).toBe(false);
    expect(out.concepts).toEqual([]);
  });

  it("slugifies non-ASCII labels to plain lowercase hyphenated identifiers", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          concepts: [
            { label: "Phronêsis (φρόνησις)", kind: "concept", summary: "s", role: "central", confidence: 0.8, evidence: "e" },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: "m",
      })),
    };
    const out = await synthesizeConcepts(caller, { primary: { title: "Ethics" }, textSample: TEXT_SAMPLE, model: "m" });
    expect(out.concepts[0].slug).toMatch(/^[a-z0-9-]+$/);
    expect(out.concepts[0].slug.length).toBeGreaterThan(0);
  });
});
