import { OpenAIResponsesClient, estimateCostUsd, estimateEmbeddingCostUsd, safetyIdentifierFor } from "@ice/ai-adapters";
import {
  aiUsageLogs,
  db,
  documents,
  ragChunks,
  ragConversations,
  ragMessageCitations,
  ragMessageClaimCitations,
  ragMessages,
  researchClaims,
  works,
} from "@ice/db";
import {
  DEFAULT_RESEARCH_MODE,
  RESEARCH_MODE_SYSTEM_PROMPT,
  SOCRATIC_SYSTEM_PROMPT,
  buildResearchModeInput,
  buildSocraticInput,
  canonicalWorkDisplayTitles,
  createDbResearchModeRepository,
  defaultEmbedQuery,
  fallbackCounterOrSupportAnswer,
  fallbackDebateMapAnswer,
  fallbackDisagreementAnswer,
  fallbackSocraticAnswer,
  isExplicitResearchMode,
  isResearchMode,
  noEvidenceResearchModeAnswer,
  researchModeAnswerSchema,
  retrieveCounterarguments,
  retrieveDebateMap,
  retrieveDisagreement,
  retrieveOwnerRagChunks,
  retrieveSupport,
  validateResearchModeAnswer,
  RAG_RESPONSE_HARD_CAP_USD,
  RAG_RESPONSE_LATENCY_CAP_MS,
  type DebateMapResult,
  type DisagreementRetrievalResult,
  type ExplicitResearchMode,
  type ModeRetrievalResult,
  type RagAnchor,
  type ResearchMode,
  type ResearchModeAnswer,
  type ResearchModeClaim,
  type RetrievedRagChunk,
  validateSocraticAnswer,
} from "@ice/rag";
import { reportEvent } from "@ice/observability";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { processCompetencySignals, type CompetencyNoticeView } from "./competencyData";
import { deriveRagConversationTitle } from "./ragTitle";

export type RagCitationView = {
  chunkId: string;
  ordinal: number;
  href: string;
  label: string;
  sourceType: "uploaded" | "open_access";
  pageIndex?: number;
  license?: string;
};

/** Phase 28.6: a research-mode answer's claim citation, parallel to
 *  `RagCitationView` above but for `research_claim` rows cited via the
 *  CLAIM_N label rather than a `rag_chunk`. Deep-links to the permalink page
 *  Phase 28.3 already ships (`/research/claims/[claimId]`). */
export type RagClaimCitationView = {
  claimId: string;
  ordinal: number;
  href: string;
  label: string;
  claimNature: string;
};

export type RagMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** `null` means `socratic` — matches `rag_message.mode`'s own NULL
   *  convention (see the schema doc comment). */
  mode: ResearchMode | null;
  citations: RagCitationView[];
  claimCitations: RagClaimCitationView[];
  createdAt: string;
  latencyMs: number | null;
};

const MAX_HISTORY_MESSAGES = 6;
export const RAG_DAILY_SOFT_CAP_USD = 1;
// Sub-phase 22.9b (plan §3.5): the Socratic answer call and the competency-
// designation call share ONE daily pool, so a chatty day of either kind
// degrades the other rather than each independently reaching $1 (which
// would silently double the real ceiling this constant is meant to be).
const RAG_SPEND_STAGES = ["socratic-rag", "competency-designation"] as const;

function explicitlyEnabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

function messageView(
  message: { id: string; role: "user" | "assistant"; content: string; mode?: string | null; createdAt: Date; latencyMs: number | null },
  citations: RagCitationView[] = [],
  claimCitations: RagClaimCitationView[] = [],
): RagMessageView {
  const mode = message.mode && isResearchMode(message.mode) ? message.mode : null;
  return { id: message.id, role: message.role, content: message.content, mode, citations, claimCitations, createdAt: message.createdAt.toISOString(), latencyMs: message.latencyMs };
}

