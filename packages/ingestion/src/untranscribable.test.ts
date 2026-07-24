import { describe, expect, it } from "vitest";
import { detectUntranscribableSpans } from "./untranscribable";

/**
 * D-23-9: both directions matter equally. The conservative direction —
 * legitimate non-Latin scholarly text must NEVER be flagged — is tested with
 * real samples of every script family the product actually encounters.
 */
describe("detectUntranscribableSpans — legitimate text is never flagged", () => {
  it("plain English prose", () => {
    expect(detectUntranscribableSpans("The vicious person acts from choice, not ignorance.")).toEqual([]);
  });

  it("empty and whitespace-only input", () => {
    expect(detectUntranscribableSpans("")).toEqual([]);
    expect(detectUntranscribableSpans("   \n\t  ")).toEqual([]);
  });

  it("polytonic Greek (full diacritics: breathings, accents, iota subscript)", () => {
    expect(
      detectUntranscribableSpans("τὴν ἀρετὴν καὶ τὴν φρόνησιν ἐπαινοῦμεν· ᾧ γὰρ Ὅμηρος ᾔδει"),
    ).toEqual([]);
  });

  it("Hebrew with niqqud (pointed text)", () => {
    expect(
      detectUntranscribableSpans("בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ"),
    ).toEqual([]);
  });

  it("Arabic with harakat (vowelled text)", () => {
    expect(
      detectUntranscribableSpans("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ الْحَمْدُ لِلَّهِ"),
    ).toEqual([]);
  });

  it("Chinese (Han)", () => {
    expect(detectUntranscribableSpans("道可道，非常道。名可名，非常名。")).toEqual([]);
  });

  it("Japanese: Han + Hiragana + Katakana mixed inside ONE unspaced token", () => {
    // Whitespace-free Japanese means the whole clause is one "word"; kanji /
    // hiragana / katakana intra-word mixing is normal orthography, not garbage.
    expect(detectUntranscribableSpans("これは日本語のテキストです")).toEqual([]);
  });

  it("Korean Hangul with Han (hanja) in one token", () => {
    expect(detectUntranscribableSpans("大韓民國은 民主共和國이다")).toEqual([]);
  });

  it("Latin transliteration diacritics (IAST, Arabic romanization, macrons)", () => {
    expect(
      detectUntranscribableSpans("the Nīkomacheān Ethics; Śaṅkara's Brahmasūtrabhāṣya; Ḥusayn ibn ʿAlī; aretē"),
    ).toEqual([]);
  });

  it("Greek terms embedded in Latin prose (the product's core case)", () => {
    expect(
      detectUntranscribableSpans("the word λόγος (logos) and Aristotle's ἀρετή appear in α-helix-style compounds"),
    ).toEqual([]);
  });

  it("two-script single word with one boundary (quoted term, hyphenated compound)", () => {
    expect(detectUntranscribableSpans("(λόγος)")).toEqual([]);
    expect(detectUntranscribableSpans("α-helix")).toEqual([]);
    expect(detectUntranscribableSpans("Ὅμηρος/Homer")).toEqual([]);
  });

  it("a single stray private-use char inside a mostly-normal word (unsure → not flagged)", () => {
    // Could be a font-ligature artifact; density is far below threshold.
    expect(detectUntranscribableSpans("presentation of the argument")).toEqual([]);
  });

  it("footnote daggers, math symbols, and punctuation-heavy scholarly text", () => {
    expect(detectUntranscribableSpans("† ‡ § ¶ pp. 44–47; cf. n. 12 (∆ = 0.34)")).toEqual([]);
  });

  it("Signal 4 gate: a trailing '?' (a real question) is never flagged as garbage", () => {
    // "vice?" / "obvious?)" end a real question — the '?' is not before a
    // letter, so signal 4 must ignore them.
    expect(detectUntranscribableSpans("Is this account of vice? Perhaps not obvious?)")).toEqual([]);
  });

  it("Signal 4 gate: a single '?' standing in for a lost dash keeps the words readable", () => {
    // "pursue?and" is "pursue—and" with the em-dash lost — both words are
    // readable, so the single-'?'-no-slash-no-caret case is NOT hidden.
    expect(detectUntranscribableSpans("What both pursue?and what both not pursue?is bodily pleasure.")).toEqual([]);
  });

  it("Signal 4 gate: ASCII math caret/power notation is not flagged", () => {
    // 'x^2' has a caret followed by a DIGIT, not a letter — signal 4 requires
    // a caret/backslash/'?' immediately before a Latin letter.
    expect(detectUntranscribableSpans("let y = x^2 and z = a^10 for all x")).toEqual([]);
  });
});

