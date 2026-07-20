import { describe, expect, it } from "vitest";
import {
  INFERRED_FROM_COMPLETION_SCORE,
  defaultMasteryForReaderLevel,
  effectiveMastery,
  shouldOverwriteMastery,
} from "./mastery";

describe("shouldOverwriteMastery", () => {
  it("always allows writing when nothing exists yet", () => {
    expect(shouldOverwriteMastery(null, "inferred")).toBe(true);
    expect(shouldOverwriteMastery(null, "explicit")).toBe(true);
  });

  it("blocks a weaker source from overwriting a stronger one", () => {
    expect(shouldOverwriteMastery("explicit", "diagnostic")).toBe(false);
    expect(shouldOverwriteMastery("explicit", "inferred")).toBe(false);
    expect(shouldOverwriteMastery("diagnostic", "inferred")).toBe(false);
  });

  it("allows a stronger or equal source to overwrite", () => {
    expect(shouldOverwriteMastery("inferred", "diagnostic")).toBe(true);
    expect(shouldOverwriteMastery("inferred", "explicit")).toBe(true);
    expect(shouldOverwriteMastery("diagnostic", "explicit")).toBe(true);
  });

  it("allows a retaken diagnostic/explicit to refresh the same-precedence source", () => {
    expect(shouldOverwriteMastery("diagnostic", "diagnostic")).toBe(true);
    expect(shouldOverwriteMastery("explicit", "explicit")).toBe(true);
    expect(shouldOverwriteMastery("inferred", "inferred")).toBe(true);
  });
});

describe("defaultMasteryForReaderLevel", () => {
  it("is monotonically non-decreasing across the four real levels", () => {
    const b = defaultMasteryForReaderLevel("beginner");
    const u = defaultMasteryForReaderLevel("undergraduate");
    const a = defaultMasteryForReaderLevel("advanced");
    const r = defaultMasteryForReaderLevel("research");
    expect(b).toBeLessThan(u);
    expect(u).toBeLessThan(a);
    expect(a).toBeLessThan(r);
  });

  it("falls back to the undergraduate default for null or an unrecognized level", () => {
    expect(defaultMasteryForReaderLevel(null)).toBe(defaultMasteryForReaderLevel("undergraduate"));
    expect(defaultMasteryForReaderLevel("not-a-real-level")).toBe(defaultMasteryForReaderLevel("undergraduate"));
  });
});

describe("effectiveMastery", () => {
  it("uses the recorded score when one exists, regardless of reader level", () => {
    expect(effectiveMastery({ existing: { score: 10 }, readerLevel: "research" })).toBe(10);
    expect(effectiveMastery({ existing: { score: 90 }, readerLevel: "beginner" })).toBe(90);
  });

  it("falls back to the reader-level default only when nothing is recorded", () => {
    expect(effectiveMastery({ existing: null, readerLevel: "advanced" })).toBe(defaultMasteryForReaderLevel("advanced"));
    expect(effectiveMastery({ existing: null, readerLevel: null })).toBe(defaultMasteryForReaderLevel(null));
  });
});

describe("INFERRED_FROM_COMPLETION_SCORE", () => {
  it("crosses the roadmap's KNOWN_THRESHOLD (60) so 'weakly known' is still known", () => {
    expect(INFERRED_FROM_COMPLETION_SCORE).toBeGreaterThanOrEqual(60);
  });
});
