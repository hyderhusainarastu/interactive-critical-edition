import { describe, expect, it } from "vitest";
import { detectUntranscribableSpans } from "./untranscribable";

/**
 * D-23-9 adversarial verification (independent of the implementer's suite).
 * The never-fabricate/never-hide bar cuts both ways: a false positive here
 * would label real scholarly text as garbage (fabricating a defect in the
 * source), and a false negative would present garbage as prose (hiding one).
 */
describe("adversarial: legitimate scholarly text must never be flagged", () => {
  it("standalone polytonic Greek key terms", () => {
    expect(detectUntranscribableSpans("ἀρετή")).toEqual([]);
    expect(detectUntranscribableSpans("εὐδαιμονία")).toEqual([]);
    expect(detectUntranscribableSpans("σωφροσύνη φρόνησις ἀκρασία")).toEqual([]);
  });

  it("Greek terms mid-English-sentence with punctuation hugging them", () => {
    expect(
      detectUntranscribableSpans(
        "Aristotle's ἀρετή (excellence) and εὐδαιμονία, i.e. flourishing, differ; see ἀκρασία.",
      ),
    ).toEqual([]);
  });

  it("Hebrew with dense niqqud including maqaf-joined tokens", () => {
    expect(
      detectUntranscribableSpans("וַיֹּאמֶר אֱלֹהִים יְהִי־אוֹר וַיְהִי־אוֹר"),
    ).toEqual([]);
  });

  it("IPA transliteration, including IPA's borrowed Greek letters", () => {
    // θ (theta) and β (beta) are Script=Greek codepoints living inside
    // otherwise-Latin IPA strings — a classic two-script false-positive trap.
    expect(detectUntranscribableSpans("/ˌɛθnoʊˈɡɹæfi/ [ˈβaθo] /ˈrɪðəm/ [ˈʃɪbəleθ]")).toEqual([]);
  });

  it("mathematical symbols and blackboard-bold letters", () => {
    expect(
      detectUntranscribableSpans("∀x ∈ ℝ: √(x²) = |x|; ∑ᵢ aᵢ ≤ ∫f dμ × π ≈ 3.14159"),
    ).toEqual([]);
  });

  it("curly quotes, em/en dashes, ellipsis, guillemets", () => {
    expect(
      detectUntranscribableSpans(
        "“Don’t,” she said — ‘never’ … pages 12–14; «voilà» ‹fin›",
      ),
    ).toEqual([]);
  });

  it("Latin words with heavy combining diacritics (Vietnamese, Navajo)", () => {
    expect(detectUntranscribableSpans("Nguyễn Việt Nam tʼáá hwó ají tʼéego")).toEqual([]);
  });

  it("Greek-Latin hyphenated pairs and slash-joined glosses", () => {
    expect(detectUntranscribableSpans("ἕξις/disposition λόγος-doctrine ψυχή(soul)")).toEqual([]);
  });

  it("emoji and dingbats are not garbage codepoints", () => {
    expect(detectUntranscribableSpans("done ✓ ★ 🎉 → next")).toEqual([]);
  });

  it("Cyrillic prose with a single Latin abbreviation token", () => {
    expect(detectUntranscribableSpans("Толстой писал (cf. Anna Karenina) о морали")).toEqual([]);
  });

  it("Signal 4 must not flag question marks, math carets, or dash-loss (adversarial)", () => {
    // Every legitimate use of the signal-4 marker characters that survived the
    // implementer's own gating, re-checked independently: sentence-final '?',
    // a '?' hugging a closing paren, ASCII exponent notation, LaTeX-free math,
    // and a single '?' that replaced a lost em-dash between two readable words.
    expect(detectUntranscribableSpans("What is virtue? Is it teachable? (really?)")).toEqual([]);
    expect(detectUntranscribableSpans("x^2 + y^2 = r^2, and 2^n grows for all n")).toEqual([]);
    expect(detectUntranscribableSpans("both pursue?and both avoid?is the crux")).toEqual([]);
    expect(detectUntranscribableSpans("cost/benefit ratio ~ p^value under H0")).toEqual([]);
  });

  it("Signal 4 backslash/caret classes: LaTeX, paths, regex escapes, glued caret-math (adversarial)", () => {
    // The five verifier probe classes that a naive backslash/two-marker gate
    // false-flags. None carries an interior lowercase→uppercase case anomaly,
    // an adjacent '?'/'^' pair, or a doubled '?', so none is flagged.
    expect(detectUntranscribableSpans("emphasize with \\emph{this} and \\textbf{that} \\alpha\\beta")).toEqual([]); // LaTeX commands
    expect(detectUntranscribableSpans("the regex \\d+ then \\n and \\s+ match digits")).toEqual([]); // regex / string escapes
    expect(detectUntranscribableSpans("open the folder C:\\Users\\name\\Documents please")).toEqual([]); // Windows path
    expect(detectUntranscribableSpans("grep for \\bword\\b and \\Bother in the corpus")).toEqual([]); // shell word-boundary regex
    expect(detectUntranscribableSpans("compute a^b^c and e^x^2 and 2^n^m over the reals")).toEqual([]); // glued caret-math
  });

  it("Signal 4 still detects the real CMap mojibake despite the tightened gate", () => {
    // The tightened gate must not silently kill recall on the genuine article.
    expect(detectUntranscribableSpans("desire (ejiiQv\\iovgiv) some things")).toHaveLength(1); // backslash + case anomaly
    expect(detectUntranscribableSpans("conflict (?ia(j)?QOvxai) here")).toHaveLength(1); // two '?' before letters
    expect(detectUntranscribableSpans("in conflict (axaoi?^ei) on")).toHaveLength(1); // adjacent '?^'
  });
});

describe("adversarial: genuine mojibake must always be flagged", () => {
  it("a long U+FFFD run", () => {
    const text = "before ������ after";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("replacement_character");
    expect(text.slice(spans[0].start, spans[0].end)).toBe("�".repeat(6));
  });

  it("a single U+FFFD embedded in an otherwise-normal word", () => {
    // Replacement char is what our own sanitizer emits for unpaired
    // surrogates — even one means the word lost data. Must flag.
    const spans = detectUntranscribableSpans("philo�ophy");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("replacement_character");
  });

  it("PUA-heavy garbage word (symbol-font CMap dump)", () => {
    const garbage = "";
    const spans = detectUntranscribableSpans(`ok ${garbage} ok`);
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
  });

  it("PUA garbage interleaved with ASCII inside one word", () => {
    const spans = detectUntranscribableSpans(`xyz`);
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
  });

  it("plane-16 private use plus noncharacter mix", () => {
    const spans = detectUntranscribableSpans("a \u{100000}﷕ b");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
  });

  it("U+FFFE / U+FFFF noncharacters", () => {
    const spans = detectUntranscribableSpans("a ￾￿ b");
    expect(spans).toHaveLength(1);
    expect(spans[0].reason).toBe("private_use");
  });

  it("offsets slice exactly the garbage even when surrounded by astral-plane text", () => {
    // 𝔊 (U+1D50A) is 2 UTF-16 code units — offsets must stay code-unit exact.
    const text = "𝔊𝔬𝔱𝔥𝔦𝔠 �� tail";
    const spans = detectUntranscribableSpans(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("��");
  });

  it("determinism under repetition and input reuse", () => {
    const text = "ἀρετή �x  xжyжzжa end";
    const first = JSON.stringify(detectUntranscribableSpans(text));
    for (let i = 0; i < 50; i += 1) {
      expect(JSON.stringify(detectUntranscribableSpans(text))).toBe(first);
    }
  });
});