function citationView(chunk: { id: string; anchor: unknown; sourceType: "uploaded" | "open_access"; sourceUrl: string | null; license: string | null; workTitle: string }, ordinal: number): RagCitationView {
  const anchor = chunk.anchor as RagAnchor;
  return {
    chunkId: chunk.id,
    ordinal,
    href: anchor.href || chunk.sourceUrl || "#",
    label: anchor.kind === "reader"
      ? `${chunk.workTitle}${typeof anchor.pageIndex === "number" ? ` · page ${anchor.pageIndex + 1}` : ""}`
      : `${chunk.workTitle} · open-access source`,
    sourceType: chunk.sourceType,
    ...(typeof anchor.pageIndex === "number" ? { pageIndex: anchor.pageIndex } : {}),
    ...(chunk.license ? { license: chunk.license } : {}),
  };
}

/** `claimText` is truncated for display — the full text is one click away
 *  on the permalink page (`/research/claims/[claimId]`, Phase 28.3), so this
 *  chip only needs to be a legible pointer, not the whole claim. */
function claimCitationView(claim: { id: string; claimText: string; claimNature: string; workTitle: string }, ordinal: number): RagClaimCitationView {
  const truncated = claim.claimText.length > 110 ? `${claim.claimText.slice(0, 107)}…` : claim.claimText;
  return { claimId: claim.id, ordinal, href: `/research/claims/${claim.id}`, label: `${claim.workTitle} — ${truncated}`, claimNature: claim.claimNature };
}

export async function listRagConversations(userId: string) {
  return db
    .select({ id: ragConversations.id, title: ragConversations.title, contextWorkId: ragConversations.contextWorkId, updatedAt: ragConversations.updatedAt })
    .from(ragConversations)
    .where(and(eq(ragConversations.userId, userId), eq(ragConversations.status, "active")))
    .orderBy(desc(ragConversations.updatedAt));
}

export async function getOwnedRagConversation(userId: string, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(ragConversations)
    .where(and(eq(ragConversations.id, conversationId), eq(ragConversations.userId, userId), eq(ragConversations.status, "active")))
    .limit(1);
  return conversation ?? null;
}

export async function createRagConversation(userId: string, contextWorkId?: string | null) {
  const [conversation] = await db
    .insert(ragConversations)
    .values({ userId, contextWorkId: contextWorkId ?? null })
    .returning();
  return conversation;
}

