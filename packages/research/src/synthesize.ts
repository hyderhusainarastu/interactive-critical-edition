import type { LaneRound } from "./discover";
import { QUERY_LANES, type QueryLane } from "./relevance";
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

/**
 * Deterministic per-lane query rounds. Lanes are emitted in priority order:
 * explicit citations first (the strongest claim a source can have on a work),
 * then scholarly context, then public/media lanes. Discovery consumes them in
 * that order, so the earliest lane to surface a resource is the most specific
 * explanation of why it belongs.
 *
 * Lanes with nothing useful to ask are omitted rather than padded with a vague
 * query — an empty lane costs nothing, a bad query costs budget and precision.
 */
export function heuristicLaneQueries(
  primary: PrimaryWork,
  citationTexts: string[],
  concepts: string[] = [],
): LaneRound[] {
  const title = primary.title.trim();
  const author = primary.author?.trim() || "";
  const byAuthor = author ? `${author} ${title}` : title;
  const topic = [title, ...concepts.slice(0, 3)].filter(Boolean).join(" ");

  const rounds: LaneRound[] = [];
  const add = (lane: LaneRound["lane"], queries: (string | false)[]) => {
    const clean = [...new Set(queries.filter((q): q is string => Boolean(q && q.trim().length > 3)))];
    if (clean.length) rounds.push({ lane, queries: clean.slice(0, 12) });
  };

  add("explicit_citation", citationTexts.map((c) => c.replace(/\s+/g, " ").trim().slice(0, 90)).filter((c) => c.length > 6).slice(0, 10));
  add("scholarly_debate", [title, byAuthor, `${title} criticism`, `${title} secondary literature`, `${title} interpretation`]);
  add("author_corpus", [author && `${author} works`, author && `${author} bibliography`]);
  add("reception_citation", [`works citing ${byAuthor}`, `${title} reception`, `${title} response to`]);
  add("concept_doctrine", concepts.slice(0, 6).map((c) => `${c} ${title}`));
  add("historical_background", [`${title} historical context`, author && `${author} intellectual background`]);
  add("primary_prerequisite", [`${topic} primary sources`, `${topic} prerequisite reading`]);
  add("parallel_literature", [`${title} compared with`, `${topic} parallel debate`]);
  add("lecture_course", [`${topic} university lecture`, `${topic} course syllabus`]);
  add("video_podcast", [`${topic} lecture`, `${topic} podcast`]);
  add("blog_newsletter", [`${topic} essay`, `${topic} commentary`]);
  add("public_discussion", [`${topic} discussion`]);

  return rounds;
}

const LANE_QUERY_SCHEMA = {
  type: "object",
  properties: {
    lanes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lane: { type: "string", enum: [...QUERY_LANES] },
          queries: { type: "array", items: { type: "string" } },
        },
        required: ["lane", "queries"],
        additionalProperties: false,
      },
    },
  },
  required: ["lanes"],
  additionalProperties: false,
};

function normalizeLaneRounds(parsed: unknown): LaneRound[] {
  const lanes = (parsed as { lanes?: unknown }).lanes;
  if (!Array.isArray(lanes)) throw new Error("lanes not an array");
  const valid = new Set<string>(QUERY_LANES);
  const seen = new Set<string>();
  const clean: LaneRound[] = [];
  for (const entry of lanes) {
    const lane = (entry as { lane?: unknown }).lane;
    // Enum-constrained output still gets validated: an unrecognised lane is
    // dropped rather than coerced, so a model can never invent a routing path.
    if (typeof lane !== "string" || !valid.has(lane) || seen.has(lane)) continue;
    const queries = (entry as { queries?: unknown }).queries;
    const qs = (Array.isArray(queries) ? queries : [])
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.replace(/\s+/g, " ").trim())
      .filter((q) => q.length > 3)
      .slice(0, 12);
    if (!qs.length) continue;
    seen.add(lane);
    clean.push({ lane: lane as LaneRound["lane"], queries: qs });
  }
  if (!clean.length) throw new Error("no usable lane queries");
  return clean;
}

/**
 * Lane-aware query generation. Falls back to the deterministic lane queries on
 * any failure, so losing the model degrades coverage, never correctness.
 */
