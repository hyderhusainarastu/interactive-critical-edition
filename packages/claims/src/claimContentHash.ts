import { createHash } from "node:crypto";

/**
 * `research_claim.content_hash` — one claim's own content-addressed identity
 * (schema `research_claim`: "sha256 of the normalized claim_text — the
 * dedup/idempotency key alongside `prompt_version`"). Normalization is
 * deliberately lossy (case-folded, whitespace-collapsed, trimmed) so a
 * purely cosmetic difference in how the same claim was worded does not mint
 * a second claim identity, while any real wording change legitimately does.
 *
 * Lives here, in the dependency-free package both apps already depend on,
 * because BOTH sides of the claim lifecycle must compute this key
 * identically or the `research_claim_*_dedup_unique` indexes stop deduping:
 * the worker's extraction pipeline writes it on insert, and the web
 * correction workflow rewrites it whenever a user edits a claim's text. It
 * was previously duplicated across that app boundary and kept in lockstep
 * by hand; a single shared definition is what actually guarantees the
 * lockstep.
 */
export function normalizeClaimText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function claimContentHash(text: string): string {
  return createHash("sha256").update(normalizeClaimText(text)).digest("hex");
}
