import { describe, expect, it } from "vitest";
import { shouldAttemptLegacyTranslation } from "./useLegacyGraphUrlRedirect";

/** Covers the pure layer only, per this file's own doc comment on why
 *  the React-binding layer is not unit-tested here. */

describe("shouldAttemptLegacyTranslation", () => {
  it("treats bare /graph as a legacy-translation candidate", () => {
    expect(shouldAttemptLegacyTranslation(new URLSearchParams())).toBe(true);
  });

  it("translates when an old param is present and no ctxKind", () => {
    expect(shouldAttemptLegacyTranslation(new URLSearchParams("layout=explore"))).toBe(true);
  });

  it("never re-translates a new-format URL", () => {
    expect(shouldAttemptLegacyTranslation(new URLSearchParams("ctxKind=work&ctxId=w1"))).toBe(false);
  });

  it("skips on ctxKind alone, even without ctxId", () => {
    expect(shouldAttemptLegacyTranslation(new URLSearchParams("ctxKind=work"))).toBe(false);
  });
});
