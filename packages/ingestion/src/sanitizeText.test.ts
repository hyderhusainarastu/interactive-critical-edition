import { describe, expect, it } from "vitest";
import { sanitizeExtractedText } from "./sanitizeText";

describe("sanitizeExtractedText", () => {
  it("leaves well-formed text untouched", () => {
    expect(sanitizeExtractedText("Nicomachean Ethics — Book I §3")).toBe("Nicomachean Ethics — Book I §3");
  });

  it("replaces an unpaired high surrogate", () => {
    const input = `broken${String.fromCharCode(0xd800)}text`;
    expect(sanitizeExtractedText(input)).toBe("broken�text");
  });

  it("replaces an unpaired low surrogate", () => {
    const input = `broken${String.fromCharCode(0xdc00)}text`;
    expect(sanitizeExtractedText(input)).toBe("broken�text");
  });

  it("preserves a valid surrogate pair (emoji)", () => {
    expect(sanitizeExtractedText("note 📖 here")).toBe("note 📖 here");
  });

  it("strips embedded NUL bytes", () => {
    const input = `before${String.fromCharCode(0)}after`;
    expect(sanitizeExtractedText(input)).toBe("beforeafter");
  });
});
