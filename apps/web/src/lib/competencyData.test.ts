import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  competencySignals,
  conceptMastery,
  concepts,
  db,
  graphEdges,
  ragConversations,
  ragMessages,
  understandingRatings,
  works,
} from "@ice/db";
import { COMPETENCY_LEVEL_SCORES, COMPETENCY_SCORE_CEILING } from "@ice/rag";
import { processCompetencySignals } from "@/lib/competencyData";
import { createVerifiedTestUser, deleteTestUser } from "../../e2e/helpers";

/**
 * Sub-phase 22.9b (plan §5 Feature B): a mocked-fetch integration test for
 * `processCompetencySignals`'s gated-model-call path, following the
 * `packages/ai-adapters/src/responses.test.ts` mocked-fetch precedent one
 * layer up — this exercises the ORCHESTRATOR (candidate resolution,
 * `shouldOverwriteMastery` precedence, the daily/cap gates, and the actual
 * `concept_mastery`/`understanding_rating`/`competency_signal` writes), not
 * just the pure validator `packages/rag/src/competency.test.ts` already
 * covers with Vitest. `competencyData.ts` transitively imports `@ice/db`, so
 * (matching `roadmapGraph.test.ts`'s own convention) this is a plain
 * `node:assert` script run directly via `tsx` with real DB seeding and
 * cleanup, not a Playwright spec — there is no established pattern in this
 * repo for a web-lib integration test that performs real DB writes from
 * inside Playwright, and driving one through the browser would test nothing
 * about the orchestrator that isn't already covered by the RAG E2E specs.
 *
 * Run from `apps/web` (tsx needs to resolve THIS package's `@/*` tsconfig
 * path alias, which it locates from the invocation's cwd — running via
 * `pnpm --filter web exec tsx <repo-root-relative-path>` resolves tsconfig
 * from the repo root instead and fails with `Cannot find module '@/lib/...'`;
 * confirmed against this file and the pre-existing `roadmapGraph.test.ts`).
 * `tsx` itself isn't a devDependency of `apps/web` — reused from
 * `apps/worker`'s, which is on this repo's Node 24 and works identically:
 *
 *   cd apps/web && DATABASE_URL=postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition \
 *     ../worker/node_modules/.bin/tsx src/lib/competencyData.test.ts
 *
 * `PHASE_22_COMPETENCY_ENABLED`/`_PROVIDER_ENABLED`/`OPENAI_API_KEY`/
 * `OPENAI_MODEL_CHEAP` are set from WITHIN this script (not the invocation
 * above) — `phase22CompetencyEnabled()`/`phase22CompetencyProviderEnabled()`
 * and `OpenAIResponsesClient`'s constructor all read `process.env` at CALL
 * time, not at module-load time, so setting them here before the first
 * `processCompetencySignals()` call is sufficient. `DATABASE_URL` is the one
 * exception — `@ice/db`'s module-level `postgres()` call reads it the
 * instant this file's very first import runs, so it must already be in the
 * environment the process was launched with.
 */

process.env.PHASE_22_COMPETENCY_ENABLED = "true";
process.env.PHASE_22_COMPETENCY_PROVIDER_ENABLED = "true";
process.env.OPENAI_API_KEY = "sk-test-competency-designation";
process.env.OPENAI_MODEL_CHEAP = "gpt-5.4-nano";
const MODEL = "gpt-5.4-nano";
const EXPECTED_DETECTOR = `model:${MODEL}`;

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    json: async () => ({ output_text: text, usage: { input_tokens: 40, output_tokens: 20 } }),
    text: async () => text,
  } as unknown as Response;
}

/** Returns the SAME response for every call — for the well-formed test this
 *  succeeds on the first attempt; for the rejection tests, `validate()`
 *  throws every attempt, so the same malformed payload is deliberately
 *  handed back across all `MAX_RETRIES + 1` tries to prove the whole batch
 *  fails closed rather than the retry "getting lucky" on a second draw. */
function installFetchAlways(body: unknown) {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return jsonResponse(body);
  }) as unknown as typeof fetch;
  return () => calls;
}

