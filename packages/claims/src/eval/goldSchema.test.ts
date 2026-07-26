import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isGoldJudgeExample,
  parseGoldJudgeFile,
  parseGoldClaimNatureFile,
  parseGoldRelationshipPairsFile,
  parseGoldSearchQueriesFile,
} from "./goldSchema";

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
//
// The real transcribed (Lane L2) / drafted (Lane L5) gold files mirror
// ScholarLens's own `gold_claims.json` record shape (nested `claim_a`/
// `claim_b`, `label`/`category`), not this file's own `GoldJudgeExample`
// guess above — see the comment in `goldSchema.ts` for why. Dispatch by
// filename to the schema each file actually conforms to; an unrecognized
// filename fails loudly rather than being silently skipped, so a future
// new gold-file shape gets deliberate handling instead of accidentally
// validating against the wrong (or no) schema.
const here = dirname(fileURLToPath(import.meta.url));
const goldDir = join(here, "gold");

const RELATIONSHIP_PAIR_FILES = new Set(["relationshipPairs.empirical.json", "relationshipPairs.humanities.json", "retrievalNegatives.json"]);
const SEARCH_QUERY_FILES = new Set(["searchQueries.json"]);
const CLAIM_NATURE_FILES = new Set(["claimNature.json"]);

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
        if (RELATIONSHIP_PAIR_FILES.has(file)) {
          it(`${file} parses and conforms to GoldRelationshipPair[]`, () => {
            const raw = readFileSync(join(goldDir, file), "utf8");
            expect(() => parseGoldRelationshipPairsFile(raw)).not.toThrow();
          });
        } else if (SEARCH_QUERY_FILES.has(file)) {
          it(`${file} parses and conforms to GoldSearchQuery[]`, () => {
            const raw = readFileSync(join(goldDir, file), "utf8");
            expect(() => parseGoldSearchQueriesFile(raw)).not.toThrow();
          });
        } else if (CLAIM_NATURE_FILES.has(file)) {
          it(`${file} parses and conforms to GoldClaimNatureExample[]`, () => {
            const raw = readFileSync(join(goldDir, file), "utf8");
            expect(() => parseGoldClaimNatureFile(raw)).not.toThrow();
          });
        } else {
          it(`${file} has a recognized gold-file schema mapping`, () => {
            throw new Error(
              `Unrecognized gold file "${file}" — add it to one of the filename sets in goldSchema.test.ts ` +
                `(and, if it's a genuinely new shape, a matching schema/parser in goldSchema.ts) rather than ` +
                `letting it go unvalidated.`,
            );
          });
        }
      }
    }
  }
});
