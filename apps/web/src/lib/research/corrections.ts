import { isClaimNature } from "@ice/claims";
import { db, researchClaims, researchCorpusItems, researchRevisions, textBlocks } from "@ice/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

/**
 * The user correction workflow for every research object (Phase 29.2, plan
 * §Web surfaces "PATCH routes follow the annotation route verbatim ...
 * mandatory revision write"). `applyResearchCorrection` is the ONLY
 * mutation path into `research_revision` from the web side — every API
 * route in `api/research/**` that lets a user verify/dispute/edit/hide/
 * restore/reclassify/split/merge a research object delegates here, never
 * writes `research_claim`/`claim_relationship`/etc directly. Each call is
 * ONE Postgres transaction: the object update and its `research_revision`
 * row land together or not at all.
 *
 * `evidence_chamber_position` deliberately has NO independent mutation
 * surface here (no `objectType: "position"` variant below) even though
 * `research_revision` reserves a typed slot for it: unlike the other six
 * object types, `evidence_chamber_position` carries no `verification_status`/
 * `hidden` column of its own (schema §Phase 27.1 — a chamber's neutral
 * comparison is reviewed as a whole via `objectType: "chamber"`), so there
 * is nothing position-scoped for a correction to persist yet. Adding one
 * needs a schema change, out of scope for this lane.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Who authored a correction. Deliberately has NO `"system"` member — the
 * DB-level half of this guarantee is `research_revision_no_auto_endorsement`
 * (only the immutable `generated` snapshot may carry `editor = 'system'`);
 * this type is the TypeScript-level half, verified never to include
 * `"system"` by `corrections.test.ts`'s compile-time assertion. Every call
 * site in this program is a human acting through the API (`editor: "user"`
 * from the authenticated session); `"editor"` is reserved for a future
 * curator role and is not wired to any UI yet.
 */
export type CorrectionEditor = "user" | "editor";

export type ResearchObjectType = "claim" | "relationship" | "cluster" | "chamber" | "hypothesis" | "gap";

/** Mirrors `research_revision_action` minus `"generated"` (the system-only,
 *  immutable snapshot action — never producible through this module, see
 *  `CorrectionEditor` above). */
export type StatusAction = "verified" | "disputed" | "hidden" | "restored";
export type ClaimOnlyAction = "edited" | "reclassified" | "split" | "merged";
export type ResearchCorrectionAction = StatusAction | ClaimOnlyAction;

interface CorrectionBase {
  userId: string;
  editor: CorrectionEditor;
  reason?: string;
}

export type ApplyResearchCorrectionInput =
  | (CorrectionBase & { objectType: "claim"; objectId: string; action: StatusAction })
  | (CorrectionBase & {
      objectType: "claim";
      objectId: string;
      action: "edited";
      changes: { claimText?: string; supportingExcerpt?: string };
    })
  | (CorrectionBase & { objectType: "claim"; objectId: string; action: "reclassified"; changes: { claimNature: string } })
  | (CorrectionBase & {
      objectType: "claim";
      objectId: string;
      action: "split";
      changes: { excerpts: string[]; claimTexts?: string[] };
    })
  | (CorrectionBase & {
      objectType: "claim";
      objectId: string;
      action: "merged";
      changes: { otherClaimIds: string[]; claimText: string; supportingExcerpt: string };
    })
  | (CorrectionBase & { objectType: "relationship"; objectId: string; action: StatusAction })
  | (CorrectionBase & { objectType: "cluster"; objectId: string; action: StatusAction })
  | (CorrectionBase & { objectType: "chamber"; objectId: string; action: StatusAction })
  | (CorrectionBase & { objectType: "hypothesis"; objectId: string; action: StatusAction })
  | (CorrectionBase & { objectType: "gap"; objectId: string; action: StatusAction });

interface CorrectionSuccess {
  objectType: ResearchObjectType;
  objectId: string;
  revision: number;
  /** Set only for `split` (the new parts) and `merged` (the one new row). */
  newClaimIds?: string[];
}

