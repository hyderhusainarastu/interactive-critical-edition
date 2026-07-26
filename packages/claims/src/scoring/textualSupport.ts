/**
 * Textual-support scoring for claims about primary texts.
 *
 * `evidenceStrength.ts` (ported from ScholarLens) scores how well a claim is
 * empirically grounded — study design, sample size, p-values. That axis is
 * meaningless for the interpretive/historical/textual claims Palimnote's
 * philosophy and textual-scholarship corpus is full of: an interpretive
 * claim about Aristotle is not "weakly supported" for lacking a p-value, it
 * needs a DIFFERENT kind of grounding — a quoted passage, a precise locus
 * citation, engagement with rival readings. This module is that grounding's
 * own scorer, built on the same architecture as `evidenceStrength.ts`
 * (pure, deterministic, named signals, hedging never coerced away) but new:
 * ScholarLens's empirical-paper corpus never needed this.
 *
 * "Mode" here plays the same role `design` plays in `evidenceStrength.ts`:
 * the single strongest matched engagement pattern, chosen by first-match
 * priority order. Unlike `evidenceStrength.ts`'s additive quant signals,
 * `original-language evidence` and `apparatus support` here are pure
 * boosters — they can co-occur with any mode, including a mode they didn't
 * themselves win.
 */

// Classical locus citation forms.
//   Bekker (Aristotle): "1151a20", "1151a20-8"
//   Stephanus (Plato):  "521d"
//   book.chapter:       "NE 7.8", "Pol. 3.4"
const LOCUS_BEKKER = /\b\d{3,4}[ab]\d{1,3}(?:[-–]\d{1,3})?\b/;
const LOCUS_STEPHANUS = /\b\d{1,3}[a-e]\b/;
const LOCUS_BOOK_CHAPTER = /\b(?:NE|EE|Pol|Met|Rep|Eth)\.?\s*\d{1,3}\.\d{1,3}\b/i;
const LOCUS_PATTERN_GLOBAL = new RegExp(
  `${LOCUS_BEKKER.source}|${LOCUS_STEPHANUS.source}|${LOCUS_BOOK_CHAPTER.source}`,
  "gi",
);

// A quoted passage of meaningful length — straight/curly double quotes or
// French guillemets, at least 15 characters inside.
const QUOTATION_PATTERN = /["“][^"”]{15,}["”]|«[^»]{15,}»/;

// "contra X", "pace X", "against ... reading/interpretation", "as X argues".
const RIVAL_READING_PATTERN =
  /\bcontra\b|\bpace\b|\bagainst\b.{0,30}\b(?:reading|interpretation)\b|\bas\b.{0,30}\bargues\b/i;

// Footnote/apparatus markers: "cf.", "see note", "n. 3", "[12]".
const APPARATUS_PATTERN = /\bcf\.|\bsee note\b|\bn\.\s?\d+\b|\[\d+\]/i;

// Greek (incl. polytonic Greek Extended), Hebrew, Arabic, and Cyrillic script
// ranges — the block boundaries below (verified codepoint-by-codepoint) are:
//   Greek and Coptic:  U+0370-U+03FF  (Ͱ-Ͽ)
//   Greek Extended:    U+1F00-U+1FFF  (ἀ-῿)
//   Hebrew:            U+0590-U+05FF  (֐-׿)
//   Arabic:            U+0600-U+06FF  (؀-ۿ)
//   Cyrillic:          U+0400-U+04FF  (Ѐ-ӿ)
const ORIGINAL_LANGUAGE_PATTERN = /[Ͱ-Ͽἀ-῿֐-׿؀-ۿЀ-ӿ]/;

export interface TextualSupport {
  score: number; // 0..1
  label: "strong" | "moderate" | "weak";
  mode: string | null; // the strongest matched engagement pattern, if any
  signals: string[];
}

function labelFor(score: number): "strong" | "moderate" | "weak" {
  if (score >= 0.66) return "strong";
  if (score >= 0.33) return "moderate";
  return "weak";
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function scoreTextualSupport(text: string): TextualSupport {
  const blob = text ?? "";
  if (!blob.trim()) {
    return { score: 0, label: "weak", mode: null, signals: [] };
  }

  const signals: string[] = [];
  let mode: string | null = null;
  let modeScore = 0;

  const locusMatches = blob.match(LOCUS_PATTERN_GLOBAL) ?? [];

  // Mode tiers, strongest-evidence-first (mirrors evidenceStrength.ts's
  // DESIGN_TIERS: first match wins, contributes up to ~0.45 of the score).
  if (QUOTATION_PATTERN.test(blob)) {
    mode = "direct primary-text quotation";
    modeScore = 1.0 * 0.45;
    signals.push(mode);
  } else if (locusMatches.length >= 2) {
    mode = "multiple independent loci (breadth)";
    modeScore = 0.85 * 0.45;
    signals.push(mode);
  } else if (locusMatches.length === 1) {
    mode = "classical locus citation";
    modeScore = 0.6 * 0.45;
    signals.push(mode);
  } else if (RIVAL_READING_PATTERN.test(blob)) {
    mode = "engagement with rival readings";
    modeScore = 0.5 * 0.45;
    signals.push(mode);
  }

  // Additive boosters — can stack on top of any mode above, including one
  // they didn't themselves determine.
  let additive = 0;
  if (ORIGINAL_LANGUAGE_PATTERN.test(blob)) {
    additive += 0.2;
    signals.push("original-language evidence");
  }
  if (APPARATUS_PATTERN.test(blob)) {
    additive += 0.12;
    signals.push("apparatus support (footnote/cf.)");
  }
  // Rival-reading engagement is real evidence even when a stronger mode
  // (quotation/loci) already won the mode slot — recorded once more here as
  // an additive boost rather than lost entirely.
  if (mode !== "engagement with rival readings" && RIVAL_READING_PATTERN.test(blob)) {
    additive += 0.15;
    signals.push("engagement with rival readings");
  }

  const raw = modeScore + additive;
  const score = Math.max(0, Math.min(1, raw));
  return { score: round3(score), label: labelFor(score), mode, signals };
}
