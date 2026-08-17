import { OpenAIResponsesClient, estimateCostUsd, safetyIdentifierFor } from "@ice/ai-adapters";
import {
  RESEARCH_MODE_SYSTEM_PROMPT,
  SOCRATIC_SYSTEM_PROMPT,
  buildResearchModeInput,
  buildSocraticInput,
  createDbResearchModeRepository,
  fallbackCounterOrSupportAnswer,
  fallbackDebateMapAnswer,
  fallbackDisagreementAnswer,
  fallbackSocraticAnswer,
  noEvidenceResearchModeAnswer,
  researchModeAnswerSchema,
  retrieveCounterarguments,
  retrieveDebateMap,
  retrieveDisagreement,
  retrieveSupport,
  validateResearchModeAnswer,
  RAG_RESPONSE_HARD_CAP_USD,
  RAG_RESPONSE_LATENCY_CAP_MS,
  type DebateMapResult,
  type DisagreementRetrievalResult,
  type ExplicitResearchMode,
  type ModeRetrievalResult,
  type ResearchModeAnswer,
  type ResearchModeClaim,
  type RetrievedRagChunk,
  validateSocraticAnswer,
} from "@ice/rag";
import { reportEvent } from "@ice/observability";
import { RAG_DAILY_SOFT_CAP_USD, currentRagSpend } from "@/lib/rag/ragConversations";

function explicitlyEnabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function answerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answer", "citedChunkIds", "notFound"],
    properties: {
      answer: { type: "string", minLength: 1, maxLength: 2400 },
      citedChunkIds: { type: "array", items: { type: "string" }, maxItems: 6 },
      notFound: { type: "boolean" },
    },
  } as const;
}

function withRagLatencyCap<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Socratic provider latency cap reached")), RAG_RESPONSE_LATENCY_CAP_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function generateSocraticAnswer(userId: string, conversationId: string, question: string, history: Array<{ role: "user" | "assistant"; content: string }>, chunks: RetrievedRagChunk[]) {
  const fallback = fallbackSocraticAnswer(question, chunks);
  if (!chunks.length) return { answer: fallback, provider: "deterministic-retrieval", model: "not-found", promptTokens: 0, completionTokens: 0, cost: 0 };

  const client = new OpenAIResponsesClient();
  const model = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const projected = estimateCostUsd(model, 6_000, 700);
  if (!explicitlyEnabled("PHASE_18_RAG_PROVIDER_ENABLED") || !client.available || projected > RAG_RESPONSE_HARD_CAP_USD || await currentRagSpend(userId) + projected > RAG_DAILY_SOFT_CAP_USD) {
    return { answer: fallback, provider: "deterministic-retrieval", model: "lexical-socratic-fallback", promptTokens: 0, completionTokens: 0, cost: 0 };
  }

  try {
    // Phase 29.3 (label-then-validate hardening): the prompt exposes each
    // chunk only as a short "SOURCE_N" label (never the real chunk UUID —
    // see `buildSocraticInput`'s doc comment), and `validateSocraticAnswer`
    // resolves the model's cited labels back through `labelToChunkId`,
    // dropping (and counting) any that don't resolve.
    const { prompt, labelToChunkId } = buildSocraticInput({ question, history, chunks });
    const result = await withRagLatencyCap(client.call({
      model,
      system: SOCRATIC_SYSTEM_PROMPT,
      input: prompt,
      schema: answerSchema(),
      schemaName: "library_grounded_socratic_answer",
      safetyIdentifier: safetyIdentifierFor(userId),
      maxOutputTokens: 700,
      validate: (parsed) => validateSocraticAnswer(parsed, labelToChunkId),
    }));
    // Content-free observability for the trust-calibration posture: how
    // often the model cites a label that doesn't resolve to a real chunk.
    // No source text, question text, or answer text is logged — counts and
    // ids only, matching this codebase's other `reportEvent` call sites.
    if (result.data.droppedCitationCount > 0) {
      reportEvent("rag.citation_labels_dropped", {
        conversationId,
        droppedCitationCount: result.data.droppedCitationCount,
        acceptedCitationCount: result.data.citedChunkIds.length,
        retrievedChunkCount: chunks.length,
      });
    }
    return {
      answer: result.data,
      provider: "openai",
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cost: estimateCostUsd(result.model, result.promptTokens, result.completionTokens),
    };
  } catch {
    // A provider error never turns into an unsupported answer. The cited,
    // deterministic Socratic fallback is still useful and has zero spend.
    return { answer: fallback, provider: "deterministic-retrieval", model: "lexical-socratic-fallback", promptTokens: 0, completionTokens: 0, cost: 0 };
  }
}

