/**
 * Postgres (via node-postgres) and pg-boss's JSON job payloads cannot carry
 * a lone (unpaired) UTF-16 surrogate or a NUL byte — extraction from a
 * damaged/OCR'd source occasionally produces one, and it throws
 * "unsupported Unicode escape sequence" deep in pg-pool, crashing the whole
 * worker process rather than just failing one job (see
 * docs/incidents/render-server-failures-phase-19.md). Replace both with the
 * Unicode replacement character at the ingestion boundary, before any
 * extracted string reaches the database or a queue payload.
 */
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NUL_BYTE = new RegExp(String.fromCharCode(0), "g");

export function sanitizeExtractedText(text: string): string {
  return text.replace(UNPAIRED_SURROGATE, "�").replace(NUL_BYTE, "");
}
