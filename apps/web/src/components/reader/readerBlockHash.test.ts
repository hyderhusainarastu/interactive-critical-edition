import { describe, expect, it } from "vitest";
import { parseReaderBlockHash } from "./readerBlockHash";

describe("parseReaderBlockHash", () => {
  it("parses the block id out of a #block- fragment", () => {
    expect(parseReaderBlockHash("#block-abc-123")).toBe("abc-123");
    expect(parseReaderBlockHash("#block-" + "00000000-0000-0000-0000-000000000001")).toBe("00000000-0000-0000-0000-000000000001");
  });

  // No fragment at all, or a fragment for something else entirely.
  it("returns null for no fragment at all, or a fragment for something else entirely", () => {
    expect(parseReaderBlockHash("")).toBe(null);
    expect(parseReaderBlockHash("#something-else")).toBe(null);
    expect(parseReaderBlockHash("#block")).toBe(null);
  });

  // Present but empty — names nothing.
  it("returns null for a #block- fragment that is present but empty — it names nothing", () => {
    expect(parseReaderBlockHash("#block-")).toBe(null);
  });
});
