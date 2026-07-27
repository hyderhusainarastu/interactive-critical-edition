/**
 * The ONE canonical `research_job_request.scope` contract, for every
 * `research_job_type` value, imported by BOTH sides of the boundary: the web
 * app's dispatch functions (`apps/web/src/lib/research/*.ts`, which build a
 * scope object and INSERT it) and the worker's job handlers
 * (`apps/worker/src/research/*.ts`, which SELECT that same jsonb column back
 * and parse it before running). Before this module existed, each side had
 * its own hand-rolled idea of the shape (`apps/worker/src/research/
 * extractClaims.ts`'s `parseExtractClaimsScope` expected `{workId}` while
 * `apps/web/src/lib/research/jobs.ts`'s `dispatchExtractClaimsJob` actually
 * wrote `{workIds: [workId]}` — a real production defect, D-25-14: any
 * "Extract claims" dispatch for an uploaded work fell into the worker's
 * catch-all "scope didn't parse" branch, which at the time only had a
 * corpus-item-not-implemented message to show, so the owner saw a
 * completely unrelated error for an ordinary work extraction). Both sides
 * importing the SAME parse function from the SAME module makes that class of
 * drift structurally impossible to reintroduce silently — a shape either
 * side constructs is validated by the identical logic the other side reads
 * it with, proven by `scope.test.ts`'s build→parse round-trip for every
 * job type.
 *
 * Deliberately hand-rolled runtime type guards, not zod: `@ice/claims`'s own
 * top-of-package doc comment (`index.ts` — "zero runtime dependencies") is a
 * real constraint this module must not violate just because zod happens to
 * already be a dependency of `apps/web`. Every `parse*Scope` function follows
 * the exact defensive-cast idiom every worker handler already used locally
 * before this module existed (`scope as {field?: unknown} | null`), just
 * centralized instead of duplicated seven times.
 */

// ---------------------------------------------------------------------------
// extract_claims
// ---------------------------------------------------------------------------

export interface ExtractClaimsWorkScope {
  workId: string;
}

export interface ExtractClaimsCorpusItemScope {
  corpusItemId: string;
}

export type ExtractClaimsScope = ExtractClaimsWorkScope | ExtractClaimsCorpusItemScope;

export function isExtractClaimsWorkScope(scope: ExtractClaimsScope): scope is ExtractClaimsWorkScope {
  return "workId" in scope;
}

export function parseExtractClaimsScope(scope: unknown): ExtractClaimsScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { workId?: unknown; corpusItemId?: unknown };
  if (typeof s.workId === "string" && s.workId.length > 0) return { workId: s.workId };
  if (typeof s.corpusItemId === "string" && s.corpusItemId.length > 0) return { corpusItemId: s.corpusItemId };
  return null;
}

/**
 * Recognizes the specific PRE-FIX shape (`apps/web/src/lib/research/jobs.ts`'s
 * old `dispatchExtractClaimsJob` bug, D-25-14): `{ workIds: string[] }`, an
 * array under the plural key, with neither of the canonical singular keys
 * present. Distinguished from a merely malformed/unrecognized scope so the
 * worker can report a clear, actionable "this row predates the scope-shape
 * fix" error instead of a generic parse failure — any `research_job_request`
 * row already queued/failed with this exact shape before the fix shipped is
 * recognizably explained, not silently re-attempted forever nor blamed on an
 * unrelated unimplemented feature.
 */
export function isLegacyWorkIdsArrayScope(scope: unknown): boolean {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return false;
  const s = scope as { workIds?: unknown; workId?: unknown; corpusItemId?: unknown };
  return Array.isArray(s.workIds) && s.workId === undefined && s.corpusItemId === undefined;
}

// ---------------------------------------------------------------------------
// detect_relationships / cluster_debates — identical shape, kept as two
// named types (rather than one shared alias) since the two job types are
// conceptually distinct even though their scope happens to coincide today.
// Neither job type has a web dispatcher yet (as of this module's creation —
// both run only via direct DB seeding in worker integration tests); the
// contract is defined now so a future dispatcher has a canonical shape to
// target from day one instead of re-guessing one the way `extract_claims`
// did.
// ---------------------------------------------------------------------------

export interface DetectRelationshipsScope {
  projectId: string;
}

