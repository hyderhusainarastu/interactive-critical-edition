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
 */

export type UntranscribableReason =
  | "replacement_character"
  | "private_use"
  | "script_mixture";

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

  return null;
}

/**
 * Detect spans of `text` that are untranscribable source-scan garbage.
 * Offsets are UTF-16 code-unit offsets into the input, suitable for
 * `text.slice(start, end)`. Adjacent flagged words separated only by
 * whitespace are merged into a single span (the first word's reason wins)
 * so the reader renders one honest marker, not a stutter of them.
 */
export function detectUntranscribableSpans(text: string): UntranscribableSpan[] {
  const spans: UntranscribableSpan[] = [];
  const wordPattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    const reason = classifyWord(match[0]);
    if (!reason) continue;
    const start = match.index;
    const end = match.index + match[0].length;
    const previous = spans[spans.length - 1];
    if (previous && /^\s*$/.test(text.slice(previous.end, start))) {
      previous.end = end; // merge across whitespace-only gap
    } else {
      spans.push({ start, end, reason });
    }
  }
  return spans;
}