export type ApplyResearchCorrectionResult =
  | ({ ok: true } & CorrectionSuccess)
  | { ok: false; error: "not_found" | "invalid"; message?: string };

/** Thrown by every internal helper on a validation/ownership failure;
 *  `applyResearchCorrection` is the only place that catches it and turns it
 *  into the `{ ok: false, ... }` shape above. Letting it propagate as a
 *  throw (rather than an early `return`) after a write has already been
 *  attempted inside the transaction guarantees Postgres rolls the whole
 *  transaction back — never a partial object update with no matching
 *  revision row, or vice versa. */
class ResearchCorrectionError extends Error {
  constructor(
    public readonly kind: "not_found" | "invalid",
    message?: string,
  ) {
    super(message ?? kind);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

const TABLE_NAME: Record<ResearchObjectType, string> = {
  claim: "research_claim",
  relationship: "claim_relationship",
  cluster: "debate_cluster",
  chamber: "evidence_chamber",
  hypothesis: "research_hypothesis",
  gap: "research_gap",
};

type RevisionFkField =
  | "researchClaimId"
  | "claimRelationshipId"
  | "debateClusterId"
  | "evidenceChamberId"
  | "researchHypothesisId"
  | "researchGapId";

const REVISION_FK_FIELD: Record<ResearchObjectType, RevisionFkField> = {
  claim: "researchClaimId",
  relationship: "claimRelationshipId",
  cluster: "debateClusterId",
  chamber: "evidenceChamberId",
  hypothesis: "researchHypothesisId",
  gap: "researchGapId",
};

/** Sentinel `prompt_version` values marking a `research_claim` row as
 *  human-authored by this correction workflow rather than a real pipeline
 *  extraction run — the `annotation.promptVersion: "heuristic"` precedent,
 *  applied to distinguish user-typed claim text from model output. Never
 *  reused by the extraction pipeline itself. */
const CORRECTION_PROMPT_VERSION = {
  edited: "research-correction-edited-v1",
  split: "research-correction-split-v1",
  merged: "research-correction-merged-v1",
} as const;

function normalizeClaimText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** Mirrors `apps/worker/src/research/extractClaims.ts`'s `claimContentHash`
 *  exactly (duplicated rather than imported: that module lives in
 *  `apps/worker`, which `apps/web` does not depend on, and the function is
 *  two lines of pure `node:crypto`). Keeping the two in lockstep is the
 *  same hand-kept-in-sync discipline `claim_nature`'s schema doc comment
 *  already documents for `@ice/claims`'s `CLAIM_NATURES` vs the DB enum. */
function claimContentHash(text: string): string {
  return createHash("sha256").update(normalizeClaimText(text)).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  const direct = err && typeof err === "object" && "code" in err ? (err as { code?: unknown }).code : undefined;
  const cause = err instanceof Error ? err.cause : undefined;
  const nested = cause && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : undefined;
  return direct === "23505" || nested === "23505";
}

/** Owner-scoped `SELECT *` for one of the six status-bearing tables, keyed
 *  by the shared `TABLE_NAME` map. Used both to load the pre-correction
 *  snapshot and to re-read the post-correction one, so `before`/`after` are
 *  always built from the same shape. Raw SQL (not per-table typed
 *  `drizzle` selects) is deliberate here: all six tables share the exact
 *  four columns this module's generic status actions ever touch
 *  (`verification_status`/`hidden`/`updated_at`, plus every column for the
 *  snapshot), so one function keyed by table name avoids six near-identical
 *  typed branches — the same `lib/research/chambers.ts` `db.execute(sql...)`
 *  precedent this file's own doc comment cites. */
async function loadOwnedRow(tx: Tx, objectType: ResearchObjectType, objectId: string, userId: string): Promise<Record<string, unknown> | null> {
  const table = sql.raw(TABLE_NAME[objectType]);
  const result = await tx.execute(sql`SELECT * FROM ${table} WHERE id = ${objectId} AND user_id = ${userId} LIMIT 1`);
  const rows = result as unknown as Record<string, unknown>[];
  return rows[0] ?? null;
}

/**
 * Writes ONE `research_revision` row for `objectId`, computing its
 * monotonic revision number from the current max for that object.
 *
 * `isNewObject: true` (split/merge's newly-created claim rows) skips the
 * lookup entirely — a row that did not exist before this transaction can
 * never have prior revisions, and its own first revision IS this action
 * (never a backfilled system snapshot).
 *
 * Otherwise: if this object has no revision history yet (every case except
 * `research_hypothesis`/`research_gap`, whose worker-side generation already
 * writes an immutable `revision = 0` / `action = 'generated'` snapshot —
 * `apps/worker/src/research/repository.ts`'s `insertGeneratedHypothesisRevision`/
 * `insertGeneratedGapRevision`), this retroactively backfills that same
 * shape (the object's state as loaded, before this correction, `editor:
 * "system"`) as revision 0, so "revision 0 is always the generated
 * snapshot" stays true for every object type, not just the two the worker
 * already wires — then the human correction itself becomes revision 1.
 * A concurrent correction against the same object can race this read; the
 * per-type partial unique index `(<object>_id, revision)` on
 * `research_revision` is the actual enforcement, and `applyResearchCorrection`
 * retries on exactly that unique-violation.
 */
async function writeRevision(
  tx: Tx,
  args: {
    userId: string;
    objectType: ResearchObjectType;
    objectId: string;
    action: ResearchCorrectionAction;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
    editor: CorrectionEditor;
    reason: string | null;
    relatedObjectIds?: string[] | null;
    isNewObject?: boolean;
  },
): Promise<number> {
  const fkField = REVISION_FK_FIELD[args.objectType];

  if (args.isNewObject) {
    await tx.insert(researchRevisions).values({
      userId: args.userId,
      objectType: args.objectType,
      revision: 0,
      action: args.action,
      before: null,
      after: args.after,
      editor: args.editor,
      editorUserId: args.userId,
      reason: args.reason,
      relatedObjectIds: args.relatedObjectIds ?? null,
      [fkField]: args.objectId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- computed FK column key, narrowed by the `as` cast on `.values(...)`.
    } as any);
    return 0;
  }

  const existing = await tx
    .select({ revision: researchRevisions.revision })
    .from(researchRevisions)
    .where(eq(researchRevisions[fkField], args.objectId))
    .orderBy(desc(researchRevisions.revision))
    .limit(1);

  let nextRevision: number;
  if (existing.length === 0) {
    await tx.insert(researchRevisions).values({
      userId: args.userId,
      objectType: args.objectType,
      revision: 0,
      action: "generated",
      before: null,
      after: args.before,
      editor: "system",
      [fkField]: args.objectId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- computed FK column key, narrowed by the `as` cast on `.values(...)`.
    } as any);
    nextRevision = 1;
  } else {
    nextRevision = existing[0].revision + 1;
  }

  await tx.insert(researchRevisions).values({
    userId: args.userId,
    objectType: args.objectType,
    revision: nextRevision,
    action: args.action,
    before: args.before,
    after: args.after,
    editor: args.editor,
    editorUserId: args.userId,
    reason: args.reason,
    relatedObjectIds: args.relatedObjectIds ?? null,
    [fkField]: args.objectId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- computed FK column key, narrowed by the `as` cast on `.values(...)`.
  } as any);

  return nextRevision;
}

// ---------------------------------------------------------------------------
// Generic status actions (verify / dispute / hide / restore) — all six types
// ---------------------------------------------------------------------------

async function applyGenericStatusCorrection(
  tx: Tx,
  input: { userId: string; objectType: ResearchObjectType; objectId: string; action: StatusAction; editor: CorrectionEditor; reason?: string },
): Promise<CorrectionSuccess> {
  const before = await loadOwnedRow(tx, input.objectType, input.objectId, input.userId);
  if (!before) throw new ResearchCorrectionError("not_found");
  if (before.status === "superseded") {
    throw new ResearchCorrectionError("invalid", "This item has been superseded and can no longer be corrected.");
  }

  const sets = [sql`updated_at = now()`];
  if (input.action === "verified") sets.push(sql`verification_status = 'user_verified'`);
  else if (input.action === "disputed") sets.push(sql`verification_status = 'disputed'`);
  else if (input.action === "hidden") sets.push(sql`hidden = true`);
  else if (input.action === "restored") sets.push(sql`hidden = false`);

  const table = sql.raw(TABLE_NAME[input.objectType]);
  await tx.execute(sql`UPDATE ${table} SET ${sql.join(sets, sql`, `)} WHERE id = ${input.objectId}`);

  const after = await loadOwnedRow(tx, input.objectType, input.objectId, input.userId);
  const revision = await writeRevision(tx, {
    userId: input.userId,
    objectType: input.objectType,
    objectId: input.objectId,
    action: input.action,
    before,
    after: after as Record<string, unknown>,
    editor: input.editor,
    reason: input.reason ?? null,
  });
  return { objectType: input.objectType, objectId: input.objectId, revision };
}

// ---------------------------------------------------------------------------
// Claim-only actions
// ---------------------------------------------------------------------------

/** Resolves the live source text a claim's excerpt should be checked
 *  against: the currently-anchored text block's own text, or — for a
 *  corpus-item claim — the imported record's abstract. Null when neither
 *  applies (an already-`unanchored` claim with nothing live to check
 *  against), in which case the caller falls back to checking the edit
 *  against the claim's OWN previously-verified excerpt instead. */
async function resolveClaimSourceText(tx: Tx, claim: typeof researchClaims.$inferSelect): Promise<string | null> {
  if (claim.textBlockId) {
    const [block] = await tx.select({ text: textBlocks.text }).from(textBlocks).where(eq(textBlocks.id, claim.textBlockId)).limit(1);
    return block?.text ?? null;
  }
  if (claim.sourceScope === "abstract" && claim.corpusItemId) {
    const [item] = await tx.select({ abstract: researchCorpusItems.abstract }).from(researchCorpusItems).where(eq(researchCorpusItems.id, claim.corpusItemId)).limit(1);
    return item?.abstract ?? null;
  }
  return null;
}

type ClaimUpdate = Partial<typeof researchClaims.$inferInsert>;

/**
 * `edited`: claimText and/or supportingExcerpt. A claimText change flips
 * `promptVersion` to the correction sentinel (never presented as the
 * original model's own wording — the annotation-edit `createdBy: "user"`
 * precedent) and recomputes `contentHash`. A supportingExcerpt change is
 * ALWAYS accepted (never rejected outright), but is re-verified against the
 * live source text first: a match keeps `excerptVerified = true`; a
 * mismatch — or no live source left to check against, weighed against the
 * claim's OWN previously-verified excerpt instead — sets
 * `excerptVerified = false` AND `anchorState = 'unanchored'` (nulling
 * `textBlockId`, satisfying `research_claim_unanchored_no_block`), "never
 * silently" per the plan: the caller (the API route → UI) always sees this
 * downgrade reflected in the returned/re-fetched claim, never a quiet no-op.
 */
async function computeClaimEditUpdate(
  tx: Tx,
  claim: typeof researchClaims.$inferSelect,
  changes: { claimText?: string; supportingExcerpt?: string },
): Promise<ClaimUpdate> {
  if (changes.claimText === undefined && changes.supportingExcerpt === undefined) {
    throw new ResearchCorrectionError("invalid", "Provide claimText and/or supportingExcerpt to edit.");
  }
  const update: ClaimUpdate = {};

  if (changes.claimText !== undefined) {
    const claimText = changes.claimText.trim();
    if (!claimText) throw new ResearchCorrectionError("invalid", "claimText cannot be empty.");
    update.claimText = claimText;
    update.contentHash = claimContentHash(claimText);
    update.promptVersion = CORRECTION_PROMPT_VERSION.edited;
  }

  if (changes.supportingExcerpt !== undefined) {
    const excerpt = changes.supportingExcerpt.trim();
    if (!excerpt) throw new ResearchCorrectionError("invalid", "supportingExcerpt cannot be empty.");
    const sourceText = await resolveClaimSourceText(tx, claim);
    const matchesLiveSource = sourceText !== null ? sourceText.includes(excerpt) : claim.supportingExcerpt.includes(excerpt);
    update.supportingExcerpt = excerpt;
    if (matchesLiveSource) {
      update.excerptVerified = true;
    } else {
      update.excerptVerified = false;
      update.anchorState = "unanchored";
      update.textBlockId = null;
    }
  }

  return update;
}

async function applyClaimFieldEdit(
  tx: Tx,
  input: Extract<ApplyResearchCorrectionInput, { objectType: "claim"; action: "edited" | "reclassified" }>,
): Promise<CorrectionSuccess> {
  const [claim] = await tx
    .select()
    .from(researchClaims)
    .where(and(eq(researchClaims.id, input.objectId), eq(researchClaims.userId, input.userId)))
    .limit(1);
  if (!claim) throw new ResearchCorrectionError("not_found");
  if (claim.status === "superseded") throw new ResearchCorrectionError("invalid", "This claim has been superseded and can no longer be corrected.");

  let update: ClaimUpdate = { updatedAt: new Date() };
  if (input.action === "reclassified") {
    if (!isClaimNature(input.changes.claimNature)) throw new ResearchCorrectionError("invalid", "Unknown claim nature.");
    update.claimNature = input.changes.claimNature;
  } else {
    update = { ...update, ...(await computeClaimEditUpdate(tx, claim, input.changes)) };
  }

  let updatedRow: typeof researchClaims.$inferSelect;
  try {
    const [row] = await tx.update(researchClaims).set(update).where(eq(researchClaims.id, input.objectId)).returning();
    updatedRow = row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ResearchCorrectionError("invalid", "Another claim with this exact text already exists for this work.");
    throw err;
  }

  const revision = await writeRevision(tx, {
    userId: input.userId,
    objectType: "claim",
    objectId: input.objectId,
    action: input.action,
    before: claim as unknown as Record<string, unknown>,
    after: updatedRow as unknown as Record<string, unknown>,
    editor: input.editor,
    reason: input.reason ?? null,
  });
  return { objectType: "claim", objectId: input.objectId, revision };
}

/**
 * `split`: one claim becomes 2+ narrower claims (plan §Build "SPLIT (claims
 * only): creates 2+ new claim rows ... same anchors/excerpt constraints
 * enforced — a split claim keeps the parent's supporting_excerpt or a
 * user-selected substring of it, validated as a literal substring"). Every
 * new claim inherits the parent's anchor verbatim (`quote`/`prefix`/
 * `suffix`/`textBlockId`/`anchorState`) — a split narrows WHICH excerpt a
 * claim cites, never re-locates it — and each excerpt is checked as a
 * literal substring of the PARENT's own already-verified excerpt (the same
 * zero-tolerance discipline the extraction pipeline itself uses, applied to
 * a user-driven split instead of a model call). `claimText` defaults to the
 * excerpt itself (never fabricated wording) unless the caller supplies
 * `claimTexts` one-for-one. The parent is marked `superseded`, never
 * deleted; `related_object_ids` records the link both ways.
 */
async function applyClaimSplit(
  tx: Tx,
  input: Extract<ApplyResearchCorrectionInput, { objectType: "claim"; action: "split" }>,
): Promise<CorrectionSuccess> {
  const [parent] = await tx
    .select()
    .from(researchClaims)
    .where(and(eq(researchClaims.id, input.objectId), eq(researchClaims.userId, input.userId)))
    .limit(1);
  if (!parent) throw new ResearchCorrectionError("not_found");
  if (parent.status === "superseded") throw new ResearchCorrectionError("invalid", "This claim has already been split or merged.");

  const excerpts = (input.changes.excerpts ?? []).map((e) => e.trim()).filter((e) => e.length > 0);
  if (excerpts.length < 2) throw new ResearchCorrectionError("invalid", "A split needs at least two non-empty excerpts.");
  const claimTexts = input.changes.claimTexts?.map((t) => t.trim());
  if (claimTexts && claimTexts.length !== excerpts.length) {
    throw new ResearchCorrectionError("invalid", "claimTexts must match excerpts one-for-one when provided.");
  }
  for (const excerpt of excerpts) {
    if (!parent.supportingExcerpt.includes(excerpt)) {
      throw new ResearchCorrectionError("invalid", `"${excerpt}" is not a literal substring of the original claim's supporting excerpt.`);
    }
  }

  const texts = excerpts.map((excerpt, i) => (claimTexts ? claimTexts[i] : excerpt));
  const hashes = texts.map(claimContentHash);
  if (new Set(hashes).size !== hashes.length) {
    throw new ResearchCorrectionError("invalid", "Split parts must have distinct claim text.");
  }

  const insertValues = texts.map((claimText, i) => ({
    userId: input.userId,
    workId: parent.workId,
    corpusItemId: parent.corpusItemId,
    processingRunId: parent.processingRunId,
    textBlockId: parent.textBlockId,
    quote: parent.quote,
    prefix: parent.prefix,
    suffix: parent.suffix,
    anchorState: parent.anchorState,
    claimText,
    claimNature: parent.claimNature,
    claimRole: parent.claimRole,
    confidence: parent.confidence,
    section: parent.section,
    sourceScope: parent.sourceScope,
    supportingExcerpt: excerpts[i],
    excerptVerified: true,
    contentHash: hashes[i],
    promptVersion: CORRECTION_PROMPT_VERSION.split,
    status: "active" as const,
    verificationStatus: "user_verified" as const,
    hidden: false,
  }));

  let newClaims: (typeof researchClaims.$inferSelect)[];
  try {
    newClaims = await tx.insert(researchClaims).values(insertValues).returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ResearchCorrectionError("invalid", "One of the split parts duplicates an existing claim's text for this work.");
    throw err;
  }
  const newClaimIds = newClaims.map((c) => c.id);

  await tx.update(researchClaims).set({ status: "superseded", updatedAt: new Date() }).where(eq(researchClaims.id, parent.id));

  const parentRevision = await writeRevision(tx, {
    userId: input.userId,
    objectType: "claim",
    objectId: parent.id,
    action: "split",
    before: parent as unknown as Record<string, unknown>,
    after: { ...parent, status: "superseded" } as unknown as Record<string, unknown>,
    editor: input.editor,
    reason: input.reason ?? null,
    relatedObjectIds: newClaimIds,
  });

  for (const child of newClaims) {
    await writeRevision(tx, {
      userId: input.userId,
      objectType: "claim",
      objectId: child.id,
      action: "split",
      before: null,
      after: child as unknown as Record<string, unknown>,
      editor: input.editor,
      reason: input.reason ?? null,
      relatedObjectIds: [parent.id, ...newClaimIds.filter((id) => id !== child.id)],
      isNewObject: true,
    });
  }

  return { objectType: "claim", objectId: parent.id, revision: parentRevision, newClaimIds };
}

/**
 * `merged`: 2+ claims become one (plan §Build "MERGE (claims only): inverse
 * — new merged claim (user-authored), originals superseded"). Every
 * constituent must belong to the SAME work/corpus-item (a merged claim, like
 * every claim, has exactly one source — `research_claim_exactly_one_source`)
 * and must still be `active`. The merged `supportingExcerpt` must be a
 * literal substring of at least one constituent's own excerpt — the same
 * zero-tolerance guard `applyClaimSplit` uses, applied in the other
 * direction (never inventing text no constituent actually carried) — and
 * the merged claim inherits its anchor from whichever constituent's excerpt
 * it matched.
 */
async function applyClaimMerge(
  tx: Tx,
  input: Extract<ApplyResearchCorrectionInput, { objectType: "claim"; action: "merged" }>,
): Promise<CorrectionSuccess> {
  const allIds = [input.objectId, ...input.changes.otherClaimIds];
  if (new Set(allIds).size !== allIds.length) throw new ResearchCorrectionError("invalid", "Duplicate claim id in merge set.");
  if (allIds.length < 2) throw new ResearchCorrectionError("invalid", "A merge needs at least two claims.");

  const constituents = await tx
    .select()
    .from(researchClaims)
    .where(and(inArray(researchClaims.id, allIds), eq(researchClaims.userId, input.userId)));
  if (constituents.length !== allIds.length) throw new ResearchCorrectionError("not_found");
  if (constituents.some((c) => c.status === "superseded")) {
    throw new ResearchCorrectionError("invalid", "One of these claims has already been split or merged.");
  }

  const primary = constituents.find((c) => c.id === input.objectId);
  if (!primary) throw new ResearchCorrectionError("not_found");
  const sameSource = constituents.every((c) => c.workId === primary.workId && c.corpusItemId === primary.corpusItemId);
  if (!sameSource) throw new ResearchCorrectionError("invalid", "Only claims from the same work can be merged.");

  const claimText = input.changes.claimText.trim();
  const supportingExcerpt = input.changes.supportingExcerpt.trim();
  if (!claimText) throw new ResearchCorrectionError("invalid", "claimText cannot be empty.");
  if (!supportingExcerpt) throw new ResearchCorrectionError("invalid", "supportingExcerpt cannot be empty.");

  const sourceConstituent = constituents.find((c) => c.supportingExcerpt.includes(supportingExcerpt));
  if (!sourceConstituent) {
    throw new ResearchCorrectionError("invalid", "The merged excerpt must be a literal substring of one of the original claims' supporting excerpts.");
  }

  const contentHash = claimContentHash(claimText);
  let merged: typeof researchClaims.$inferSelect;
  try {
    const [row] = await tx
      .insert(researchClaims)
      .values({
        userId: input.userId,
        workId: primary.workId,
        corpusItemId: primary.corpusItemId,
        processingRunId: primary.processingRunId,
        textBlockId: sourceConstituent.textBlockId,
        quote: sourceConstituent.quote,
        prefix: sourceConstituent.prefix,
        suffix: sourceConstituent.suffix,
        anchorState: sourceConstituent.anchorState,
        claimText,
        claimNature: primary.claimNature,
        claimRole: primary.claimRole,
        confidence: primary.confidence,
        section: primary.section,
        sourceScope: primary.sourceScope,
        supportingExcerpt,
        excerptVerified: true,
        contentHash,
        promptVersion: CORRECTION_PROMPT_VERSION.merged,
        status: "active",
        verificationStatus: "user_verified",
        hidden: false,
      })
      .returning();
    merged = row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ResearchCorrectionError("invalid", "A claim with this exact text already exists for this work.");
    throw err;
  }

  for (const constituent of constituents) {
    await tx.update(researchClaims).set({ status: "superseded", updatedAt: new Date() }).where(eq(researchClaims.id, constituent.id));
    await writeRevision(tx, {
      userId: input.userId,
      objectType: "claim",
      objectId: constituent.id,
      action: "merged",
      before: constituent as unknown as Record<string, unknown>,
      after: { ...constituent, status: "superseded" } as unknown as Record<string, unknown>,
      editor: input.editor,
      reason: input.reason ?? null,
      relatedObjectIds: [merged.id, ...allIds.filter((id) => id !== constituent.id)],
    });
  }

  const mergedRevision = await writeRevision(tx, {
    userId: input.userId,
    objectType: "claim",
    objectId: merged.id,
    action: "merged",
    before: null,
    after: merged as unknown as Record<string, unknown>,
    editor: input.editor,
    reason: input.reason ?? null,
    relatedObjectIds: allIds,
    isNewObject: true,
  });

  return { objectType: "claim", objectId: merged.id, revision: mergedRevision, newClaimIds: [merged.id] };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

async function dispatchCorrection(tx: Tx, input: ApplyResearchCorrectionInput): Promise<CorrectionSuccess> {
  if (input.objectType === "claim") {
    if (input.action === "split") return applyClaimSplit(tx, input);
    if (input.action === "merged") return applyClaimMerge(tx, input);
    if (input.action === "edited" || input.action === "reclassified") return applyClaimFieldEdit(tx, input);
    return applyGenericStatusCorrection(tx, { ...input, action: input.action });
  }
  return applyGenericStatusCorrection(tx, input);
}

/** Single-attempt core, exported for atomicity tests: a failure here (a
 *  thrown `ResearchCorrectionError` OR a raw Postgres constraint violation)
 *  always rolls back the whole transaction, object update included — never
 *  a persisted status/field change with no matching revision row. The
 *  public `applyResearchCorrection` below wraps this with a small
 *  retry-on-revision-race loop; this function does not retry. */
export async function applyResearchCorrectionOnce(input: ApplyResearchCorrectionInput): Promise<ApplyResearchCorrectionResult> {
  try {
    const success = await db.transaction((tx) => dispatchCorrection(tx, input));
    return { ok: true, ...success };
  } catch (err) {
    if (err instanceof ResearchCorrectionError) return { ok: false, error: err.kind, message: err.message };
    throw err;
  }
}

const MAX_REVISION_RACE_ATTEMPTS = 5;

/**
 * The ONE mutation path into every research object's correction state (plan
 * §Build "applyResearchCorrection is the ONLY mutation path"). Retries up to
 * `MAX_REVISION_RACE_ATTEMPTS` times ONLY when two rapid corrections against
 * the SAME object race `writeRevision`'s own "next revision number" read —
 * caught as a raw Postgres unique-violation on `research_revision`'s
 * per-type `(<object>_id, revision)` index, distinct from (and checked
 * after) every validation failure, which `applyResearchCorrectionOnce`
 * already converts to `{ ok: false, ... }` and which this function returns
 * immediately without retrying (retrying a genuine duplicate-text edit, for
 * instance, would never succeed).
 */
export async function applyResearchCorrection(input: ApplyResearchCorrectionInput): Promise<ApplyResearchCorrectionResult> {
  for (let attempt = 1; attempt <= MAX_REVISION_RACE_ATTEMPTS; attempt++) {
    try {
      return await applyResearchCorrectionOnce(input);
    } catch (err) {
      if (attempt < MAX_REVISION_RACE_ATTEMPTS && isUniqueViolation(err)) continue;
      throw err;
    }
  }
  /* istanbul ignore next -- unreachable: the loop above always returns or throws. */
  throw new Error("applyResearchCorrection: unreachable");
}

// ---------------------------------------------------------------------------
// Read path — the revision-history drawer
// ---------------------------------------------------------------------------

export interface ResearchRevisionRow {
  id: string;
  revision: number;
  action: string;
  before: unknown;
  after: unknown;
  editor: string;
  editorUserId: string | null;
  reason: string | null;
  relatedObjectIds: unknown;
  createdAt: Date;
}

/**
 * Owner-scoped, chronological revision history for one object — the
 * history drawer's whole data source. `research_revision.user_id` is set to
 * the object's owner on every write this module makes (see
 * `writeRevision`), so filtering on it alone is sufficient ownership proof
 * without a second join back to the target table: a revision row can only
 * ever exist for an object `userId` already owned at write time, matching
 * the rest of `lib/research/*`'s "no distinguishable 403" posture — an
 * object that isn't the caller's own returns an empty list, identical to
 * one with no history yet.
 */
export async function listResearchRevisions(userId: string, objectType: ResearchObjectType, objectId: string): Promise<ResearchRevisionRow[]> {
  const fkField = REVISION_FK_FIELD[objectType];
  const rows = await db
    .select({
      id: researchRevisions.id,
      revision: researchRevisions.revision,
      action: researchRevisions.action,
      before: researchRevisions.before,
      after: researchRevisions.after,
      editor: researchRevisions.editor,
      editorUserId: researchRevisions.editorUserId,
      reason: researchRevisions.reason,
      relatedObjectIds: researchRevisions.relatedObjectIds,
      createdAt: researchRevisions.createdAt,
    })
    .from(researchRevisions)
    .where(and(eq(researchRevisions.userId, userId), eq(researchRevisions[fkField], objectId)))
    .orderBy(asc(researchRevisions.revision));
  return rows;
}
