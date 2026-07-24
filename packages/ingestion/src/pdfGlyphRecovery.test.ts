import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { inspectPdfGlyphRecoveryCandidates } from "./pdfGlyphRecovery";

/**
 * Lawful synthetic fixture generator. It uses the PDF standard's built-in
 * Symbol font and deliberately supplies a wrong ToUnicode map: codes whose
 * visible Symbol glyphs are alpha/beta/gamma extract as Latin a/b/g. No
 * production document, font program, or copyrighted text is embedded.
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

describe("PDF glyph recovery investigation", () => {
  it("exposes a constrained display-glyph candidate when ToUnicode is broken", async () => {
    const fixture = syntheticBrokenToUnicodePdf();
    const pdf = await getDocumentProxy(new Uint8Array(fixture));
    const extracted = await extractText(pdf, { mergePages: true });
    expect(extracted.text.replaceAll(/\s+/g, "")).toBe("abg");

    const candidates = await inspectPdfGlyphRecoveryCandidates(fixture);
    expect(candidates).toEqual([expect.objectContaining({
      pageIndex: 0,
      extractedText: "abg",
      recoveredText: "αβγ",
      script: "greek",
      provenance: expect.objectContaining({
        kind: "pdf_glyph_recovery",
        method: "pdfjs_operator_font_char",
        automatic: false,
      }),
    })]);
  });
});