export async function generateLaneQueries(
  caller: StructuredCaller,
  input: {
    primary: PrimaryWork;
    citationTexts: string[];
    concepts?: string[];
    model: string;
    safetyIdentifier?: string;
  },
): Promise<{ lanes: LaneRound[]; promptTokens: number; completionTokens: number; usedModel: boolean }> {
  const fallback = () => heuristicLaneQueries(input.primary, input.citationTexts, input.concepts ?? []);
  if (!caller.available) return { lanes: fallback(), promptTokens: 0, completionTokens: 0, usedModel: false };
  try {
    const r = await caller.call({
      model: input.model,
      schemaName: "lane_search_queries",
      schema: LANE_QUERY_SCHEMA,
      safetyIdentifier: input.safetyIdentifier,
      maxOutputTokens: 900,
      system:
        "You generate search queries for a scholarly research pipeline, grouped by LANE. " +
        "Each lane answers a different question about the work: which sources it cites, what it " +
        "presupposes, its historical background, its concepts, the scholarly debate around it, its " +
        "author's other work, its reception, parallel literature, and lawful public teaching material " +
        "(lectures, videos/podcasts, blogs, public discussion). " +
        "Emit only lanes you can write a genuinely useful query for — omit the rest rather than padding. " +
        "Use only the provided title/author/citations/concepts. Invent no facts, titles, or authors.",
      input: JSON.stringify({
        title: input.primary.title,
        author: input.primary.author ?? null,
        concepts: (input.concepts ?? []).slice(0, 12),
        citations: input.citationTexts.slice(0, 20),
      }),
      validate: normalizeLaneRounds,
    });
    // The model SUPPLEMENTS the deterministic lanes; it must never displace
    // the explicit-citation lane, whose queries are the document's own
    // reference entries. An earlier version dropped the heuristic lane whenever
    // the model emitted a lane of the same name, which silently discarded every
    // real citation query and left explicit-citation recall at zero in
    // production — the code and its comment disagreed, and the comment lost.
    const heuristic = fallback();
    const byLane = new Map<QueryLane, string[]>();
    for (const l of heuristic) byLane.set(l.lane, [...l.queries]);
    for (const l of r.data) {
      const existing = byLane.get(l.lane);
      // Document-derived queries come first and are always kept; model queries
      // extend them rather than replacing them.
      byLane.set(l.lane, existing ? [...new Set([...existing, ...l.queries])].slice(0, 16) : l.queries);
    }
    const merged: LaneRound[] = [...byLane.entries()].map(([lane, queries]) => ({ lane, queries }));
    return { lanes: merged, promptTokens: r.promptTokens, completionTokens: r.completionTokens, usedModel: true };
  } catch {
    return { lanes: fallback(), promptTokens: 0, completionTokens: 0, usedModel: false };
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

// ---- Critical-note synthesis (research model) ----

const NOTE_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          claimType: { type: "string", enum: ["factual", "interpretive", "inferred"] },
          quote: { type: "string" },
        },
        required: ["text", "claimType", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: ["body", "claims"],
  additionalProperties: false,
};

function normalizeNote(parsed: unknown): { body: string; claims: DraftClaim[] } {
  const p = parsed as { body?: unknown; claims?: unknown };
  if (typeof p.body !== "string" || p.body.trim().length < 8) throw new Error("empty note body");
  const claims = (Array.isArray(p.claims) ? p.claims : [])
    .map((c) => c as Record<string, unknown>)
    .filter((c) => typeof c.text === "string")
    .map((c) => ({
      text: String(c.text),
      claimType: (["factual", "interpretive", "inferred"].includes(String(c.claimType)) ? c.claimType : "interpretive") as DraftClaim["claimType"],
      quote: typeof c.quote === "string" ? c.quote : null,
    }));
  return { body: p.body.trim(), claims };
}

export interface SynthesizedNote {
  body: string;
  claims: { text: string; claimType: DraftClaim["claimType"]; grounded: boolean }[];
  promptTokens: number;
  completionTokens: number;
  usedModel: boolean;
}

/**
 * Synthesize a short critical note explaining how a source bears on the work.
 * Every returned claim is graded against the evidence (`gradeClaims`): a factual
 * claim survives only if its quote is grounded AND the authority bar is met, so
 * the model can neither invent a quotation nor over-assert. Falls back to the
 * deterministic grounded note when no model is available or on any bad output.
 */
export async function synthesizeNote(
  caller: StructuredCaller,
  input: {
    primary: PrimaryWork;
    resource: RawResource;
    relation: string;
    evidenceTexts: string[];
    authorityOk: boolean;
    model: string;
    safetyIdentifier?: string;
  },
): Promise<SynthesizedNote> {
  const fallback = (): SynthesizedNote => ({
    body: heuristicNote(input.resource, input.relation),
    claims: [],
    promptTokens: 0,
    completionTokens: 0,
    usedModel: false,
  });
  if (!caller.available) return fallback();
  try {
    const r = await caller.call({
      model: input.model,
      schemaName: "critical_note",
      schema: NOTE_SCHEMA,
      safetyIdentifier: input.safetyIdentifier,
      maxOutputTokens: 700,
      system:
        "You write a short, sober scholarly note explaining how a RELATED source bears on a primary work " +
        "(its relationship category is given). Ground every factual claim in a verbatim quote drawn from the " +
        "provided evidence array. Never invent titles, authors, quotations, dates, identifiers, or facts. If a " +
        "point cannot be grounded in the evidence, mark its claim 'interpretive' or 'inferred'. Keep it concise.",
      input: JSON.stringify({
        primary_work: { title: input.primary.title, author: input.primary.author ?? null },
        relationship: input.relation,
        source: {
          title: input.resource.title,
          authors: input.resource.authors,
          year: input.resource.year,
          snippet: input.resource.snippet,
        },
        evidence: input.evidenceTexts,
      }),
      validate: normalizeNote,
    });
    const graded = gradeClaims(r.data.claims, input.evidenceTexts, input.authorityOk);
    return { body: r.data.body, claims: graded, promptTokens: r.promptTokens, completionTokens: r.completionTokens, usedModel: true };
  } catch {
    return fallback();
  }
}

/** Deterministic, source-grounded note when no model is available (or as a floor). */
export function heuristicNote(resource: RawResource, relation: string): string {
  const who = resource.authors.length ? ` by ${resource.authors.slice(0, 3).join(", ")}` : "";
  const when = resource.year ? ` (${resource.year})` : "";
  return `Related work — ${relation.replace(/_/g, " ")}: "${resource.title}"${who}${when}. Surfaced via ${resource.provider}; not yet independently corroborated.`;
}
