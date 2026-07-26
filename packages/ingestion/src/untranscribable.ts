/**
 * D-23-9: deterministic detector for spans a source PDF's corrupted font
 * encoding (broken/missing CMap) turned into unrecoverable garbage during
 * text extraction. The extracted bytes were proven byte-identical across
 * unpdf, poppler, and GROBID — the mojibake originates in the source scan,
 * not this pipeline — so the honest presentation is to MARK the affected
 * span as untranscribable rather than display garbage as if it were text.
 *
 * Design constraints (all deliberate):
 * - Pure and deterministic: string in, spans out. No model call, no config.
 * - CONSERVATIVE: legitimate polytonic Greek, Hebrew (with niqqud), Arabic
 *   (with harakat), CJK (including intra-word Han/kana mixing, which is
 *   normal Japanese), and Latin transliteration diacritics must NEVER be
 *   flagged. When unsure, do not flag.
 * - Stored bytes are never altered; callers recompute spans on read and
 *   decide presentation. This module only reports offsets.
 *
 * Signals (per whitespace-delimited word):
 * 1. U+FFFD replacement character — always garbage: it is what the
 *    ingestion boundary itself substitutes for unpaired surrogates
 *    (sanitizeText.ts), and what decoders emit for undecodable bytes.
 * 2. Private-use / noncharacter / lone-surrogate codepoints at high density
 *    within the word. A single stray PUA char inside an otherwise-normal
 *    word is NOT flagged (could be a font ligature artifact).
 * 3. Nonsensical script mixture inside one word: three or more distinct
 *    major scripts, or rapid alternation between two scripts — patterns no
 *    legitimate word exhibits. Han/Hiragana/Katakana/Hangul/Bopomofo are
 *    ONE bucket (normal East Asian orthography mixes them within a word),
 *    and letters whose script is not recognized are ignored entirely
 *    rather than counted as evidence.
 * 4. Symbol-font / broken-CMap garble that decodes to LATIN glyphs (so
 *    signals 2 and 3 see nothing — no PUA, no non-Latin script). Confirmed
 *    on a real fixture where a corrupted CMap rendered polytonic Greek as
 *    Latin mojibake in the SAME font as the surrounding English ("(?ia(j)?QOvxai)",
 *    "(ejiiQv\iovgiv)", "(^loxOilQia)"). The marker characters '?', '^' and '\\'
 *    each have a rare legitimate use — a lost em-dash ("pursue?and"), an ASCII
 *    exponent ("2^n"), a LaTeX command / Windows path / regex escape
 *    ("\emph", "C:\\Users\\name", "\\bword\\b") — so a marker ALONE is never
 *    enough. A word is flagged only with corroboration, all deterministic:
 *      (A) two or more '?' immediately before a letter (real prose never
 *          double-question-glues a word), OR
 *      (B) an ADJACENT '?'/'^' pair immediately before a letter ("?^e", "??a"
 *          — never math, whose carets are letter-separated, nor an emphatic
 *          trailing "what??"), OR
 *      (C) any marker before a letter (or a mid-word backslash) TOGETHER WITH
 *          an interior case anomaly (a lowercase immediately followed by an
 *          uppercase — the random casing a Greek→Latin CMap dump produces,
 *          which "\emph"/"C:\\Users"/"a^b^c" do not have).
 *    Clean mojibake with no marker character (e.g. "aviaxoi" for ἄκρατοι) and
 *    all-lowercase-marker tokens with no case anomaly (e.g. an isolated
 *    "o^ai") are deliberately NOT detectable by conservative means and are
 *    left as prose — the same honest limitation as OCR l-for-1 confusions
 *    inside citations. Precision over recall is the standing rule.
 *
 * A second, cross-word pass (D-23-39, canary follow-up 2026-07-26) closes
 * one narrow gap left by the per-word rules above: a real production garble
 * — "aiQoijvxai ?vxi x v ?oxouvxoov ?avxo?" — has THREE separate words each
 * carrying a single, uncorroborated '?' immediately before a letter, none
 * individually flagged (a lone '?' before a letter is the documented
 * legitimate lost-dash pattern, e.g. "pursue?and"). Three or more such
 * words within a short span of each other is a distinct signal a single
 * lone marker isn't: no legitimate document loses three dashes to '?'
 * within a handful of words of one another. Restricted to '?' alone (never
 * '^' or '\\') and requires no OTHER signal to be present — deliberately
 * NOT combined with the case-anomaly signal above, because a case-anomaly
 * word can be a perfectly ordinary proper name (e.g. "MacIntyre") that
 * could otherwise co-occur near an innocent lost-dash '?' by coincidence.
 * Caret-heavy math ("a^b^c", "e^x^2", "2^n^m") legitimately clusters
 * several caret-before-letter words together and must never trip this path
 * — verified adversarially below.
 */