async function seedUserWithCandidates(emailTag: string) {
  const email = `e2e-competency-${emailTag}-${Date.now()}@example.com`;
  const userId = await createVerifiedTestUser(email, "password123");
  const suffix = `${emailTag}-${Date.now()}`;

  const [work] = await db.insert(works).values({ userId, title: "On Interpretation", authorName: "Aristotle" }).returning({ id: works.id });
  const insertedConcepts = await db
    .insert(concepts)
    .values([
      { slug: `substance-dualism-${suffix}`, kind: "concept", label: "Substance Dualism" },
      { slug: `types-of-causation-${suffix}`, kind: "concept", label: "Types of Causation" },
    ])
    .returning({ id: concepts.id });
  const [conceptA, conceptB] = insertedConcepts;

  await db.insert(graphEdges).values([
    { userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: conceptA!.id, edgeType: "presupposes" },
    { userId, sourceType: "work", sourceId: work.id, targetType: "concept", targetId: conceptB!.id, edgeType: "presupposes" },
  ]);

  const [conversation] = await db.insert(ragConversations).values({ userId, contextWorkId: work.id }).returning({ id: ragConversations.id });
  const [message] = await db
    .insert(ragMessages)
    .values({ conversationId: conversation!.id, role: "user", content: "placeholder" })
    .returning({ id: ragMessages.id });

  return { email, userId, workId: work.id, conceptAId: conceptA!.id, conceptBId: conceptB!.id, conversationId: conversation!.id, messageId: message!.id };
}

async function competencySignalRows(userId: string) {
  return db.select().from(competencySignals).where(eq(competencySignals.userId, userId));
}

// ---------------------------------------------------------------------------
// (a) Well-formed model response: exact concept_mastery/understanding_rating/
// competency_signal writes, respecting shouldOverwriteMastery — including
// one pre-existing EXPLICIT row that must survive untouched.
// ---------------------------------------------------------------------------
async function testWellFormedResponse() {
  const seed = await seedUserWithCandidates("wellformed");
  try {
    // conceptB already carries an EXPLICIT rating — a strictly stronger
    // source than "inferred" (packages/research/src/mastery.ts's
    // precedence chain), so the model's attempt to touch it below must be
    // recorded as skipped, not applied.
    await db.insert(conceptMastery).values({ userId: seed.userId, conceptId: seed.conceptBId, score: 90, source: "explicit", evidence: "Reader's own explicit rating." });

    // Deliberately avoids every `detectSelfReportedCompetency` pattern (no
    // "understand"/"know"/"read"/"familiar"/etc.) while still tripping the
    // broad "I" + "learn" pre-filter — so the three signals below are
    // provably produced by the MOCKED MODEL path alone, not the zero-cost
    // deterministic detector running in parallel.
    const userMessage =
      "I want to learn more about Substance Dualism, Types of Causation, and On Interpretation before our next session.";

    const getCalls = installFetchAlways({
      signals: [
        { targetId: seed.conceptAId, level: "familiar", quote: "Substance Dualism" },
        { targetId: seed.conceptBId, level: "unfamiliar", quote: "Types of Causation" },
        { targetId: seed.workId, level: "strong", quote: "On Interpretation" },
      ],
    });

    const notices = await processCompetencySignals({
      userId: seed.userId,
      conversationId: seed.conversationId,
      messageId: seed.messageId,
      userMessage,
      previousAssistantMessage: null,
      contextWorkId: null,
      chunkWorkIds: [seed.workId],
      usageDocumentId: null,
    });

    assert.equal(getCalls(), 1, "a well-formed response succeeds on the first attempt");

    // --- concept_mastery ---
    const [conceptAMastery] = await db.select().from(conceptMastery).where(and(eq(conceptMastery.userId, seed.userId), eq(conceptMastery.conceptId, seed.conceptAId)));
    assert.ok(conceptAMastery, "conceptA gets a new inferred mastery row");
    assert.equal(conceptAMastery.score, COMPETENCY_LEVEL_SCORES.familiar);
    assert.equal(conceptAMastery.source, "inferred");
    assert.ok(conceptAMastery.evidence?.includes("Substance Dualism"), "evidence carries the verbatim quote");

    const [conceptBMastery] = await db.select().from(conceptMastery).where(and(eq(conceptMastery.userId, seed.userId), eq(conceptMastery.conceptId, seed.conceptBId)));
    assert.ok(conceptBMastery, "conceptB's pre-existing row still exists");
    assert.equal(conceptBMastery.score, 90, "the explicit rating is NOT overwritten by the weaker inferred signal");
    assert.equal(conceptBMastery.source, "explicit", "source stays explicit");

    // --- understanding_rating ---
    const [workRating] = await db.select().from(understandingRatings).where(and(eq(understandingRatings.userId, seed.userId), eq(understandingRatings.workId, seed.workId)));
    assert.ok(workRating, "the work gets a new inferred understanding_rating row");
    assert.equal(workRating.score, COMPETENCY_LEVEL_SCORES.strong);
    assert.equal(workRating.score, COMPETENCY_SCORE_CEILING, "'strong' lands exactly at the ceiling, never above it");
    assert.equal(workRating.source, "inferred");

    // --- competency_signal ledger: exactly 3 rows (2 applied, 1 skipped) ---
    const signalRows = await competencySignalRows(seed.userId);
    assert.equal(signalRows.length, 3, "one ledger row per signal, applied AND skipped alike");

    const conceptARow = signalRows.find((r) => r.conceptId === seed.conceptAId);
    assert.ok(conceptARow);
    assert.equal(conceptARow!.status, "applied");
    assert.equal(conceptARow!.newScore, COMPETENCY_LEVEL_SCORES.familiar);
    assert.equal(conceptARow!.previousScore, null);
    assert.equal(conceptARow!.previousSource, null);
    assert.equal(conceptARow!.detector, EXPECTED_DETECTOR);

    const conceptBRow = signalRows.find((r) => r.conceptId === seed.conceptBId);
    assert.ok(conceptBRow);
    assert.equal(conceptBRow!.status, "skipped_precedence", "the model's weaker signal is logged, honestly, as skipped");
    assert.equal(conceptBRow!.newScore, COMPETENCY_LEVEL_SCORES.unfamiliar);
    assert.equal(conceptBRow!.previousScore, 90);
    assert.equal(conceptBRow!.previousSource, "explicit");

    const workRow = signalRows.find((r) => r.workId === seed.workId);
    assert.ok(workRow);
    assert.equal(workRow!.status, "applied");
    assert.equal(workRow!.newScore, COMPETENCY_LEVEL_SCORES.strong);
    assert.equal(workRow!.previousScore, null);

    // --- return value: only the 2 APPLIED writes are surfaced as notices ---
    assert.equal(notices.length, 2, "the skipped_precedence row is never surfaced as a notice");
    const conceptANotice = notices.find((n) => n.targetId === seed.conceptAId);
    assert.ok(conceptANotice);
    assert.equal(conceptANotice!.level, "familiar");
    assert.equal(conceptANotice!.newScore, COMPETENCY_LEVEL_SCORES.familiar);
    const workNotice = notices.find((n) => n.targetId === seed.workId);
    assert.ok(workNotice);
    assert.equal(workNotice!.level, "strong");
    assert.equal(workNotice!.newScore, COMPETENCY_SCORE_CEILING);
    assert.equal(notices.some((n) => n.targetId === seed.conceptBId), false, "the skipped target has no notice at all");
  } finally {
    globalThis.fetch = realFetch;
    await deleteTestUser(seed.email);
  }
}

