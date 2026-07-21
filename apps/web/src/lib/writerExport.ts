import { proseMirrorToPlainText, sortMlaCitations, mlaWorksCited, type CslJson } from "./writer";

const encoder = new TextEncoder();

export function exportPlainText(content: unknown, citations: CslJson[]): string {
  const bibliography = sortMlaCitations(citations).map(mlaWorksCited);
  return [proseMirrorToPlainText(content), bibliography.length ? `Works Cited\n\n${bibliography.join("\n\n")}` : ""].filter(Boolean).join("\n\n");
}

function pdfEscape(value: string): string {
  return value.replace(/([\\()])/g, "\\$1").replace(/[^\x20-\x7e]/g, "?");
}

/** A deliberately small, valid PDF writer for textual MLA exports. */
export function createWriterPdf(title: string, content: unknown, citations: CslJson[]): Uint8Array {
  const lines = [title, "", ...exportPlainText(content, citations).split("\n")]
    .flatMap((line) => line.match(/.{1,90}(?:\s|$)|.{1,90}/g) ?? [""])
    .slice(0, 300);
  const stream = ["BT", "/F1 12 Tf", "72 760 Td", "14 TL", ...lines.flatMap((line, index) => [index ? "T*" : "", `(${pdfEscape(line)}) Tj`]).filter(Boolean), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder.encode(output).length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = encoder.encode(output).length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encoder.encode(output);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number) { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff); }
function u32(value: number) { return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff); }
function join(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Uncompressed ZIP is enough for a portable, standards-compliant DOCX. */
function storedZip(entries: Array<{ name: string; body: string }>): Uint8Array {
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name); const data = encoder.encode(entry.body); const crc = crc32(data);
    const header = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name]);
    local.push(header, data);
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + data.length;
  }
  const centralBytes = join(central);
  return join([...local, centralBytes, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBytes.length), u32(offset), u16(0)]);
}

function xml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

export function createWriterDocx(title: string, content: unknown, citations: CslJson[]): Uint8Array {
  const paragraphs = [title, "", ...exportPlainText(content, citations).split("\n")].map((line) => `<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join("");
  return storedZip([
    { name: "[Content_Types].xml", body: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: "_rels/.rels", body: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", body: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>` },
    { name: "word/styles.xml", body: `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults/></w:styles>` },
  ]);
}
