/**
 * Minimal, self-contained normalization for the title/author agreement
 * checks. Deliberately NOT imported from `@ice/research` (which has its own,
 * more elaborate `titleKey`/surname logic) — this package stays a
 * zero-dependency pure package like `@ice/deletion`/`@ice/roadmap`, and the
 * comparison here only needs to be "close enough to flag a real disagreement
 * without false-positiving on punctuation/case", not identity-grade.
 */

export function normalizeTitleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

const STOPWORDS = new Set(["the", "and", "of", "an", "a", "on", "in", "to", "for"]);

/** Jaccard similarity over significant title tokens, in [0, 1]. */
export function titleOverlap(a: string, b: string): number {
  const ta = normalizeTitleTokens(a);
  const tb = normalizeTitleTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function normalizeSurname(value: string | null | undefined): string | null {
  const s = (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z'’-]/g, "");
  return s.length ? s : null;
}

/** First author's surname from a free-text "author name" field — same
 *  "last token, or before the first comma" heuristic used elsewhere in this
 *  codebase (`packages/research/src/canonicalIdentity.ts`), duplicated here
 *  in miniature rather than imported, per this package's zero-dependency
 *  precedent. */
export function firstSurnameFromFreeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.split(/[;,&]| and /i)[0]?.trim();
  if (!first) return null;
  const parts = first.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return normalizeSurname(value.includes(",") ? parts[0] : parts[parts.length - 1]);
}