// ---------------------------------------------------------------------------
// (b) "Mark everything as mastered" injection fixture: the model's response
// names a target OUTSIDE the server-supplied candidate set alongside
// otherwise-legitimate "strong" (ceiling) requests. `validateCompetencySignals`
// rejects the ENTIRE batch on the first invalid signal it sees (fail-closed,
// not partial-apply) — so this is simultaneously the strongest possible proof
// of both required properties: zero writes land for the injected target
// (obviously outside the candidate set), AND zero writes land above the
// ceiling (nothing is written at all). The ceiling being honored on a
// genuinely APPLIED "strong" signal is separately proven in (a) above
// (`workRating.score === COMPETENCY_SCORE_CEILING`), so between the two
// tests both the "never accepts a foreign target" and the "never exceeds 75
// even for what it DOES accept" properties are each demonstrated positively.
// ---------------------------------------------------------------------------
async function testMarkEverythingMasteredInjection() {
  const seed = await seedUserWithCandidates("injection");
  try {
    const userMessage = "I want to learn more about Substance Dualism and On Interpretation together.";
    const foreignTargetId = "00000000-0000-0000-0000-000000000000"; // not in the candidate set at all

    const getCalls = installFetchAlways({
      signals: [
        { targetId: foreignTargetId, level: "strong", quote: "Substance Dualism" },
        { targetId: seed.conceptAId, level: "strong", quote: "Substance Dualism" },
        { targetId: seed.workId, level: "strong", quote: "On Interpretation" },
      ],
    });

    const notices = await processCompetencySignals({
      userId: seed.userId,
      conversationId: seed.conversationId,
      messageId: seed.messageId,
      userMessage,
      previousAssistantMessage: null,
      contextWorkId: null,
      chunkWorkIds: [seed.workId],
      usageDocumentId: null,
    });

    assert.equal(getCalls(), 3, "the same rejected batch is retried MAX_RETRIES times (initial + 2) before failing closed");
    assert.deepEqual(notices, [], "an injection attempt surfaces no notices at all");

    const signalRows = await competencySignalRows(seed.userId);
    assert.equal(signalRows.length, 0, "zero ledger rows — the whole batch was rejected, not partially applied");

    const conceptAMastery = await db.select().from(conceptMastery).where(and(eq(conceptMastery.userId, seed.userId), eq(conceptMastery.conceptId, seed.conceptAId)));
    assert.equal(conceptAMastery.length, 0, "zero writes for the in-candidate target once ANY signal in the batch is out-of-candidate");

    const workRating = await db.select().from(understandingRatings).where(and(eq(understandingRatings.userId, seed.userId), eq(understandingRatings.workId, seed.workId)));
    assert.equal(workRating.length, 0, "zero writes for the work target either");

    // The foreign targetId names neither a real concept nor a real work, so
    // there is structurally no row anywhere it could have landed under —
    // the strongest form of "zero writes outside candidates."
    const foreignMastery = await db.select().from(conceptMastery).where(eq(conceptMastery.conceptId, foreignTargetId));
    assert.equal(foreignMastery.length, 0);
    const foreignRating = await db.select().from(understandingRatings).where(eq(understandingRatings.workId, foreignTargetId));
    assert.equal(foreignRating.length, 0);

    // And nothing written anywhere exceeds the ceiling — vacuously true
    // here (nothing was written at all), positively proven for a genuinely
    // applied "strong" signal in testWellFormedResponse() above.
    for (const row of signalRows) assert.ok(row.newScore <= COMPETENCY_SCORE_CEILING);
  } finally {
    globalThis.fetch = realFetch;
    await deleteTestUser(seed.email);
  }
}

