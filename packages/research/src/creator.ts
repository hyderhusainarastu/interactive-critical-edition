import type { RawResource } from "./types";
import { canonicalizeUrl } from "./normalize";

/**
 * Creator identity (plan §34.2, Phase 9.2).
 *
 * Phase 8 scored a source by what it *is* (a DOI, a catalogue, a domain). That
 * is not enough for a learning workspace, where an expert's recorded lecture
 * can be more use than a weak peer-reviewed paper — but only if we can say WHO
 * made it, and on what evidence. This module answers that question from
 * provider metadata alone.
 *
 * Two rules hold throughout, and both are tested:
 *  - A creator is never asserted by an LLM. Everything here is derived from
 *    fields a provider actually returned, exactly like bibliographic facts.
 *  - Unknown is a real answer. An unidentifiable creator is recorded as
 *    anonymous/unknown rather than guessed, because "we could not tell" and
 *    "nobody credible" must stay distinguishable downstream.
 */

export type CreatorKind = "person" | "organization" | "channel" | "anonymous" | "unknown";

/**
 * How well the creator's identity is corroborated — deliberately NOT a score.
 *   scholarly_record — named, and the same name authors records in a scholarly
 *                      index (the strongest evidence available without a login)
 *   institutional    — published under a university/press/museum host
 *   named            — a real name or channel is given, with nothing confirming it
 *   pseudonymous     — a handle only (social accounts, forum names)
 *   anonymous        — no creator information at all
 */
export type CreatorVerification =
  | "scholarly_record"
  | "institutional"
  | "named"
  | "pseudonymous"
  | "anonymous";

export interface CreatorIdentity {
  kind: CreatorKind;
  /** Human-readable name, when one was actually supplied. */
  displayName: string | null;
  /** Platform handle/channel, when that is all we have. */
  handle: string | null;
  /** Host the material was published on, normalized. */
  host: string | null;
  verification: CreatorVerification;
  /** Why we believe this — a wrong attribution must be explainable. */
  evidence: string[];
}

const INSTITUTIONAL_TLD = /\.(edu|gov|mil|ac\.[a-z]{2}|edu\.[a-z]{2}|gov\.[a-z]{2})$/i;
const INSTITUTIONAL_HOST =
  /(^|\.)(stanford|harvard|mit|yale|princeton|berkeley|ox\.ac|cam\.ac|jstor|plato\.stanford|nature|science|springer|wiley|cambridge|oup|oxfordre|tandfonline|sciencedirect|arxiv|philpapers|britannica|loc|bl\.uk|europeana)\./i;

/** Organisation-shaped names: a person is not "University of X" or "X Press". */
const ORGANIZATION_NAME =
  /\b(university|universit(y|é|ät|à)|college|institute|instituto|school|academy|press|publishers?|society|association|museum|library|foundation|department|faculty|centre|center|channel|studios?|media|network)\b/i;

function hostOf(url: string | null): string | null {
  const canonical = canonicalizeUrl(url);
  if (!canonical) return null;
  const host = canonical.split("/")[0];
  return host || null;
}

function isInstitutionalHost(host: string | null): boolean {
  if (!host) return false;
  return INSTITUTIONAL_TLD.test(host) || INSTITUTIONAL_HOST.test(host);
}

/** A handle, not a name: `@someone`, `u/someone`, `someone.bsky.social`. */
function looksLikeHandle(value: string): boolean {
  if (/^@/.test(value) || /^u\//.test(value)) return true;
  // A single token carrying handle punctuation (`someone.bsky.social`,
  // `some_user`). A one-word real name — "Aristotle" — has neither, so it is
  // still treated as a name.
  return !/\s/.test(value) && /[._]/.test(value);
}

/**
 * Read the creator off a normalized resource. Deterministic and offline: the
 * same resource always yields the same identity.
 */
export function identifyCreator(r: RawResource): CreatorIdentity {
  const host = hostOf(r.url);
  const evidence: string[] = [];
  const primary = r.authors.map((a) => a.trim()).filter(Boolean)[0] ?? null;

  if (!primary) {
    // No named creator. An institutional host still tells us something real —
    // a university page with no byline is not the same as an anonymous post.
    if (isInstitutionalHost(host)) {
      evidence.push(`no byline; published on institutional host ${host}`);
      return { kind: "organization", displayName: null, handle: null, host, verification: "institutional", evidence };
    }
    evidence.push(r.provider === "mastodon" || r.provider === "bluesky"
      ? "social post with no attributable author"
      : "no author metadata supplied by the provider");
    return { kind: "anonymous", displayName: null, handle: null, host, verification: "anonymous", evidence };
  }

  if (looksLikeHandle(primary)) {
    evidence.push(`creator given as the handle "${primary}", not a name`);
    return { kind: "channel", displayName: null, handle: primary, host, verification: "pseudonymous", evidence };
  }

  const kind: CreatorKind = ORGANIZATION_NAME.test(primary) ? "organization" : "person";
  evidence.push(`creator "${primary}" from ${r.provider} metadata`);
  if (isInstitutionalHost(host)) {
    evidence.push(`published on institutional host ${host}`);
    return { kind, displayName: primary, handle: null, host, verification: "institutional", evidence };
  }
  return { kind, displayName: primary, handle: null, host, verification: "named", evidence };
}

/**
 * Corroboration a caller can supply after the fact — typically "this same name
 * authors N records in a scholarly index". Kept separate from
 * `identifyCreator` so the expensive lookup is optional and the cheap
 * derivation stays pure.
 *
 * Corroboration only ever *raises* verification, and only on evidence: a
 * scholarly record beats an institutional host, which beats a bare name. It
 * never invents a name for an anonymous source — a run of matches against
 * nobody is still nobody.
 */
export function corroborateCreator(
  identity: CreatorIdentity,
  corroboration: { scholarlyRecordMatches?: number; institutionalAffiliation?: string | null },
): CreatorIdentity {
  const matches = corroboration.scholarlyRecordMatches ?? 0;
  const affiliation = corroboration.institutionalAffiliation?.trim() || null;
  if (!identity.displayName) return identity;

  const evidence = [...identity.evidence];
  let verification = identity.verification;

  if (matches > 0) {
    evidence.push(`authors ${matches} record(s) in a scholarly index under the same name`);
    verification = "scholarly_record";
  } else if (affiliation && verification === "named") {
    evidence.push(`affiliation reported as ${affiliation}`);
    verification = "institutional";
  }
  return { ...identity, verification, evidence };
}