const NO_SCOPE_TEXT: Record<ExplicitResearchMode, string> = {
  find_counterarguments: "Open this from a specific work or claim to find counterarguments for it.",
  find_support: "Open this from a specific work or claim to find support for it.",
  explain_disagreement: "Choose a debate, or two works, to explain a disagreement between.",
  map_debate: "Choose a debate to map.",
};

function noScopeAnswer(mode: ExplicitResearchMode): ResearchModeAnswer {
  return { answer: NO_SCOPE_TEXT[mode], citedClaimIds: [], citedChunkIds: [], notFound: true, droppedCitationCount: 0 };
}

/**
 * Resolves each mode's own retrieval scope (plan §Web surfaces): the
 * conversation's context work doubles as "Side A"/the base claim's work for
 * `find_counterarguments`/`find_support`/`explain_disagreement`'s work-pair
 * shape, and an explicit `claimId`/`clusterId`/`workIdB` narrows or replaces
 * it per the caller's request. Never throws — an unresolvable scope is an
 * honest `{ kind: "no_scope" }` outcome, handled the same way as a resolved
 * scope with zero evidence (a graceful `notFound` answer, never a 500).
 */
/** Tagged by mode-family (not just "found") so TypeScript's own narrowing —
 *  not a runtime cast — proves each branch in `generateResearchModeAnswer`
 *  below is looking at the one retrieval shape that mode can ever produce. */
type ResearchModeRetrieval =
  | { family: "no_scope" }
  | { family: "counter_or_support"; result: ModeRetrievalResult }
  | { family: "disagreement"; result: DisagreementRetrievalResult }
  | { family: "debate_map"; result: DebateMapResult };

async function retrieveForResearchMode(
  userId: string,
  mode: ExplicitResearchMode,
  scope: { contextWorkId: string | null; claimId?: string; clusterId?: string; workIdB?: string },
): Promise<ResearchModeRetrieval> {
  const repo = createDbResearchModeRepository();
  if (mode === "map_debate") {
    if (!scope.clusterId) return { family: "no_scope" };
    return { family: "debate_map", result: await retrieveDebateMap(repo, userId, scope.clusterId) };
  }
  if (mode === "explain_disagreement") {
    if (scope.clusterId) {
      return { family: "disagreement", result: await retrieveDisagreement(repo, userId, { kind: "cluster", clusterId: scope.clusterId }) };
    }
    if (scope.contextWorkId && scope.workIdB) {
      return {
        family: "disagreement",
        result: await retrieveDisagreement(repo, userId, { kind: "workPair", workIdA: scope.contextWorkId, workIdB: scope.workIdB }),
      };
    }
    return { family: "no_scope" };
  }
  const claimOrWorkScope = scope.claimId
    ? ({ kind: "claim", claimId: scope.claimId } as const)
    : scope.contextWorkId
      ? ({ kind: "work", workId: scope.contextWorkId } as const)
      : null;
  if (!claimOrWorkScope) return { family: "no_scope" };
  const result = mode === "find_support"
    ? await retrieveSupport(repo, userId, claimOrWorkScope)
    : await retrieveCounterarguments(repo, userId, claimOrWorkScope);
  return { family: "counter_or_support", result };
}

/**
 * The research-mode counterpart to `generateSocraticAnswer`: same shape
 * (deterministic $0 fallback whenever there's no evidence, no configured
 * provider, or the cost caps would be exceeded — never a hard error), same
 * label-then-validate discipline, but retrieving via the judged
 * `claim_relationship`/`debate_cluster` graph instead of lexical
 * `rag_chunk`s (`@ice/rag`'s `researchModes.ts`). `explain_disagreement`
 * additionally enforces its own "cite at least one claim per side" rule
 * through `validateResearchModeAnswer`'s `requireSides` option — a model
 * response that fails that check is treated exactly like an invalid JSON
 * response (caught, substituted with the deterministic fallback), never
 * accepted as a one-sided "explanation".
 */
