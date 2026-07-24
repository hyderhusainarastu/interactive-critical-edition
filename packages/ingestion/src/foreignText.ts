/**
 * Conservative, deterministic discovery for foreign-script text that already
 * exists in the extracted source. This module never translates, transliterates,
 * or guesses a language from content. Script ranges provide only a language
 * hint; downstream model/human review must preserve that distinction.
 */
export const FOREIGN_SCRIPTS = ["greek", "hebrew", "arabic", "cyrillic", "cjk"] as const;
export type ForeignScript = (typeof FOREIGN_SCRIPTS)[number];

export type ForeignLanguageHint = "el" | "he" | "ar" | "und-Cyrl" | "und-Hani";
export type ForeignTextDirection = "ltr" | "rtl";
export type ForeignSpanProvenanceKind =
  | "source_text"
  | "ocr_recovery"
  | "pdf_glyph_recovery"
  | "manual";

export interface ForeignSpanProvenance {
  kind: ForeignSpanProvenanceKind;
  /** Reader-facing, factual description of how this exact text was obtained. */
  label: string;
  /** Confidence in the transcription, not in any later translation. */
  confidence: number;
}

export interface DetectedForeignSpan {
  start: number;
  end: number;
  text: string;
  script: ForeignScript;
  /**
   * Script-derived hint only. In particular, Cyrillic and CJK do not identify
   * one language, and Arabic script is used by more languages than Arabic.
   */
  languageHint: ForeignLanguageHint;
  languageBasis: "script_range";
  direction: ForeignTextDirection;
  provenance: ForeignSpanProvenance;
}

export interface ForeignSpanAnchor {
  originalText: string;
  startOffset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
}

export interface MatchedForeignSpan {
  start: number;
  end: number;
  method: "stored_offset" | "context_match" | "unique_text";
}

const SCRIPT_MATCHERS: Array<{
  script: ForeignScript;
  matcher: RegExp;
  languageHint: ForeignLanguageHint;
  direction: ForeignTextDirection;
}> = [
  { script: "greek", matcher: /\p{Script=Greek}/u, languageHint: "el", direction: "ltr" },
  { script: "hebrew", matcher: /\p{Script=Hebrew}/u, languageHint: "he", direction: "rtl" },
  { script: "arabic", matcher: /\p{Script=Arabic}/u, languageHint: "ar", direction: "rtl" },
  { script: "cyrillic", matcher: /\p{Script=Cyrillic}/u, languageHint: "und-Cyrl", direction: "ltr" },
  {
    script: "cjk",
    matcher: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u,
    languageHint: "und-Hani",
    direction: "ltr",
  },
];

const COMBINING_MARK = /\p{M}/u;
const JOINER = /['’ʼ\u05f3\u05f4\u0640\u200c\u200d]/u;

function scriptInfo(char: string) {
  return SCRIPT_MATCHERS.find((entry) => entry.matcher.test(char)) ?? null;
}

function overlaps(start: number, end: number, excluded: readonly { start: number; end: number }[]): boolean {
  return excluded.some((range) => start < range.end && end > range.start);
}

/**
 * Finds runs in the five requested script families. Combining marks remain
 * attached to their base character, including polytonic Greek, niqqud, and
 * Arabic harakat. Stored bytes are not modified.
 */
export function detectForeignScriptSpans(
  text: string,
  options: { excludedSpans?: readonly { start: number; end: number }[] } = {},
): DetectedForeignSpan[] {
  const excluded = options.excludedSpans ?? [];
  const codepoints: Array<{ char: string; start: number; end: number }> = [];
  for (let offset = 0; offset < text.length;) {
    const codepoint = text.codePointAt(offset);
    if (codepoint === undefined) break;
    const char = String.fromCodePoint(codepoint);
    codepoints.push({ char, start: offset, end: offset + char.length });
    offset += char.length;
  }

  const spans: DetectedForeignSpan[] = [];
  for (let index = 0; index < codepoints.length; index += 1) {
    const first = codepoints[index]!;
    const info = scriptInfo(first.char);
    if (!info || overlaps(first.start, first.end, excluded)) continue;

    let end = first.end;
    let cursor = index + 1;
    while (cursor < codepoints.length) {
      const next = codepoints[cursor]!;
      if (overlaps(next.start, next.end, excluded)) break;
      const nextInfo = scriptInfo(next.char);
      if (nextInfo?.script === info.script || COMBINING_MARK.test(next.char)) {
        end = next.end;
        cursor += 1;
        continue;
      }
      const following = codepoints[cursor + 1];
      if (JOINER.test(next.char) && following && scriptInfo(following.char)?.script === info.script) {
        end = next.end;
        cursor += 1;
        continue;
      }
      break;
    }

    const spanText = text.slice(first.start, end);
    spans.push({
      start: first.start,
      end,
      text: spanText,
      script: info.script,
      languageHint: info.languageHint,
      languageBasis: "script_range",
      direction: info.direction,
      provenance: {
        kind: "source_text",
        label: "extracted source text",
        confidence: 1,
      },
    });
    index = cursor - 1;
  }
  return spans;
}

export function createForeignSpanAnchor(
  text: string,
  span: Pick<DetectedForeignSpan, "start" | "end" | "text">,
  contextLength = 32,
): ForeignSpanAnchor {
  return {
    originalText: span.text,
    startOffset: span.start,
    endOffset: span.end,
    prefix: text.slice(Math.max(0, span.start - contextLength), span.start),
    suffix: text.slice(span.end, Math.min(text.length, span.end + contextLength)),
  };
}

/**
 * Relocates a stored foreign span without accepting an ambiguous match.
 * Offset+text wins; otherwise exact text is scored by stored prefix/suffix.
 * A tie returns null rather than silently attaching data to the wrong phrase.
 */
export function matchForeignSpan(text: string, anchor: ForeignSpanAnchor): MatchedForeignSpan | null {
  if (
    anchor.startOffset >= 0
    && anchor.endOffset > anchor.startOffset
    && anchor.endOffset <= text.length
    && text.slice(anchor.startOffset, anchor.endOffset) === anchor.originalText
  ) {
    return { start: anchor.startOffset, end: anchor.endOffset, method: "stored_offset" };
  }
  if (!anchor.originalText) return null;

  const candidates: Array<{ start: number; end: number; score: number }> = [];
  let from = 0;
  while (from <= text.length - anchor.originalText.length) {
    const start = text.indexOf(anchor.originalText, from);
    if (start < 0) break;
    const end = start + anchor.originalText.length;
    const before = text.slice(Math.max(0, start - anchor.prefix.length), start);
    const after = text.slice(end, Math.min(text.length, end + anchor.suffix.length));
    let score = 0;
    if (anchor.prefix && before === anchor.prefix) score += 2;
    if (anchor.suffix && after === anchor.suffix) score += 2;
    candidates.push({ start, end, score });
    from = start + Math.max(1, anchor.originalText.length);
  }
  if (candidates.length === 1) {
    const [only] = candidates;
    return { start: only!.start, end: only!.end, method: only!.score > 0 ? "context_match" : "unique_text" };
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score);
  if (candidates[0]!.score === 0 || candidates[0]!.score === candidates[1]!.score) return null;
  return { start: candidates[0]!.start, end: candidates[0]!.end, method: "context_match" };
}
