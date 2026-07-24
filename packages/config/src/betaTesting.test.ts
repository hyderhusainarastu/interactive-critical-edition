import { describe, expect, it } from "vitest";
import { isBetaTestingMode } from "./betaTesting";

describe("isBetaTestingMode", () => {
  it("fails closed when unset", () => {
    expect(isBetaTestingMode({})).toBe(false);
  });

  it("fails closed on an explicit false", () => {
    expect(isBetaTestingMode({ BETA_TESTING_MODE: "false" })).toBe(false);
  });

  it("accepts conventional true values", () => {
    expect(isBetaTestingMode({ BETA_TESTING_MODE: "true" })).toBe(true);
    expect(isBetaTestingMode({ BETA_TESTING_MODE: "ON" })).toBe(true);
    expect(isBetaTestingMode({ BETA_TESTING_MODE: "1" })).toBe(true);
  });
});