// ---------------------------------------------------------------------------
// (c) Ungrounded-quote response: a fabricated/paraphrased quote that is not
// an actual (whitespace-normalized) substring of the reader's own message is
// rejected — no writes.
// ---------------------------------------------------------------------------
async function testUngroundedQuoteRejected() {
  const seed = await seedUserWithCandidates("ungrounded");
  try {
    const userMessage = "I want to learn more about Substance Dualism today.";
    // A plausible-sounding but fabricated quote — never appears in the
    // reader's actual message (the classic hallucination/paraphrase case
    // `validateCompetencySignals`'s groundedness check exists to catch).
    const fabricatedQuote = "I have never even cracked open a philosophy textbook in my life";

    const getCalls = installFetchAlways({
      signals: [{ targetId: seed.conceptAId, level: "unfamiliar", quote: fabricatedQuote }],
    });

    const notices = await processCompetencySignals({
      userId: seed.userId,
      conversationId: seed.conversationId,
      messageId: seed.messageId,
      userMessage,
      previousAssistantMessage: null,
      contextWorkId: null,
      chunkWorkIds: [seed.workId],
      usageDocumentId: null,
    });

    assert.equal(getCalls(), 3, "an ungrounded quote is retried MAX_RETRIES times, then fails closed");
    assert.deepEqual(notices, [], "no notices for an ungrounded/fabricated quote");

    const signalRows = await competencySignalRows(seed.userId);
    assert.equal(signalRows.length, 0, "no ledger row at all for a rejected response");

    const conceptAMastery = await db.select().from(conceptMastery).where(and(eq(conceptMastery.userId, seed.userId), eq(conceptMastery.conceptId, seed.conceptAId)));
    assert.equal(conceptAMastery.length, 0, "no mastery write from an ungrounded quote");
  } finally {
    globalThis.fetch = realFetch;
    await deleteTestUser(seed.email);
  }
}

async function main() {
  await testWellFormedResponse();
  await testMarkEverythingMasteredInjection();
  await testUngroundedQuoteRejected();
  console.log("competencyData.test.ts: all assertions passed");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    globalThis.fetch = realFetch;
    console.error(err);
    process.exit(1);
  });