export function parseDetectRelationshipsScope(scope: unknown): DetectRelationshipsScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { projectId?: unknown };
  if (typeof s.projectId === "string" && s.projectId.length > 0) return { projectId: s.projectId };
  return null;
}

export interface ClusterDebatesScope {
  projectId: string;
}

export function parseClusterDebatesScope(scope: unknown): ClusterDebatesScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { projectId?: unknown };
  if (typeof s.projectId === "string" && s.projectId.length > 0) return { projectId: s.projectId };
  return null;
}

// ---------------------------------------------------------------------------
// synthesize_chamber
// ---------------------------------------------------------------------------

export interface SynthesizeChamberScope {
  clusterId: string;
}

/** The worker only ever reads `clusterId` — `apps/web/src/lib/research/
 *  jobs.ts`'s `dispatchSynthesizeChamberJob` also stores `projectId`
 *  alongside it (bookkeeping for `listResearchJobRequestsForProject`'s own
 *  project-scoped listing filter), which this parser simply ignores rather
 *  than rejecting: the contract here is "does this scope carry what the
 *  HANDLER needs", not "is this object exactly this shape and no more". */
export function parseSynthesizeChamberScope(scope: unknown): SynthesizeChamberScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { clusterId?: unknown };
  if (typeof s.clusterId === "string" && s.clusterId.length > 0) return { clusterId: s.clusterId };
  return null;
}

// ---------------------------------------------------------------------------
// generate_hypotheses
// ---------------------------------------------------------------------------

export interface GenerateHypothesesScope {
  projectId: string;
  question: string | null;
  maxHypotheses?: number;
}

export function parseGenerateHypothesesScope(scope: unknown): GenerateHypothesesScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { projectId?: unknown; question?: unknown; maxHypotheses?: unknown };
  if (typeof s.projectId !== "string" || s.projectId.length === 0) return null;
  const question = typeof s.question === "string" && s.question.trim().length > 0 ? s.question.trim() : null;
  const maxHypotheses = typeof s.maxHypotheses === "number" && Number.isFinite(s.maxHypotheses) ? s.maxHypotheses : undefined;
  return { projectId: s.projectId, question, maxHypotheses };
}

// ---------------------------------------------------------------------------
// import_corpus
// ---------------------------------------------------------------------------

export interface ImportCorpusItemRequest {
  provider: string;
  externalId: string;
}

export interface ImportCorpusScope {
  projectId?: string;
  items: ImportCorpusItemRequest[];
}

export function parseImportCorpusScope(scope: unknown): ImportCorpusScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { projectId?: unknown; items?: unknown };
  if (!Array.isArray(s.items) || s.items.length === 0) return null;
  const items: ImportCorpusItemRequest[] = [];
  for (const raw of s.items) {
    const item = raw as { provider?: unknown; externalId?: unknown } | null;
    if (!item || typeof item.provider !== "string" || typeof item.externalId !== "string" || !item.externalId.trim()) return null;
    items.push({ provider: item.provider, externalId: item.externalId });
  }
  const projectId = typeof s.projectId === "string" && s.projectId.length > 0 ? s.projectId : undefined;
  return { projectId, items };
}

// ---------------------------------------------------------------------------
// run_monitor
// ---------------------------------------------------------------------------

export interface RunMonitorScope {
  monitorId?: string;
}

export function parseRunMonitorScope(scope: unknown): RunMonitorScope | null {
  if (scope === null || typeof scope !== "object" || Array.isArray(scope)) return null;
  const s = scope as { monitorId?: unknown };
  if (s.monitorId === undefined) return {};
  if (typeof s.monitorId !== "string" || s.monitorId.length === 0) return null;
  return { monitorId: s.monitorId };
}

// ---------------------------------------------------------------------------
// Shared assertion helper — the web-dispatch-side "validate against the
// canonical contract before insert" half of the guarantee (the worker side
// is `parse*Scope` returning non-null). A dispatcher constructs the scope
// object it's about to insert, then calls this so a future accidental
// reshaping of that object literal fails LOUDLY at dispatch time (a thrown
// error, never a queued row the worker will only fail on later) rather than
// silently drifting the way D-25-14 did.
// ---------------------------------------------------------------------------

export function assertValidScope<T>(parsed: T | null, jobTypeLabel: string): T {
  if (parsed === null) {
    throw new Error(`Internal error: constructed an invalid ${jobTypeLabel} scope — this should be unreachable.`);
  }
  return parsed;
}
