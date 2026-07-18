export interface DetectedFootnote {
  marker: string;
  content: string;
}

const NOTE_LINE = /^\s*\[?(\d{1,3})\]?[.)]\s+(.+)$/;

/**
 * Heuristic footnote detection for plain text/markdown: looks for a
 * trailing block of consecutive numbered lines (a "Notes" section) and
 * only keeps entries whose number also appears as an in-body [N] or (N)
 * marker earlier in the text — this filters out unrelated numbered
 * lists (e.g. a table of contents) that happen to sit near the end.
 *
 * Documented limitation (see schema.ts): this is pattern matching, not
 * layout-aware extraction. It won't catch footnotes in every citation
 * style, and PDFs aren't attempted at all here (see parsers/pdf.ts).
 */
export function detectFootnotes(text: string): DetectedFootnote[] {
  const lines = text.split("\n");

  // Find the longest trailing run of consecutive numbered lines.
  let blockStart = -1;
  let run: { start: number; end: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (NOTE_LINE.test(lines[i].trim())) {
      if (blockStart === -1) blockStart = i;
      run = { start: blockStart, end: i };
    } else if (lines[i].trim() === "") {
      // blank lines don't break a run
      continue;
    } else {
      blockStart = -1;
    }
  }

  if (!run || run.end - run.start < 1) return [];

  const bodyText = lines.slice(0, run.start).join("\n");
  const candidates: DetectedFootnote[] = [];

  for (let i = run.start; i <= run.end; i++) {
    const match = lines[i].trim().match(NOTE_LINE);
    if (!match) continue;
    const [, number, content] = match;
    const inBodyMarker = new RegExp(`[[(]${number}[\\])]`).test(bodyText);
    if (inBodyMarker) {
      candidates.push({ marker: number, content: content.trim() });
    }
  }

  return candidates;
}
