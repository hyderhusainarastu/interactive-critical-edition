import { describe, expect, it } from "vitest";
import {
  createForeignSpanAnchor,
  detectForeignScriptSpans,
  matchForeignSpan,
} from "./foreignText";

describe("detectForeignScriptSpans", () => {
  it("detects polytonic Greek with combining marks as one source-backed span", () => {
    const text = "The phrase ἀρετήν appears in the source.";
    expect(detectForeignScriptSpans(text)).toEqual([
      expect.objectContaining({
        text: "ἀρετήν",
        script: "greek",
        languageHint: "el",
        languageBasis: "script_range",
        direction: "ltr",
        provenance: { kind: "source_text", label: "extracted source text", confidence: 1 },
      }),
    ]);
  });

  it.each([
    ["Hebrew with niqqud", "English שָׁלוֹם English", "שָׁלוֹם", "hebrew", "rtl"],
    ["Arabic with harakat", "English السَّلَامُ English", "السَّلَامُ", "arabic", "rtl"],
    ["Cyrillic", "English добродетель English", "добродетель", "cyrillic", "ltr"],
    ["CJK mixed orthography", "English 日本語かな English", "日本語かな", "cjk", "ltr"],
  ])("detects %s without splitting legitimate marks/scripts", (_label, text, expected, script, direction) => {
    expect(detectForeignScriptSpans(text)).toEqual([
      expect.objectContaining({ text: expected, script, direction }),
    ]);
  });

  it("does not invent a foreign span from Latin transliteration or garbage", () => {
    expect(detectForeignScriptSpans("aretē shalom ??? ^Qv\\iov")).toEqual([]);
  });

  it("excludes a detected script run that overlaps an untranscribable range", () => {
    const text = "safe λόγος broken עברית";
    const brokenStart = text.indexOf("עברית");
    expect(detectForeignScriptSpans(text, {
      excludedSpans: [{ start: brokenStart, end: text.length }],
    }).map((span) => span.text)).toEqual(["λόγος"]);
  });
});

describe("matchForeignSpan", () => {
  it("uses validated stored offsets first", () => {
    const text = "Virtue is ἀρετή.";
    const detected = detectForeignScriptSpans(text)[0]!;
    expect(matchForeignSpan(text, createForeignSpanAnchor(text, detected))).toEqual({
      start: detected.start,
      end: detected.end,
      method: "stored_offset",
    });
  });

  it("relocates by exact context after surrounding text shifts", () => {
    const original = "First λόγος; later λόγος.";
    const detected = detectForeignScriptSpans(original)[1]!;
    const anchor = createForeignSpanAnchor(original, detected, 7);
    const shifted = `Preface. ${original}`;
    expect(matchForeignSpan(shifted, anchor)).toEqual({
      start: shifted.lastIndexOf("λόγος"),
      end: shifted.lastIndexOf("λόγος") + "λόγος".length,
      method: "context_match",
    });
  });

  it("refuses ambiguous repeated text when context cannot distinguish it", () => {
    expect(matchForeignSpan("λόγος and λόγος", {
      originalText: "λόγος",
      startOffset: 999,
      endOffset: 1004,
      prefix: "",
      suffix: "",
    })).toBeNull();
  });
});
