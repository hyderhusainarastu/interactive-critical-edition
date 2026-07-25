import { describe, expect, it } from "vitest";
import { detectLegitimateForeignSpans, detectRecoveredForeignSpans } from "./foreignSpans";

const GREEK_WORD = "ἀρετή"; // areте (Greek: excellence)
const RECOVERED_LATIN = "abg";
const RECOVERED_GREEK = "αβγ"; // alpha beta gamma

/**
 * Lawful synthetic fixture generator, same construction as
 * `packages/ingestion/src/pdfGlyphRecovery.test.ts`'s (duplicated locally
 * since that helper is not exported): the PDF standard's built-in Symbol
 * font with a deliberately wrong ToUnicode map — codes whose visible Symbol
 * glyphs are alpha/beta/gamma extract as Latin "abg". No production
 * document, font program, or copyrighted text is embedded.
 */
function syntheticBrokenToUnicodePdf(): Buffer {
  const content = "BT /F1 24 Tf 72 720 Td <616267> Tj ET";
  const cmap = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /SyntheticBroken def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    "3 beginbfchar",
    "<61> <0061>",
    "<62> <0062>",
    "<67> <0067>",
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol /ToUnicode 6 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    `<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

describe("detectLegitimateForeignSpans", () => {
  it("finds a legitimate Greek span and excludes it from untranscribable detection", () => {
    const blockText = `The concept ${GREEK_WORD} appears throughout the text, translated as excellence.`;
    const { untranscribable, spans } = detectLegitimateForeignSpans("block-1", blockText);
    expect(untranscribable).toHaveLength(0);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      textBlockId: "block-1",
      sourceText: GREEK_WORD,
      originalText: GREEK_WORD,
      script: "greek",
      languageHint: "el",
      direction: "ltr",
      transcriptionStatus: "legitimate",
    });
    expect(spans[0]!.sourceProvenance).toEqual({ kind: "source_text", label: "extracted source text", confidence: 1 });
    // Anchor context is real surrounding text, not empty.
    expect(spans[0]!.prefix.endsWith("concept ")).toBe(true);
    expect(spans[0]!.suffix.startsWith(" appears")).toBe(true);
  });

  it("never offers an untranscribable garble as a translatable foreign span", () => {
    // Signal-4 garbled_encoding fixture from packages/ingestion/src/untranscribable.ts's
    // own header comment: a corrupted CMap dumping polytonic Greek as Latin
    // mojibake in the SAME font as the surrounding English.
    const blockText = "The word (?ia(j)?QOvxai) appears in the source.";
    const { untranscribable, spans } = detectLegitimateForeignSpans("block-1", blockText);
    expect(untranscribable.length).toBeGreaterThan(0);
    expect(spans).toHaveLength(0);
  });

  it("returns no spans for plain English text", () => {
    const { untranscribable, spans } = detectLegitimateForeignSpans("block-1", "Nothing foreign here at all.");
    expect(untranscribable).toHaveLength(0);
    expect(spans).toHaveLength(0);
  });
});

describe("detectRecoveredForeignSpans", () => {
  it("recovers a unique PDF glyph-mapping match overlapping an untranscribable span", async () => {
    const buffer = syntheticBrokenToUnicodePdf();
    // The synthetic PDF's own extracted text is "abg" (see pdfGlyphRecovery's
    // own investigation fixture) — construct a block whose stored text
    // contains that exact garbled substring, flagged untranscribable so the
    // recovery seam has something to anchor to. Offsets are derived from
    // `indexOf`, never hand-counted, to avoid an off-by-one fixture bug.
    const blockText = `Fragment ${RECOVERED_LATIN} follows here.`;
    const matchStart = blockText.indexOf(RECOVERED_LATIN);
    const matchEnd = matchStart + RECOVERED_LATIN.length;
    const untranscribable = [{ start: matchStart, end: matchEnd, reason: "private_use" as const }];
    const recovered = await detectRecoveredForeignSpans(buffer, [
      { textBlockId: "block-1", blockText, untranscribable },
    ]);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      textBlockId: "block-1",
      sourceText: RECOVERED_LATIN,
      originalText: RECOVERED_GREEK,
      startOffset: matchStart,
      endOffset: matchEnd,
      transcriptionStatus: "recovered",
    });
    expect(recovered[0]!.prefix.endsWith("Fragment ")).toBe(true);
    expect(recovered[0]!.suffix.startsWith(" follows here.")).toBe(true);
    expect(recovered[0]!.sourceProvenance.kind).toBe("pdf_glyph_recovery");
    expect(recovered[0]!.sourceProvenance.confidence).toBe(0.85);
  });

  it("skips entirely when no block has any untranscribable span", async () => {
    const buffer = syntheticBrokenToUnicodePdf();
    const recovered = await detectRecoveredForeignSpans(buffer, [
      {
        textBlockId: "block-1",
        blockText: `Fragment ${RECOVERED_LATIN} appears here too but nothing flagged it.`,
        untranscribable: [],
      },
    ]);
    expect(recovered).toHaveLength(0);
  });

  it("skips an ambiguous match (more than one candidate occurrence)", async () => {
    const buffer = syntheticBrokenToUnicodePdf();
    const blockText = `First ${RECOVERED_LATIN} then later another ${RECOVERED_LATIN} occurrence.`;
    const firstStart = blockText.indexOf(RECOVERED_LATIN);
    const secondStart = blockText.indexOf(RECOVERED_LATIN, firstStart + 1);
    expect(secondStart).toBeGreaterThan(firstStart); // sanity: fixture really has two occurrences
    const untranscribable = [
      { start: firstStart, end: firstStart + RECOVERED_LATIN.length, reason: "private_use" as const },
      { start: secondStart, end: secondStart + RECOVERED_LATIN.length, reason: "private_use" as const },
    ];
    const recovered = await detectRecoveredForeignSpans(buffer, [
      { textBlockId: "block-1", blockText, untranscribable },
    ]);
    expect(recovered).toHaveLength(0);
  });

  it("never throws on an unparseable PDF buffer — returns empty instead", async () => {
    const recovered = await detectRecoveredForeignSpans(Buffer.from("not a pdf"), [
      {
        textBlockId: "block-1",
        blockText: RECOVERED_LATIN,
        untranscribable: [{ start: 0, end: RECOVERED_LATIN.length, reason: "private_use" as const }],
      },
    ]);
    expect(recovered).toEqual([]);
  });
});
