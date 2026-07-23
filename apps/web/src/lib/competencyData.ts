import { OpenAIResponsesClient, estimateCostUsd, safetyIdentifierFor } from "@ice/ai-adapters";
import { phase22CompetencyEnabled, phase22CompetencyProviderEnabled } from "@ice/config";
import {
  aiUsageLogs,
  competencySignals,
  concepts,
  conceptMastery,
  db,
  graphEdges,
  understandingRatings,
} from "@ice/db";
import { shouldOverwriteMastery, type MasterySource } from "@ice/research";
import {
  COMPETENCY_CALL_HARD_CAP_USD,
  COMPETENCY_DAILY_APPLIED_WRITE_CAP,
  COMPETENCY_LEVEL_SCORES,
  COMPETENCY_MAX_OUTPUT_TOKENS,
  COMPETENCY_MAX_SIGNALS_PER_MESSAGE,
  COMPETENCY_SIGNALS_SCHEMA_NAME,
  COMPETENCY_SYSTEM_PROMPT,
  buildCompetencyInput,
  canonicalWorkDisplayTitles,
  competencySignalsSchema,
  detectSelfReportedCompetency,
  messageMightContainCompetencySignal,
  validateCompetencySignals,
  type CompetencyCandidate,
  type CompetencyLevel,
  type CompetencySignal,
} from "@ice/rag";
import { and, eq, gte, inArray } from "drizzle-orm";
import { currentRagSpend, RAG_DAILY_SOFT_CAP_USD } from "./ragData";

/**
 * Sub-phase 22.9b (plan §3.2/§3.5): the Conversational Competency
 * Designation orchestrator — the DB/AI-touching half of the pure
 * `@ice/rag` module. Runs as a separate post-answer step
 * (`processCompetencySignals`), never inline with the Socratic answer call
 * (§3.1's rejected-alternatives note: piggybacking on the answer schema
 * would couple the two features' reliability and cost budgets together).
 */

// ---------------------------------------------------------------------------
// Candidate resolution (§3.2)
// ---------------------------------------------------------------------------

// Deliberately small and split across kinds — precision over recall (§3.1):
// a wider candidate list gives the model/detector more surface to guess
// wrong on, not more genuine signal. Mirrors the diagnostic route's own
// `MAX_DIAGNOSTIC_CONCEPTS = 10` rationale.
const MAX_CONCEPT_CANDIDATES = 10;
const MAX_WORK_CANDIDATES = 6;

/**
 * Server-supplied CLOSED candidate set for one turn: concepts the
 * turn's retrieved-chunk works (∪ the conversation's `contextWorkId`)
 * presuppose — same `work -[presupposes]-> concept` query shape as
 * `apps/web/src/app/api/works/[workId]/diagnostic/route.ts`'s
 * `workRelevantConcepts` — plus those works themselves, under their
 * canonical display titles (Phase 20.6), for work-directed statements.
 * Never invents a target the model/detector could pick from outside this
 * list (§3.3's candidate-set rejection is the backstop; this is the first
 * line of defense).
 */
export async function resolveCompetencyCandidates(userId: string, workIds: readonly string[]): Promise<CompetencyCandidate[]> {
  const uniqueWorkIds = [...new Set(workIds)].filter((id): id is string => Boolean(id));
  if (!uniqueWorkIds.length) return [];

  const [conceptEdges, workTitles] = await Promise.all([
    db
      .select({ conceptId: concepts.id, label: concepts.label, aliases: concepts.aliases })
      .from(graphEdges)
      .innerJoin(concepts, eq(concepts.id, graphEdges.targetId))
      .where(
        and(
          eq(graphEdges.userId, userId),
          eq(graphEdges.sourceType, "work"),
          inArray(graphEdges.sourceId, uniqueWorkIds),
          eq(graphEdges.targetType, "concept"),
          eq(graphEdges.edgeType, "presupposes"),
        ),
      )
      .limit(MAX_CONCEPT_CANDIDATES * 2), // over-fetch before de-duplicating by conceptId below
    canonicalWorkDisplayTitles(userId, uniqueWorkIds),
  ]);

  const seenConcepts = new Set<string>();
  const conceptCandidates: CompetencyCandidate[] = [];
  for (const edge of conceptEdges) {
    if (seenConcepts.has(edge.conceptId) || conceptCandidates.length >= MAX_CONCEPT_CANDIDATES) continue;
    seenConcepts.add(edge.conceptId);
    const aliases = Array.isArray(edge.aliases) ? edge.aliases.filter((alias): alias is string => typeof alias === "string") : undefined;
    conceptCandidates.push({ targetId: edge.conceptId, kind: "concept", label: edge.label, ...(aliases?.length ? { aliases } : {}) });
  }

  const workCandidates: CompetencyCandidate[] = uniqueWorkIds
    .slice(0, MAX_WORK_CANDIDATES)
    .map((workId): CompetencyCandidate | null => {
      const title = workTitles.get(workId);
      return title ? { targetId: workId, kind: "work", label: title } : null;
    })
    .filter((candidate): candidate is CompetencyCandidate => candidate !== null);

  return [...conceptCandidates, ...workCandidates];
}

