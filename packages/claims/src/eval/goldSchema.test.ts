import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isGoldJudgeExample, parseGoldJudgeFile } from "./goldSchema";

function example(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ex-1",
    domain: "empirical",
    claimAText: "Claim A.",
    claimAWorkTitle: "Work A",
    claimBText: "Claim B.",
    claimBWorkTitle: "Work B",
    goldRelationship: "contradiction",
    goldCategory: "findings",
    ...overrides,
  };
}

describe("isGoldJudgeExample", () => {
  it("accepts a well-formed example", () => {
    expect(isGoldJudgeExample(example())).toBe(true);
  });

  it("accepts an example with optional mechanism/nature fields present", () => {
    expect(
      isGoldJudgeExample(
        example({ goldMechanism: "different_definition", claimANature: "interpretive", claimBNature: "textual" }),
      ),
    ).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isGoldJudgeExample(null)).toBe(false);
    expect(isGoldJudgeExample("string")).toBe(false);
    expect(isGoldJudgeExample(42)).toBe(false);
  });

  it("rejects an invalid domain", () => {
    expect(isGoldJudgeExample(example({ domain: "physics" }))).toBe(false);
  });

  it("rejects an invalid goldRelationship", () => {
    expect(isGoldJudgeExample(example({ goldRelationship: "agreement" }))).toBe(false);
  });

  it("rejects an invalid goldCategory", () => {
    expect(isGoldJudgeExample(example({ goldCategory: "vibes" }))).toBe(false);
  });

  it("rejects an invalid claimANature", () => {
    expect(isGoldJudgeExample(example({ claimANature: "philosophical" }))).toBe(false);
  });

  it("rejects a missing required string field", () => {
    const { claimAText: _drop, ...withoutClaimAText } = example();
    expect(isGoldJudgeExample(withoutClaimAText)).toBe(false);
  });
});

describe("parseGoldJudgeFile", () => {
  it("parses a valid JSON array of examples", () => {
    const raw = JSON.stringify([example({ id: "a" }), example({ id: "b" })]);
    expect(parseGoldJudgeFile(raw)).toHaveLength(2);
  });

  it("throws when the top level is not an array", () => {
    expect(() => parseGoldJudgeFile(JSON.stringify({ not: "an array" }))).toThrow(/must be a JSON array/);
  });

  it("throws when any entry fails to conform, naming its index", () => {
    const raw = JSON.stringify([example({ id: "a" }), example({ id: "b", domain: "bogus" })]);
    expect(() => parseGoldJudgeFile(raw)).toThrow(/index 1/);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseGoldJudgeFile("{not valid json")).toThrow();
  });
});

// ── CI-safe check on real gold fixture files, if any exist ─────────────
// Another lane/session adds real gold data under src/eval/gold/*.json; this
// package must never fail CI just because that data doesn't exist yet.
const here = dirname(fileURLToPath(import.meta.url));
const goldDir = join(here, "gold");

describe("gold fixtures under src/eval/gold/", () => {
  if (!existsSync(goldDir)) {
    it.skip("no gold/ directory present yet — another lane adds it", () => {
      // intentionally empty
    });
  } else {
    const files = readdirSync(goldDir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
      it.skip("gold/ directory exists but is empty — another lane adds files", () => {
        // intentionally empty
      });
    } else {
      for (const file of files) {
        it(`${file} parses and conforms to GoldJudgeExample[]`, () => {
          const raw = readFileSync(join(goldDir, file), "utf8");
          expect(() => parseGoldJudgeFile(raw)).not.toThrow();
        });
      }
    }
  }
});