export async function generateResearchModeAnswer(
  userId: string,
  conversationId: string,
  mode: ExplicitResearchMode,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  scope: { contextWorkId: string | null; claimId?: string; clusterId?: string; workIdB?: string },
) {
  const retrieval = await retrieveForResearchMode(userId, mode, scope);

  let promptClaims: ResearchModeClaim[] | undefined;
  let promptSides: { a: ResearchModeClaim[]; b: ResearchModeClaim[] } | undefined;
  let requireSides: { sideA: Set<string>; sideB: Set<string> } | undefined;
  let allClaims: ResearchModeClaim[];
  let fallback: ResearchModeAnswer;

  if (retrieval.family === "no_scope") {
    allClaims = [];
    fallback = noScopeAnswer(mode);
  } else if (retrieval.family === "debate_map") {
    if (!retrieval.result.found) {
      allClaims = [];
      fallback = noEvidenceResearchModeAnswer(mode);
    } else {
      allClaims = retrieval.result.claims;
      promptClaims = retrieval.result.claims;
      fallback = fallbackDebateMapAnswer(retrieval.result.cluster, retrieval.result.claims);
    }
  } else if (retrieval.family === "disagreement") {
    if (!retrieval.result.found) {
      allClaims = [];
      fallback = noEvidenceResearchModeAnswer(mode);
    } else {
      const { sideA, sideB } = retrieval.result;
      allClaims = [...sideA, ...sideB];
      promptSides = { a: sideA, b: sideB };
      requireSides = { sideA: new Set(sideA.map((claim) => claim.id)), sideB: new Set(sideB.map((claim) => claim.id)) };
      fallback = fallbackDisagreementAnswer(sideA, sideB);
    }
  } else {
    if (!retrieval.result.found) {
      allClaims = [];
      fallback = noEvidenceResearchModeAnswer(mode);
    } else {
      allClaims = retrieval.result.claims;
      promptClaims = retrieval.result.claims;
      // `mode` is narrowed to "find_counterarguments" | "find_support" here
      // (the only two modes that ever produce a "counter_or_support" family
      // retrieval) — `fallbackCounterOrSupportAnswer`'s own parameter type
      // requires exactly that pair, not the full `ExplicitResearchMode` union.
      fallback = fallbackCounterOrSupportAnswer(mode as "find_counterarguments" | "find_support", retrieval.result.claims);
    }
  }

  if (!allClaims.length) {
    return { answer: fallback, provider: "deterministic-retrieval", model: "research-mode-fallback", promptTokens: 0, completionTokens: 0, cost: 0, claims: [] as ResearchModeClaim[] };
  }

  const client = new OpenAIResponsesClient();
  const model = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const projected = estimateCostUsd(model, 6_000, 700);
  if (!explicitlyEnabled("PHASE_18_RAG_PROVIDER_ENABLED") || !client.available || projected > RAG_RESPONSE_HARD_CAP_USD || await currentRagSpend(userId) + projected > RAG_DAILY_SOFT_CAP_USD) {
    return { answer: fallback, provider: "deterministic-retrieval", model: "research-mode-fallback", promptTokens: 0, completionTokens: 0, cost: 0, claims: allClaims };
  }

  try {
    const { prompt, labelToRef } = buildResearchModeInput({ mode, question, history, claims: promptClaims, sides: promptSides });
    const result = await withRagLatencyCap(client.call({
      model,
      system: RESEARCH_MODE_SYSTEM_PROMPT[mode],
      input: prompt,
      schema: researchModeAnswerSchema(),
      schemaName: "library_grounded_research_mode_answer",
      safetyIdentifier: safetyIdentifierFor(userId),
      maxOutputTokens: 700,
      validate: (parsed) => validateResearchModeAnswer(parsed, labelToRef, requireSides ? { requireSides } : {}),
    }));
    if (result.data.droppedCitationCount > 0) {
      reportEvent("rag.citation_labels_dropped", {
        conversationId,
        droppedCitationCount: result.data.droppedCitationCount,
        acceptedCitationCount: result.data.citedClaimIds.length + result.data.citedChunkIds.length,
        retrievedChunkCount: allClaims.length,
      });
    }
    return {
      answer: result.data,
      provider: "openai",
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cost: estimateCostUsd(result.model, result.promptTokens, result.completionTokens),
      claims: allClaims,
    };
  } catch {
    // Covers an invalid response shape AND a failed per-side check
    // (`validateResearchModeAnswer` throws for both) — either way, the
    // deterministic fallback is still a real, cited, $0 answer.
    return { answer: fallback, provider: "deterministic-retrieval", model: "research-mode-fallback", promptTokens: 0, completionTokens: 0, cost: 0, claims: allClaims };
  }
}