// ---------------------------------------------------------------------------
// Undo-suppression (§3.4: "undone signals suppress re-detection of the same
// level for the same target within that conversation")
// ---------------------------------------------------------------------------

async function isSuppressedByUndo(conversationId: string, target: { conceptId?: string; workId?: string }, level: CompetencyLevel): Promise<boolean> {
  const targetCondition = target.conceptId ? eq(competencySignals.conceptId, target.conceptId) : eq(competencySignals.workId, target.workId!);
  const [row] = await db
    .select({ id: competencySignals.id })
    .from(competencySignals)
    .where(and(eq(competencySignals.conversationId, conversationId), eq(competencySignals.status, "undone"), eq(competencySignals.level, level), targetCondition))
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Daily applied-write cap (§3.3/§3.5) — counts APPLIED writes only, not raw
// detections; a skipped_precedence row never counts against it.
// ---------------------------------------------------------------------------

async function appliedWriteCountToday(userId: string): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: competencySignals.id })
    .from(competencySignals)
    .where(and(eq(competencySignals.userId, userId), eq(competencySignals.status, "applied"), gte(competencySignals.createdAt, today)));
  return rows.length;
}

// ---------------------------------------------------------------------------
// Gated structured model call (§3.1 item 2 / §3.5)
// ---------------------------------------------------------------------------

// Small, cheap projection: input is the message + previous assistant turn +
// a short candidate list, never retrieved passages (unlike the Socratic
// call's ~6k-token passage budget), so a modest fixed estimate is honest
// here rather than importing the Socratic call's larger constant.
const COMPETENCY_PROJECTED_PROMPT_TOKENS = 1_200;

