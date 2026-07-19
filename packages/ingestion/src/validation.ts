const ZIP_LOCAL_FILE = Buffer.from("PK\x03\x04");
const EPUB_MIMETYPE = Buffer.from("mimetypeapplication/epub+zip");
const EPUB_CONTAINER = Buffer.from("META-INF/container.xml");
const MAX_EPUB_ENTRIES = 10_000;
export interface ValidationResult { valid: boolean; error?: string; }

/** Format and archive validation; this explicitly is not a malware claim. */
export function validateUploadContent(buffer: Buffer, mimeType: string): ValidationResult {
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-" ? { valid: true } : { valid: false, error: "File content doesn't match its declared PDF type." };
  if (mimeType === "application/epub+zip") {
    if (!buffer.subarray(0, 4).equals(ZIP_LOCAL_FILE)) return { valid: false, error: "An EPUB must be a ZIP-based EPUB archive." };
    if (!buffer.includes(EPUB_MIMETYPE) || !buffer.includes(EPUB_CONTAINER)) return { valid: false, error: "The EPUB manifest is missing or invalid." };
    let entries = 0;
    for (let index = 0; index < buffer.length - 3; index++) if (buffer[index] === 0x50 && buffer[index + 1] === 0x4b && buffer[index + 2] === 0x01 && buffer[index + 3] === 0x02) entries++;
    return entries <= MAX_EPUB_ENTRIES ? { valid: true } : { valid: false, error: "The EPUB has too many archive entries." };
  }
  return buffer.subarray(0, 8000).includes(0) ? { valid: false, error: "Text uploads cannot contain binary data." } : { valid: true };
}

/** Optional private ClamAV-compatible adapter. Without CLAMAV_SCAN_URL it is
 * intentionally skipped; validation remains active and never calls this a scan. */
export async function scanWithOptionalClamAv(buffer: Buffer): Promise<ValidationResult> {
  const endpoint = process.env.CLAMAV_SCAN_URL;
  if (!endpoint) return { valid: true };
  try {
    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const response = await fetch(endpoint, { method: "POST", body });
    if (!response.ok) return { valid: false, error: "The configured malware scan did not complete." };
    return (await response.json() as { clean?: boolean }).clean ? { valid: true } : { valid: false, error: "File failed the configured malware scan." };
  } catch { return { valid: false, error: "The configured malware scan did not complete." }; }
}
