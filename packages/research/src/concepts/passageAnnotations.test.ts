import { describe, expect, it, vi } from "vitest";
import { MAX_SUMMARY_LENGTH, synthesizePassageAnnotations, type PassageBlockInput } from "./passageAnnotations";
import type { StructuredCaller } from "./synthesize";

const RELATIONSHIPS = [
  "explicit_reference",
  "secondary_scholarly_recommendation",
  "historical_context",
  "prerequisite",
  "conceptual_influence",
  "disagreement_polemical_target",
  "interpretive_aid",
  "parallel_comparison",
  "optional_extension",
  "ai_inferred",
];

const blocks: PassageBlockInput[] = [
  { blockId: "b1", text: "Akrasia is weakness of will, acting against one's own better judgment." },
  { blockId: "b2", text: "Aristotle discusses the mean between excess and deficiency." },
];

describe("synthesizePassageAnnotations", () => {
  it("returns nothing (not a guess) with no model available", async () => {
    const caller: StructuredCaller = { available: false, call: vi.fn() };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.usedModel).toBe(false);
    expect(out.annotations).toEqual([]);
  });

  it("returns nothing when there are no blocks to annotate", async () => {
    const caller: StructuredCaller = { available: true, call: vi.fn() };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks: [],
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(caller.call).not.toHaveBeenCalled();
    expect(out.annotations).toEqual([]);
  });

  it("accepts a well-grounded anchored annotation", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "b1",
              quote: "weakness of will",
              summary: "Defines akrasia.",
              explanation: "Akrasia names acting against one's own better judgment.",
              annotation_type: "definition",
              relationship: "interpretive_aid",
              reader_level: "beginner",
              confidence: 0.8,
            },
          ],
        }),
        promptTokens: 10,
        completionTokens: 20,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.usedModel).toBe(true);
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0]).toMatchObject({
      isWholeWork: false,
      blockId: "b1",
      quote: "weakness of will",
      annotationType: "definition",
      readerLevel: "beginner",
    });
  });

  it("drops a candidate whose quote does not actually appear in the claimed block — never a fabricated anchor", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "b1",
              quote: "a sentence that was never in the text",
              summary: "Fabricated.",
              explanation: "This did not come from the block.",
              annotation_type: "context",
              relationship: "interpretive_aid",
              reader_level: "",
              confidence: 0.9,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations).toEqual([]);
  });

  it("drops a candidate that references a block_id it was never shown", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "not-a-real-block",
              quote: "weakness of will",
              summary: "x",
              explanation: "x",
              annotation_type: "context",
              relationship: "interpretive_aid",
              reader_level: "",
              confidence: 0.5,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations).toEqual([]);
  });

  it("accepts one genuine whole-work annotation (empty block_id and quote)", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "",
              quote: "",
              summary: "Whole-work guidance.",
              explanation: "The work as a whole argues against akrasia being impossible.",
              annotation_type: "context",
              relationship: "interpretive_aid",
              reader_level: "",
              confidence: 0.6,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0]).toMatchObject({ isWholeWork: true, blockId: null, quote: null, readerLevel: null });
  });

  it("drops a whole-work candidate that also carries a quote — an inconsistent, effectively fabricated anchor", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "",
              quote: "weakness of will",
              summary: "x",
              explanation: "x",
              annotation_type: "context",
              relationship: "interpretive_aid",
              reader_level: "",
              confidence: 0.5,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations).toEqual([]);
  });

  it("caps whole-work annotations at one even if the model returns several", async () => {
    const wholeWork = (summary: string) => ({
      block_id: "",
      quote: "",
      summary,
      explanation: "x",
      annotation_type: "context",
      relationship: "interpretive_aid",
      reader_level: "",
      confidence: 0.5,
    });
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({ annotations: [wholeWork("first"), wholeWork("second")] }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].summary).toBe("first");
  });

  it("caps anchored annotations at maxAnnotations even if the model returns more", async () => {
    const anchored = (blockId: string, quote: string) => ({
      block_id: blockId,
      quote,
      summary: "x",
      explanation: "x",
      annotation_type: "context",
      relationship: "interpretive_aid",
      reader_level: "",
      confidence: 0.5,
    });
    const manyBlocks: PassageBlockInput[] = Array.from({ length: 5 }, (_, i) => ({ blockId: `b${i}`, text: `Text about topic number ${i}.` }));
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: manyBlocks.map((b) => anchored(b.blockId, `topic number ${manyBlocks.indexOf(b)}`)),
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks: manyBlocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
      maxAnnotations: 2,
    });
    expect(out.annotations).toHaveLength(2);
  });

  it("demotes an unrecognized relationship to ai_inferred instead of fabricating one", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "b1",
              quote: "weakness of will",
              summary: "x",
              explanation: "x",
              annotation_type: "context",
              relationship: "made_up_category",
              reader_level: "",
              confidence: 0.5,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations[0].relationship).toBe("ai_inferred");
  });

  it("demotes an unrecognized annotation_type to the safe generic 'context' rather than dropping the note", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "b1",
              quote: "weakness of will",
              summary: "x",
              explanation: "x",
              annotation_type: "not_a_real_type",
              relationship: "interpretive_aid",
              reader_level: "",
              confidence: 0.5,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations[0].annotationType).toBe("context");
  });

  it("truncates an over-length summary to the DB-enforced 240-char limit instead of rejecting the note", async () => {
    const longSummary = "x".repeat(300);
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "b1",
              quote: "weakness of will",
              summary: longSummary,
              explanation: "x",
              annotation_type: "context",
              relationship: "interpretive_aid",
              reader_level: "",
              confidence: 0.5,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations[0].summary.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
  });

  it("clamps out-of-range confidence into [0, 1]", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async (p) => ({
        data: p.validate({
          annotations: [
            {
              block_id: "b1",
              quote: "weakness of will",
              summary: "x",
              explanation: "x",
              annotation_type: "context",
              relationship: "interpretive_aid",
              reader_level: "",
              confidence: 5,
            },
          ],
        }),
        promptTokens: 1,
        completionTokens: 1,
        model: p.model,
      })),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.annotations[0].confidence).toBe(1);
  });

  it("falls back to an empty result on a thrown/malformed model response", async () => {
    const caller: StructuredCaller = {
      available: true,
      call: vi.fn(async () => {
        throw new Error("bad model output");
      }),
    };
    const out = await synthesizePassageAnnotations(caller, {
      primary: { title: "Ethics" },
      blocks,
      validRelationships: RELATIONSHIPS,
      model: "m",
    });
    expect(out.usedModel).toBe(false);
    expect(out.annotations).toEqual([]);
  });
});