async function runGatedModelCall(input: {
  userId: string;
  userMessage: string;
  previousAssistantMessage: string | null;
  candidates: readonly CompetencyCandidate[];
}): Promise<{ signals: CompetencySignal[]; cost: number; model: string; promptTokens: number; completionTokens: number } | null> {
  if (!phase22CompetencyProviderEnabled()) return null;
  if (!input.candidates.length) return null;
  if (!messageMightContainCompetencySignal(input.userMessage)) return null;

  const client = new OpenAIResponsesClient();
  if (!client.available) return null;
  const model = process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const projected = estimateCostUsd(model, COMPETENCY_PROJECTED_PROMPT_TOKENS, COMPETENCY_MAX_OUTPUT_TOKENS);
  if (projected > COMPETENCY_CALL_HARD_CAP_USD) return null;
  // Shared $1/day pool across BOTH stages (§3.5) — the Socratic answer call
  // always runs first each turn, so this check already reflects that spend;
  // a chatty day degrades competency inference to the deterministic
  // detector alone, which is the designed floor, not an outage.
  if ((await currentRagSpend(input.userId)) + projected > RAG_DAILY_SOFT_CAP_USD) return null;

  try {
    const result = await client.call({
      model,
      system: COMPETENCY_SYSTEM_PROMPT,
      input: buildCompetencyInput(input.userMessage, input.previousAssistantMessage, input.candidates),
      schema: competencySignalsSchema(),
      schemaName: COMPETENCY_SIGNALS_SCHEMA_NAME,
      safetyIdentifier: safetyIdentifierFor(input.userId),
      maxOutputTokens: COMPETENCY_MAX_OUTPUT_TOKENS,
      validate: (parsed) => validateCompetencySignals(parsed, input.candidates, input.userMessage),
    });
    return {
      signals: result.data,
      cost: estimateCostUsd(result.model, result.promptTokens, result.completionTokens),
      model: result.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  } catch {
    // Fails closed to the deterministic detector's output alone — never an
    // invented signal, and never a failed chat answer over this.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Merge detector + model signals (both sources can run per §3.1; the
// zero-cost detector's own finding for a target always takes precedence
// over the model's for the SAME target, since it is already deterministic
// and free — the model only fills in targets the detector found nothing
// for).
// ---------------------------------------------------------------------------

function mergeSignals(detectorSignals: readonly CompetencySignal[], modelSignals: readonly CompetencySignal[]): CompetencySignal[] {
  const merged = [...detectorSignals];
  const covered = new Set(merged.map((signal) => signal.targetId));
  for (const signal of modelSignals) {
    if (covered.has(signal.targetId) || merged.length >= COMPETENCY_MAX_SIGNALS_PER_MESSAGE) continue;
    merged.push(signal);
    covered.add(signal.targetId);
  }
  return merged.slice(0, COMPETENCY_MAX_SIGNALS_PER_MESSAGE);
}

// ---------------------------------------------------------------------------
// Writes (§3.2/§3.6)
// ---------------------------------------------------------------------------

export type CompetencyNoticeView = {
  signalId: string;
  targetKind: "concept" | "work";
  targetId: string;
  label: string;
  level: CompetencyLevel;
  quote: string;
  previousScore: number | null;
  newScore: number;
};

function basisFor(quote: string): string {
  return `Reader statement in Ask Library chat: "${quote}"`;
}

/**
 * Applies (or precedence-skips) ONE validated signal, transactionally: the
 * `concept_mastery`/`understanding_rating` write and its `competency_signal`
 * ledger row happen together, or not at all. Returns a notice view only for
 * an APPLIED write — a `skipped_precedence` row is logged for honesty
 * (§3.6) but never surfaced (§3.2: "not surfaced, keeps the log honest").
 */
async function applySignal(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  candidate: CompetencyCandidate;
  signal: CompetencySignal;
  detector: string;
}): Promise<CompetencyNoticeView | null> {
  const newScore = COMPETENCY_LEVEL_SCORES[input.signal.level];
  const basis = basisFor(input.signal.quote);

  return db.transaction(async (tx) => {
    if (input.candidate.kind === "concept") {
      const [existing] = await tx
        .select({ score: conceptMastery.score, source: conceptMastery.source })
        .from(conceptMastery)
        .where(and(eq(conceptMastery.userId, input.userId), eq(conceptMastery.conceptId, input.candidate.targetId)))
        .limit(1);
      const existingSource: MasterySource | null = existing?.source ?? null;

      if (!shouldOverwriteMastery(existingSource, "inferred")) {
        await tx.insert(competencySignals).values({
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          conceptId: input.candidate.targetId,
          level: input.signal.level,
          newScore,
          previousScore: existing?.score ?? null,
          previousSource: existingSource,
          basis,
          detector: input.detector,
          status: "skipped_precedence",
        });
        return null;
      }

      await tx
        .insert(conceptMastery)
        .values({ userId: input.userId, conceptId: input.candidate.targetId, score: newScore, source: "inferred", evidence: basis })
        .onConflictDoUpdate({
          target: [conceptMastery.userId, conceptMastery.conceptId],
          set: { score: newScore, source: "inferred", evidence: basis, updatedAt: new Date() },
        });
      // A prior signal that's still marked `applied` for this SAME target no
      // longer reflects the current live score once this one lands — mark
      // it superseded so the undo route can tell "the current write" from
      // "a stale one" without re-deriving it from the mastery table.
      await tx
        .update(competencySignals)
        .set({ status: "superseded" })
        .where(and(eq(competencySignals.userId, input.userId), eq(competencySignals.conceptId, input.candidate.targetId), eq(competencySignals.status, "applied")));
      const [row] = await tx
        .insert(competencySignals)
        .values({
          userId: input.userId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          conceptId: input.candidate.targetId,
          level: input.signal.level,
          newScore,
          previousScore: existing?.score ?? null,
          previousSource: existingSource,
          basis,
          detector: input.detector,
          status: "applied",
        })
        .returning();
      return {
        signalId: row!.id,
        targetKind: "concept",
        targetId: input.candidate.targetId,
        label: input.candidate.label,
        level: input.signal.level,
        quote: input.signal.quote,
        previousScore: existing?.score ?? null,
        newScore,
      };
    }

    // kind === "work" → understanding_rating.workId (§3.2)
    const [existing] = await tx
      .select({ id: understandingRatings.id, score: understandingRatings.score, source: understandingRatings.source })
      .from(understandingRatings)
      .where(and(eq(understandingRatings.userId, input.userId), eq(understandingRatings.workId, input.candidate.targetId)))
      .limit(1);
    const existingSource: MasterySource | null = existing?.source ?? null;

    if (!shouldOverwriteMastery(existingSource, "inferred")) {
      await tx.insert(competencySignals).values({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        workId: input.candidate.targetId,
        level: input.signal.level,
        newScore,
        previousScore: existing?.score ?? null,
        previousSource: existingSource,
        basis,
        detector: input.detector,
        status: "skipped_precedence",
      });
      return null;
    }

    if (existing) {
      await tx.update(understandingRatings).set({ score: newScore, source: "inferred", updatedAt: new Date() }).where(eq(understandingRatings.id, existing.id));
    } else {
      await tx.insert(understandingRatings).values({ userId: input.userId, workId: input.candidate.targetId, score: newScore, source: "inferred" });
    }
    await tx
      .update(competencySignals)
      .set({ status: "superseded" })
      .where(and(eq(competencySignals.userId, input.userId), eq(competencySignals.workId, input.candidate.targetId), eq(competencySignals.status, "applied")));
    const [row] = await tx
      .insert(competencySignals)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        workId: input.candidate.targetId,
        level: input.signal.level,
        newScore,
        previousScore: existing?.score ?? null,
        previousSource: existingSource,
        basis,
        detector: input.detector,
        status: "applied",
      })
      .returning();
    return {
      signalId: row!.id,
      targetKind: "work",
      targetId: input.candidate.targetId,
      label: input.candidate.label,
      level: input.signal.level,
      quote: input.signal.quote,
      previousScore: existing?.score ?? null,
      newScore,
    };
  });
}

