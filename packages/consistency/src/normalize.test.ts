import { describe, expect, it } from "vitest";
import { firstSurnameFromFreeText, titleOverlap } from "./normalize";

describe("titleOverlap", () => {
  it("is 1 for identical titles modulo case/punctuation", () => {
    expect(titleOverlap("The Nicomachean Ethics", "the nicomachean ethics!")).toBeCloseTo(1);
  });

  it("is high for a stopword/article variant of the same title", () => {
    expect(titleOverlap("The Nicomachean Ethics", "Nicomachean Ethics, The")).toBeGreaterThan(0.8);
  });

  it("is low for genuinely unrelated titles", () => {
    expect(titleOverlap("The Nicomachean Ethics", "Introduction to Quantum Mechanics")).toBeLessThan(0.2);
  });

  it("is 0 when either title has no significant tokens", () => {
    expect(titleOverlap("", "The Nicomachean Ethics")).toBe(0);
  });
});

describe("firstSurnameFromFreeText", () => {
  it("takes the last token when there is no comma", () => {
    expect(firstSurnameFromFreeText("Terence Irwin")).toBe("irwin");
  });

  it("takes the first token when the name is comma-formatted", () => {
    expect(firstSurnameFromFreeText("Irwin, Terence")).toBe("irwin");
  });

  it("uses only the first author from a multi-author free-text field", () => {
    expect(firstSurnameFromFreeText("Terence Irwin and Gail Fine")).toBe("irwin");
  });

  it("returns null for empty/null input", () => {
    expect(firstSurnameFromFreeText(null)).toBeNull();
    expect(firstSurnameFromFreeText("")).toBeNull();
  });
});
