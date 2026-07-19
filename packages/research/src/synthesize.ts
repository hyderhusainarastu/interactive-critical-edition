import type { RawResource } from "./types";

/**
 * LLM-backed research steps (plan §33), decoupled from the vendor via
 * `StructuredCaller` (the worker passes an OpenAIResponsesClient). Every step
 * has a deterministic fallback so the pipeline runs with no key, and every
 * model output is validated against real data before it is trusted — a claim
 * may only cite evidence text that actually appears in an inspected source, so
 * the model can never invent a supporting quotation.
 */

export interface StructuredCaller {
  available: boolean;
  call<T>(p: {
    model: string;
    system: string;
    input: string;
    schema: Record<string, unknown>;
    schemaName: string;
    safetyIdentifier?: string;
    maxOutputTokens?: number;
    validate: (parsed: unknown) => T;
  }): Promise<{ data: T; promptTokens: number; completionTokens: number; model: string }>;
}

export interface PrimaryWork {
  title: string;
  author?: string | null;
}

// ---- Search-query generation ----

/** Deterministic query rounds from the work + its citations (no LLM needed). */
export function heuristicQueries(primary: PrimaryWork, citationTexts: string[]): string[][] {
  const round1 = [
    primary.title,
    primary.author ? `${primary.author} ${primary.title}` : "",
    `${primary.title} secondary literature`,
    `${primary.title} critical interpretation`,
  ].filter((q) => q.trim().length > 3);
  const round2 = citationTexts
    .map((c) => c.replace(/\s+/g, " ").trim().slice(0, 90))
    .filter((c) => c.length > 6)
    .slice(0, 8);
  return [round1, round2].filter((r) => r.length > 0);
}

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    rounds: {
      type: "array",
      items: { type: "array", items: { type: "string" } },
    },
  },
  required: ["rounds"],
  additionalProperties: false,
};

function normalizeQueryRounds(parsed: unknown): string[][] {
  const rounds = (parsed as { rounds?: unknown }).rounds;
  if (!Array.isArray(rounds)) throw new Error("rounds not an array");
  const clean = rounds
    .map((round) =>
      (Array.isArray(round) ? round : [])
        .filter((q): q is string => typeof q === "string")
        .map((q) => q.replace(/\s+/g, " ").trim())
        .filter((q) => q.length > 3)
        .slice(0, 12),
    )
    .filter((r) => r.length > 0)
    .slice(0, 3); // traversal depth 2 → at most a few rounds
  if (clean.length === 0) throw new Error("no usable queries");
  return clean;
}

export async function generateQueries(
  caller: StructuredCaller,
  input: { primary: PrimaryWork; citationTexts: string[]; model: string; safetyIdentifier?: string },
): Promise<{ rounds: string[][]; promptTokens: number; completionTokens: number; usedModel: boolean }> {
  const fallback = () => heuristicQueries(input.primary, input.citationTexts);
  if (!caller.available) return { rounds: fallback(), promptTokens: 0, completionTokens: 0, usedModel: false };
  try {
    const r = await caller.call({
      model: input.model,
      schemaName: "search_queries",
      schema: QUERY_SCHEMA,
      safetyIdentifier: input.safetyIdentifier,
      maxOutputTokens: 500,
      system:
        "You generate web/scholarly search queries to find sources that illuminate a scholarly work: " +
        "secondary literature, intellectual influences, disagreements, prerequisites, and interpretive aids. " +
        "Return 1-3 rounds of short queries. Use only the provided title/author/citations — invent no facts.",
      input: JSON.stringify({
        title: input.primary.title,
        author: input.primary.author ?? null,
        citations: input.citationTexts.slice(0, 20),
      }),
      validate: normalizeQueryRounds,
    });
    return { rounds: r.data, promptTokens: r.promptTokens, completionTokens: r.completionTokens, usedModel: true };
  } catch {
    return { rounds: fallback(), promptTokens: 0, completionTokens: 0, usedModel: false };
  }
}

// ---- Claim / evidence validation (anti-hallucination) ----

const normText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A claim's supporting quote must actually occur in one of the allowed evidence
 * texts (the inspected source passages). Returns true only when the quote is a
 * real substring — so a model can never fabricate a supporting quotation.
 */
export function quoteIsGrounded(quote: string, evidenceTexts: string[]): boolean {
  const q = normText(quote);
  if (q.length < 8) return false; // too short to verify meaningfully
  return evidenceTexts.some((e) => normText(e).includes(q));
}

export interface DraftClaim {
  text: string;
  claimType: "factual" | "interpretive" | "inferred";
  quote?: string | null;
}

/**
 * Enforce the evidence rule on drafted claims: a `factual` claim keeps that
 * grade only if its quote is grounded in the evidence AND the source authority
 * bar is met (checked by the caller via `authorityOk`); otherwise it is
 * demoted to `interpretive` (kept, but visibly uncertain) rather than dropped.
 */
export function gradeClaims(
  claims: DraftClaim[],
  evidenceTexts: string[],
  authorityOk: boolean,
): { text: string; claimType: DraftClaim["claimType"]; grounded: boolean }[] {
  return claims.map((c) => {
    const grounded = c.quote ? quoteIsGrounded(c.quote, evidenceTexts) : false;
    const staysFactual = c.claimType === "factual" && grounded && authorityOk;
    return {
      text: c.text,
      claimType: staysFactual ? "factual" : c.claimType === "factual" ? "interpretive" : c.claimType,
      grounded,
    };
  });
}

/** Deterministic, source-grounded note when no model is available (or as a floor). */
export function heuristicNote(resource: RawResource, relation: string): string {
  const who = resource.authors.length ? ` by ${resource.authors.slice(0, 3).join(", ")}` : "";
  const when = resource.year ? ` (${resource.year})` : "";
  return `Related work — ${relation.replace(/_/g, " ")}: "${resource.title}"${who}${when}. Surfaced via ${resource.provider}; not yet independently corroborated.`;
}