export type UntranscribableReason =
  | "replacement_character"
  | "private_use"
  | "script_mixture"
  | "garbled_encoding";

export interface UntranscribableSpan {
  /** UTF-16 code-unit offset into the input string (inclusive). */
  start: number;
  /** UTF-16 code-unit offset into the input string (exclusive). */
  end: number;
  reason: UntranscribableReason;
}

/** Script buckets. CJK scripts are deliberately one bucket — mixing Han with
 * kana (Japanese) or Hangul (Korean hanja) inside a word is normal writing,
 * never a garbage signal. Unrecognized-script letters are ignored. */
const SCRIPT_BUCKETS: Array<[name: string, matcher: RegExp]> = [
  ["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u],
  ["latin", /\p{Script=Latin}/u],
  ["greek", /[\p{Script=Greek}\p{Script=Coptic}]/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["arabic", /[\p{Script=Arabic}\p{Script=Syriac}]/u],
  ["armenian", /\p{Script=Armenian}/u],
  ["georgian", /\p{Script=Georgian}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
  ["bengali", /\p{Script=Bengali}/u],
  ["tamil", /\p{Script=Tamil}/u],
  ["thai", /\p{Script=Thai}/u],
  ["ethiopic", /\p{Script=Ethiopic}/u],
];

const LETTER = /\p{L}/u;

// Signal 4 (garbled_encoding) markers. Each has a rare legitimate use, so
// none is sufficient alone — see the header comment for the corroboration
// rules these feed.
const Q_BEFORE_LETTER = /\?[A-Za-z]/g; // '?' immediately before a Latin letter
const CARET_BEFORE_LETTER = /\^[A-Za-z]/; // '^' immediately before a Latin letter
const MIDWORD_BACKSLASH = /[A-Za-z]\\[A-Za-z]/; // backslash flanked by letters
const ADJACENT_QC_BEFORE_LETTER = /[?^]{2}[A-Za-z]/; // "?^e", "??a" — never math
const CASE_ANOMALY = /[a-z][A-Z]/; // interior lowercase→uppercase (CMap casing)

// Non-global counterpart of Q_BEFORE_LETTER for a plain boolean test (a
// global regex's `.test()` carries `lastIndex` state across calls, which is
// unsafe to reuse per-word in a loop). Used only by the cross-word cluster
// pass below, never by `classifyWord`'s own same-word qCount logic.
const LONE_Q_BEFORE_LETTER = /\?[A-Za-z]/;
// "Short window": up to this many words either side of a candidate marker
// word are considered when counting nearby marker words. Wide enough to
// cover the real fixture's three marker words (six words apart at most),
// tight enough that unrelated '?' usage elsewhere in a long document can
// never accumulate into a false cluster.
const MARKER_CLUSTER_WINDOW = 4;
// Marker-bearing words required within the window (inclusive of the
// candidate itself) before the cluster signal fires.
const MARKER_CLUSTER_MIN = 3;

function scriptBucket(char: string): string | null {
  for (const [name, matcher] of SCRIPT_BUCKETS) {
    if (matcher.test(char)) return name;
  }
  return null;
}

/** PUA (all three areas), Unicode noncharacters, and lone surrogates. These
 * codepoints carry no interoperable textual meaning in extracted prose. */
function isGarbageCodepoint(cp: number, charLength: number): boolean {
  if (charLength === 1 && cp >= 0xd800 && cp <= 0xdfff) return true; // lone surrogate
  if (cp >= 0xe000 && cp <= 0xf8ff) return true; // BMP private use
  if (cp >= 0xf0000 && cp <= 0xffffd) return true; // plane 15 private use
  if (cp >= 0x100000 && cp <= 0x10fffd) return true; // plane 16 private use
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true; // noncharacters
  if ((cp & 0xfffe) === 0xfffe) return true; // U+xFFFE / U+xFFFF noncharacters
  return false;
}

function classifyWord(word: string): UntranscribableReason | null {
  const chars = [...word];

  // Signal 1: replacement character — unconditional.
  if (word.includes("�")) return "replacement_character";

  // Signal 2: private-use / noncharacter density.
  let garbage = 0;
  for (const char of chars) {
    if (isGarbageCodepoint(char.codePointAt(0)!, char.length)) garbage += 1;
  }
  if (garbage >= 2 || (garbage >= 1 && garbage / chars.length >= 0.5)) {
    return "private_use";
  }

  // Signal 3: nonsensical script mixture among the word's letters.
  const letterBuckets: string[] = [];
  for (const char of chars) {
    if (!LETTER.test(char)) continue;
    const bucket = scriptBucket(char);
    if (bucket !== null) letterBuckets.push(bucket); // unrecognized: ignored
  }
  const distinct = new Set(letterBuckets);
  if (distinct.size >= 3 && letterBuckets.length >= 4) return "script_mixture";
  if (distinct.size >= 2 && letterBuckets.length >= 6) {
    let transitions = 0;
    for (let i = 1; i < letterBuckets.length; i += 1) {
      if (letterBuckets[i] !== letterBuckets[i - 1]) transitions += 1;
    }
    // No legitimate word alternates scripts this often; "α-helix"-style
    // two-script terms have exactly one transition and stay unflagged.
    if (transitions >= 4) return "script_mixture";
  }

  // Signal 4: symbol-font / broken-CMap garble that decoded to Latin glyphs.
  {
    const qCount = (word.match(Q_BEFORE_LETTER) ?? []).length;
    const hasMarkerBeforeLetter = qCount > 0 || CARET_BEFORE_LETTER.test(word);
    const corroboratedByCase = CASE_ANOMALY.test(word) && (hasMarkerBeforeLetter || MIDWORD_BACKSLASH.test(word));
    if (qCount >= 2 || ADJACENT_QC_BEFORE_LETTER.test(word) || corroboratedByCase) {
      return "garbled_encoding";
    }
  }

  return null;
}

interface WordMatch {
  start: number;
  end: number;
  text: string;
}

function collectWords(text: string): WordMatch[] {
  const words: WordMatch[] = [];
  const wordPattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    words.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return words;
}

/**
 * Detect spans of `text` that are untranscribable source-scan garbage.
 * Offsets are UTF-16 code-unit offsets into the input, suitable for
 * `text.slice(start, end)`. Adjacent flagged words separated only by
 * whitespace are merged into a single span (the first word's reason wins)
 * so the reader renders one honest marker, not a stutter of them.
 */
export function detectUntranscribableSpans(text: string): UntranscribableSpan[] {
  const words = collectWords(text);
  const hasLoneMarker = words.map((word) => LONE_Q_BEFORE_LETTER.test(word.text));

  const spans: UntranscribableSpan[] = [];
  for (let i = 0; i < words.length; i += 1) {
    let reason = classifyWord(words[i].text);

    if (!reason && hasLoneMarker[i]) {
      const lo = Math.max(0, i - MARKER_CLUSTER_WINDOW);
      const hi = Math.min(words.length - 1, i + MARKER_CLUSTER_WINDOW);
      let clustered = 0;
      for (let j = lo; j <= hi; j += 1) {
        if (hasLoneMarker[j]) clustered += 1;
      }
      if (clustered >= MARKER_CLUSTER_MIN) reason = "garbled_encoding";
    }

    if (!reason) continue;
    const { start, end } = words[i];
    const previous = spans[spans.length - 1];
    if (previous && /^\s*$/.test(text.slice(previous.end, start))) {
      previous.end = end; // merge across whitespace-only gap
    } else {
      spans.push({ start, end, reason });
    }
  }
  return spans;
}
