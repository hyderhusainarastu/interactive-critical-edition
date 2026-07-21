import { createHash } from "node:crypto";

/**
 * Evidence needed before Palimnote ever downloads third-party source text.
 * A provider's `is_oa` flag or an unauthenticated URL is useful discovery
 * metadata, but it is not a license. This intentionally requires a named
 * license in the provider record and records the exact fields used.
 */
export interface OpenAccessEvidence {
  license: string;
  sourceUrl: string;
  evidence: Record<string, unknown>;
}

export type OpenAccessTextResult =
  | { status: "open_access_indexed"; text: string; contentHash: string; retrievedAt: Date }
  | { status: "open_access_available"; error?: string }
  | { status: "retrieval_failed"; error: string };

const APPROVED_LICENSE = /^(cc0(?:\s|[-_/]|$)|cc[\s_-]*by(?:\s|[-_/]|$)|public\s*domain|odc[-\s]?by|open\s*government\s*licen[cs]e)/i;
const MAX_SOURCE_TEXT_BYTES = 1_500_000;
const MAX_SOURCE_TEXT_CHARS = 500_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Derive eligibility only from provider metadata. The explicit OpenAlex path
 * is intentionally small and auditable; the generic `license` path supports
 * another adapter only when it preserves the provider's actual field.
 */
export function findOpenAccessEvidence(raw: unknown, fallbackUrl: string | null): OpenAccessEvidence | null {
  const record = asRecord(raw);
  if (!record) return null;
  const bestLocation = asRecord(record.best_oa_location) ?? asRecord(record.primary_location);
  const license = nonEmptyString(bestLocation?.license) ?? nonEmptyString(record.license);
  const sourceUrl =
    nonEmptyString(bestLocation?.landing_page_url) ??
    nonEmptyString(bestLocation?.pdf_url) ??
    nonEmptyString(record.fulltext_url) ??
    fallbackUrl;
  if (!license || !sourceUrl || !APPROVED_LICENSE.test(license)) return null;

  return {
    license,
    sourceUrl,
    evidence: {
      providerLicense: license,
      providerOpenAccess: asRecord(record.open_access) ?? null,
      location: bestLocation ?? null,
    },
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A bounded, no-model downloader for already-license-evidenced HTML/plain
 * text. PDFs and other binary endpoints are retained as visibly open source
 * records instead of guessed at or copied without a structure-aware parser.
 */
export async function retrieveOpenAccessText(
  evidence: OpenAccessEvidence,
  fetcher: typeof fetch = fetch,
): Promise<OpenAccessTextResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetcher(evidence.sourceUrl, {
      headers: { Accept: "text/html, text/plain;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return { status: "retrieval_failed", error: `Source returned HTTP ${response.status}.` };
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_SOURCE_TEXT_BYTES || (!contentType.includes("text/html") && !contentType.includes("text/plain"))) {
      return { status: "open_access_available", error: "Open source is available, but this endpoint is not bounded HTML or plain text." };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_TEXT_BYTES) {
      return { status: "open_access_available", error: "Open source exceeds the automatic retrieval size limit." };
    }
    const decoded = new TextDecoder().decode(bytes);
    const text = (contentType.includes("text/html") ? htmlToText(decoded) : decoded.replace(/\s+/g, " ").trim()).slice(0, MAX_SOURCE_TEXT_CHARS);
    if (text.length < 80) return { status: "open_access_available", error: "Open source did not yield enough readable text to index." };
    return {
      status: "open_access_indexed",
      text,
      contentHash: createHash("sha256").update(text).digest("hex"),
      retrievedAt: new Date(),
    };
  } catch (error) {
    return { status: "retrieval_failed", error: error instanceof Error ? error.message : "Source retrieval failed." };
  }
}