describe("detectUntranscribableSpans — Signal 4: broken-CMap Latin mojibake", () => {
  it("flags a Greek word a corrupted CMap rendered as Latin with '?' markers", () => {
    // Real fixture token: (?ia(j)?QOvxai) — multiple '?' before letters.
    const text = "For bad people are in conflict (?ia(j)?QOvxai) with themselves";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("garbled_encoding");
    expect(text.slice(spans[0].start, spans[0].end)).toBe("(?ia(j)?QOvxai)");
  });

  it("flags a garble token carrying a backslash mid-word (real fixture)", () => {
    // (ejiiQv\iovgiv): a single backslash before a letter is enough — '\' never
    // sits mid-word in real prose.
    const spans = detectUntranscribableSpans("they desire (ejiiQv\\iovgiv) some things");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("garbled_encoding");
  });

  it("flags a garble token carrying an adjacent '?^' marker pair (real fixture)", () => {
    // (axaoi?^ei) — an adjacent '?^' pair before a letter, which math never
    // produces (its carets are letter-separated).
    const spans = detectUntranscribableSpans("its soul is in conflict (axaoi?^ei) on the one hand");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("garbled_encoding");
  });

  it("flags a caret-marker token WITH a case anomaly (real fixture)", () => {
    // (^loxOilQia) — a caret before a letter AND interior lowercase→uppercase
    // ("xO"), the random casing a CMap dump produces. Distinct from math.
    const spans = detectUntranscribableSpans("its baseness (^loxOilQia) is described");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("garbled_encoding");
  });

  it("does NOT flag ASCII caret exponents (no case anomaly, no adjacent markers)", () => {
    expect(detectUntranscribableSpans("the series 2^n and a^k and x^i for all i")).toEqual([]);
  });

  it("does NOT flag clean mojibake with no marker character (honest limitation)", () => {
    // "aviaxoi" (for ἄκρατοι) reads as a plausible Latin transliteration and
    // carries no ?/\\/^ — conservative detection leaves it as prose.
    expect(detectUntranscribableSpans("beyond cure (aviaxoi) if akrasia is cured")).toEqual([]);
  });
});

describe("detectUntranscribableSpans — genuine mojibake is flagged", () => {
  it("U+FFFD replacement characters", () => {
    const text = "good text l�g�s more text";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("replacement_character");
    expect(text.slice(spans[0].start, spans[0].end)).toBe("l�g�s");
  });

  it("BMP private-use-area runs (symbol-font CMap corruption)", () => {
    const text = "before  after";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
    expect(text.slice(spans[0].start, spans[0].end)).toBe("");
  });

  it("supplementary-plane private-use codepoints", () => {
    const spans = detectUntranscribableSpans("ok \u{F0001}\u{F0002} ok");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
  });

  it("Unicode noncharacters", () => {
    const spans = detectUntranscribableSpans("a ﷐﷑ b");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
  });

  it("a word that is a single private-use char (density 1.0)", () => {
    const spans = detectUntranscribableSpans("bullet  item");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
  });

  it("three-script salad inside one word", () => {
    // Cyrillic + Latin + Greek jammed into four letters — no real word.
    const spans = detectUntranscribableSpans("normal жÎλβ normal");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("script_mixture");
  });

  it("rapid two-script alternation inside one word", () => {
    const spans = detectUntranscribableSpans("ok aжaжaжa ok");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("script_mixture");
  });

  it("adjacent garbage words merge into one span", () => {
    const text = "fine ��  fine";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("�� ");
    expect(spans[0].reason).toBe("replacement_character"); // first word's reason wins
  });

  it("non-adjacent garbage words stay separate spans with exact offsets", () => {
    const text = "�x clean words here ";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(2);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("�x");
    expect(text.slice(spans[1].start, spans[1].end)).toBe("");
  });

  it("garbage embedded between legitimate Greek is scoped to the garbage only", () => {
    const text = "ἀρετή ��� σωφροσύνη";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("���");
  });

  it("is deterministic (identical output across calls)", () => {
    const text = "a � b  c жβxжβx";
    expect(detectUntranscribableSpans(text)).toEqual(detectUntranscribableSpans(text));
  });
});