export async function getRagConversationView(userId: string, conversationId: string) {
  const conversation = await getOwnedRagConversation(userId, conversationId);
  if (!conversation) return null;
  const [rows, claimRows] = await Promise.all([
    db
      .select({
        id: ragMessages.id,
        role: ragMessages.role,
        content: ragMessages.content,
        mode: ragMessages.mode,
        createdAt: ragMessages.createdAt,
        latencyMs: ragMessages.latencyMs,
        ordinal: ragMessageCitations.ordinal,
        chunkId: ragChunks.id,
        anchor: ragChunks.anchor,
        sourceType: ragChunks.sourceType,
        sourceUrl: ragChunks.sourceUrl,
        license: ragChunks.license,
        workTitle: works.title,
        workId: ragChunks.workId,
      })
      .from(ragMessages)
      .leftJoin(ragMessageCitations, eq(ragMessages.id, ragMessageCitations.messageId))
      .leftJoin(ragChunks, eq(ragMessageCitations.chunkId, ragChunks.id))
      .leftJoin(works, eq(ragChunks.workId, works.id))
      .where(eq(ragMessages.conversationId, conversation.id))
      .orderBy(asc(ragMessages.createdAt), asc(ragMessageCitations.ordinal)),
    // Phase 28.6: claim citations are a SEPARATE join (rather than one query
    // with two left joins), since a message can carry both chunk and claim
    // citations at once and a combined join would cross-multiply the two
    // citation sets against each other.
    db
      .select({
        messageId: ragMessages.id,
        ordinal: ragMessageClaimCitations.ordinal,
        claimId: researchClaims.id,
        claimText: researchClaims.claimText,
        claimNature: researchClaims.claimNature,
        workTitle: works.title,
      })
      .from(ragMessages)
      .innerJoin(ragMessageClaimCitations, eq(ragMessages.id, ragMessageClaimCitations.messageId))
      .innerJoin(researchClaims, eq(ragMessageClaimCitations.claimId, researchClaims.id))
      .innerJoin(works, eq(researchClaims.workId, works.id))
      .where(eq(ragMessages.conversationId, conversation.id))
      .orderBy(asc(ragMessages.createdAt), asc(ragMessageClaimCitations.ordinal)),
  ]);

  // Phase 20.6: historical citations also display under the canonical work
  // entry (same resolution `retrieveOwnerRagChunks` applies to new answers).
  const canonicalTitles = await canonicalWorkDisplayTitles(
    userId,
    rows.map((row) => row.workId).filter((id): id is string => Boolean(id)),
  );

  const claimCitationsByMessage = new Map<string, RagClaimCitationView[]>();
  for (const row of claimRows) {
    const list = claimCitationsByMessage.get(row.messageId) ?? [];
    list.push(claimCitationView({ id: row.claimId, claimText: row.claimText, claimNature: row.claimNature, workTitle: row.workTitle }, row.ordinal));
    claimCitationsByMessage.set(row.messageId, list);
  }

  const messages = new Map<string, RagMessageView>();
  for (const row of rows) {
    const existing = messages.get(row.id) ?? messageView(
      { id: row.id, role: row.role, content: row.content, mode: row.mode, createdAt: row.createdAt, latencyMs: row.latencyMs },
      [],
      claimCitationsByMessage.get(row.id) ?? [],
    );
    if (row.chunkId && row.anchor && row.sourceType && row.workTitle && row.ordinal != null) {
      const displayTitle = (row.workId ? canonicalTitles.get(row.workId) : undefined) ?? row.workTitle;
      existing.citations.push(citationView({ id: row.chunkId, anchor: row.anchor, sourceType: row.sourceType, sourceUrl: row.sourceUrl, license: row.license, workTitle: displayTitle }, row.ordinal));
    }
    messages.set(row.id, existing);
  }
  return {
    conversation: { id: conversation.id, title: conversation.title, contextWorkId: conversation.contextWorkId, updatedAt: conversation.updatedAt.toISOString() },
    messages: [...messages.values()],
  };
}

/** Widened (sub-phase 22.9b, plan §3.5) to sum BOTH chat stages sharing the
 * $1/day pool — exported so `competencyData.ts`'s own gating sees the exact
 * same combined total this file's `generateSocraticAnswer` already gates on. */