// ---------------------------------------------------------------------------
// Entry point (§3.5: "answerRagConversation additionally returns a
// competencyPromise kicked off after answer generation")
// ---------------------------------------------------------------------------

export async function processCompetencySignals(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  userMessage: string;
  previousAssistantMessage: string | null;
  contextWorkId: string | null;
  chunkWorkIds: readonly string[];
  usageDocumentId: string | null;
}): Promise<CompetencyNoticeView[]> {
  if (!phase22CompetencyEnabled()) return [];
  try {
    const workIds = [...new Set([...input.chunkWorkIds, ...(input.contextWorkId ? [input.contextWorkId] : [])])];
    const candidates = await resolveCompetencyCandidates(input.userId, workIds);
    if (!candidates.length) return [];
    const candidatesById = new Map(candidates.map((candidate) => [candidate.targetId, candidate]));

    const detectorSignals = detectSelfReportedCompetency(input.userMessage, candidates);
    const modelResult = await runGatedModelCall({
      userId: input.userId,
      userMessage: input.userMessage,
      previousAssistantMessage: input.previousAssistantMessage,
      candidates,
    });
    const merged = mergeSignals(detectorSignals, modelResult?.signals ?? []);
    if (!merged.length) return [];

    if (modelResult && modelResult.cost > 0 && input.usageDocumentId) {
      await db.insert(aiUsageLogs).values({
        documentId: input.usageDocumentId,
        task: "chat_competency_signal",
        stage: "competency-designation",
        provider: "openai",
        model: modelResult.model,
        promptTokens: modelResult.promptTokens,
        completionTokens: modelResult.completionTokens,
        estimatedCostUsd: modelResult.cost,
      });
    }

    // Undo-suppression (§3.4): drop any signal whose exact target+level was
    // explicitly undone earlier in THIS conversation, before it ever
    // reaches the daily-cap/write path.
    const notSuppressed: CompetencySignal[] = [];
    for (const signal of merged) {
      const candidate = candidatesById.get(signal.targetId);
      if (!candidate) continue;
      const target = candidate.kind === "concept" ? { conceptId: candidate.targetId } : { workId: candidate.targetId };
      if (await isSuppressedByUndo(input.conversationId, target, signal.level)) continue;
      notSuppressed.push(signal);
    }
    if (!notSuppressed.length) return [];

    // Daily applied-write cap (§3.3/§3.5): a signal that would land once the
    // cap is already reached today is silently dropped rather than queued —
    // matching the "degrades to the deterministic floor" posture used for
    // the shared cost pool above, not a distinct ledger status.
    let remainingCap = COMPETENCY_DAILY_APPLIED_WRITE_CAP - (await appliedWriteCountToday(input.userId));
    const notices: CompetencyNoticeView[] = [];
    for (const signal of notSuppressed) {
      const candidate = candidatesById.get(signal.targetId);
      if (!candidate) continue;
      if (remainingCap <= 0) break;
      const detector = modelResult?.signals.some((modelSignal) => modelSignal.targetId === signal.targetId) && !detectorSignals.some((detectorSignal) => detectorSignal.targetId === signal.targetId)
        ? `model:${modelResult.model}`
        : "self-report-pattern";
      const notice = await applySignal({
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        candidate,
        signal,
        detector,
      });
      if (notice) {
        notices.push(notice);
        remainingCap -= 1;
      }
    }
    return notices;
  } catch {
    // A competency failure NEVER fails the answer (§3.5) — the caller's own
    // 6s race also protects against this promise hanging, but a thrown
    // error here must resolve empty, not reject the whole SSE stream.
    return [];
  }
}