export async function currentRagSpend(userId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ value: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .innerJoin(documents, eq(aiUsageLogs.documentId, documents.id))
    .where(and(eq(documents.userId, userId), inArray(aiUsageLogs.stage, RAG_SPEND_STAGES), gte(aiUsageLogs.createdAt, today)));
  return Number(row?.value ?? 0);
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

async function generateSocraticAnswer(userId: string, conversationId: string, question: string, history: Array<{ role: "user" | "assistant"; content: string }>, chunks: RetrievedRagChunk[]) {
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
async function generateResearchModeAnswer(
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

export async function answerRagConversation(input: {
  userId: string;
  conversationId: string;
  question: string;
  mode?: ResearchMode;
  claimId?: string;
  clusterId?: string;
  workIdB?: string;
}) {
  const conversation = await getOwnedRagConversation(input.userId, input.conversationId);
  if (!conversation) return null;
  const question = input.question.trim().replace(/\s+/g, " ");
  const mode: ResearchMode = input.mode ?? DEFAULT_RESEARCH_MODE;
  const [userMessage] = await db.insert(ragMessages).values({ conversationId: conversation.id, role: "user", content: question }).returning();
  const prior = await db
    .select({ role: ragMessages.role, content: ragMessages.content })
    .from(ragMessages)
    .where(eq(ragMessages.conversationId, conversation.id))
    .orderBy(desc(ragMessages.createdAt))
    .limit(MAX_HISTORY_MESSAGES);

  // Phase 28.6: research modes retrieve via the judged claim graph, not
  // lexical rag_chunks — a wholly separate path from the socratic default
  // below, sharing only the conversation/message bookkeeping and the
  // "socratic-rag" cost pool (plan §Web surfaces: "cost shares the existing
  // daily pool"). Competency-signal inference (sub-phase 22.9b) stays
  // scoped to the socratic default; a research-mode turn resolves its
  // promise to an empty array rather than skipping the field outright, so
  // the SSE layer's shape never has to special-case a missing promise.
  if (isExplicitResearchMode(mode)) {
    const started = Date.now();
    const generated = await generateResearchModeAnswer(input.userId, conversation.id, mode, question, [...prior].reverse(), {
      contextWorkId: conversation.contextWorkId,
      claimId: input.claimId,
      clusterId: input.clusterId,
      workIdB: input.workIdB,
    });
    const latencyMs = Date.now() - started;
    const [assistantMessage] = await db.insert(ragMessages).values({
      conversationId: conversation.id,
      role: "assistant",
      content: generated.answer.answer,
      mode,
      provider: generated.provider,
      model: generated.model,
      promptTokens: generated.promptTokens,
      completionTokens: generated.completionTokens,
      estimatedCostUsd: generated.cost,
      latencyMs,
    }).returning();
    const citedClaims = generated.claims.filter((claim) => generated.answer.citedClaimIds.includes(claim.id));
    if (citedClaims.length) {
      await db.insert(ragMessageClaimCitations).values(citedClaims.map((claim, ordinal) => ({ messageId: assistantMessage.id, claimId: claim.id, ordinal })));
    }
    if (generated.cost > 0) {
      await db.insert(aiUsageLogs).values({
        // No natural document to attribute a claim-based answer to (a
        // research_claim isn't 1:1 with one document the way a rag_chunk
        // is) — null is the honest value, matching this column's own
        // nullable/`set null` design (see the Design Decisions log entry),
        // not a guess at the "first" cited claim's work.
        documentId: null,
        task: "research_mode_answer",
        stage: "socratic-rag",
        provider: generated.provider,
        model: generated.model,
        promptTokens: generated.promptTokens,
        completionTokens: generated.completionTokens,
        estimatedCostUsd: generated.cost,
      });
    }
    const modeTitle = deriveRagConversationTitle(conversation.title, question);
    await db.update(ragConversations).set({ title: modeTitle, updatedAt: new Date() }).where(eq(ragConversations.id, conversation.id));

    return {
      user: messageView(userMessage),
      assistant: messageView(assistantMessage, [], citedClaims.map((claim, ordinal) => claimCitationView(claim, ordinal))),
      competencyPromise: Promise.resolve([] as CompetencyNoticeView[]),
      notFound: generated.answer.notFound,
    };
  }

  // Phase 29.3 follow-up: `retrieveOwnerRagChunks` only ever invokes
  // `embedQuery` when `RAG_HYBRID_RETRIEVAL` is on (the flag-off path returns
  // before touching `options.embedQuery` at all — see `@ice/rag`'s
  // `index.ts`), so this wrapper is safe to pass unconditionally: flag-off
  // behavior stays byte-identical (no fetch, no usage row, `queryEmbeddingUsage`
  // stays null) and flag-on behavior gains real cost accounting for the query
  // embedding call that was previously invisible to `ai_usage_log`.
  let queryEmbeddingUsage: { model: string; inputTokens: number; estimatedCostUsd: number } | null = null;
  const chunks = await retrieveOwnerRagChunks(input.userId, question, undefined, {
    embedQuery: async (text) => {
      const embedded = await defaultEmbedQuery(text);
      queryEmbeddingUsage = {
        model: embedded.model,
        inputTokens: embedded.inputTokens,
        estimatedCostUsd: estimateEmbeddingCostUsd(embedded.model, embedded.inputTokens),
      };
      return embedded;
    },
  });
  const started = Date.now();
  const generated = await generateSocraticAnswer(input.userId, conversation.id, question, [...prior].reverse(), chunks);
  const latencyMs = Date.now() - started;
  const [assistantMessage] = await db.insert(ragMessages).values({
    conversationId: conversation.id,
    role: "assistant",
    content: generated.answer.answer,
    provider: generated.provider,
    model: generated.model,
    promptTokens: generated.promptTokens,
    completionTokens: generated.completionTokens,
    estimatedCostUsd: generated.cost,
    latencyMs,
  }).returning();
  const citations = chunks.filter((chunk) => generated.answer.citedChunkIds.includes(chunk.id));
  if (citations.length) {
    await db.insert(ragMessageCitations).values(citations.map((chunk, ordinal) => ({ messageId: assistantMessage.id, chunkId: chunk.id, ordinal })));
  }
  if (generated.cost > 0 && chunks[0]) {
    await db.insert(aiUsageLogs).values({
      documentId: chunks[0].documentId,
      task: "socratic_rag_answer",
      stage: "socratic-rag",
      provider: generated.provider,
      model: generated.model,
      promptTokens: generated.promptTokens,
      completionTokens: generated.completionTokens,
      estimatedCostUsd: generated.cost,
    });
  }
  // Same "socratic-rag" stage as the completion log above (not a separate
  // stage) so the query-embedding cost naturally falls inside the existing
  // `RAG_SPEND_STAGES`/`RAG_DAILY_SOFT_CAP_USD` pool `currentRagSpend` sums,
  // with no change to that gating logic needed. `documentId` uses the same
  // "attribute to the first retrieved chunk's document" convention as the
  // completion log; a hybrid query that surfaces no chunks at all still
  // incurred a real embedding cost, so it's logged with a null documentId
  // rather than dropped (`ai_usage_log.document_id` is nullable, `set null`
  // on delete, by design — see the Design Decisions log entry).
  if (queryEmbeddingUsage) {
    const usage: { model: string; inputTokens: number; estimatedCostUsd: number } = queryEmbeddingUsage;
    await db.insert(aiUsageLogs).values({
      documentId: chunks[0]?.documentId ?? null,
      task: "socratic_rag_query_embedding",
      stage: "socratic-rag",
      provider: "openai",
      model: usage.model,
      promptTokens: usage.inputTokens,
      completionTokens: 0,
      estimatedCostUsd: usage.estimatedCostUsd,
    });
  }
  const title = deriveRagConversationTitle(conversation.title, question);
  await db.update(ragConversations).set({ title, updatedAt: new Date() }).where(eq(ragConversations.id, conversation.id));

  // Sub-phase 22.9b (plan §3.5): kicked off AFTER the answer is generated
  // (so the shared cost pool already reflects this turn's Socratic spend,
  // giving the answer call priority), but never awaited here — the SSE
  // layer (`streamAnswer` in the conversations route) races this against
  // its own 6s fail-silent cap so a slow/failed competency pass can never
  // delay or fail the answer itself.
  const previousAssistantMessage = [...prior].reverse().slice(0, -1).findLast((message) => message.role === "assistant")?.content ?? null;
  const competencyPromise: Promise<CompetencyNoticeView[]> = processCompetencySignals({
    userId: input.userId,
    conversationId: conversation.id,
    messageId: userMessage.id,
    userMessage: question,
    previousAssistantMessage,
    contextWorkId: conversation.contextWorkId,
    chunkWorkIds: chunks.map((chunk) => chunk.workId),
    usageDocumentId: chunks[0]?.documentId ?? null,
  });

  return {
    user: messageView(userMessage),
    assistant: messageView(assistantMessage, citations.map((chunk, ordinal) => citationView(chunk, ordinal))),
    competencyPromise,
    notFound: generated.answer.notFound,
  };
}
