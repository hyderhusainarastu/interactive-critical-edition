import { citationLibraryLinks, citations, db, documents, learningResources, works } from "@ice/db";
import { isLocusDominated, recognizeClassicalReference, type RawCitation } from "@ice/ingestion";
import { and, eq, like } from "drizzle-orm";
import { applyClassicalCitationResolution } from "../analyze";

/**
 * Production cleanup for junk Library rows the classical-citation fix
 * closes going forward, but which already exist from before this fix
 * shipped: "Needs bibliographic resolution — Af?;7.8.1151a20-8." and
 * siblings — a corrupted abbreviation plus a Bekker/Stephanus locus number
 * that used to clear the generic fallback's `>= 8` character bar.
 *
 * Follows the `identity/collapse.ts` precedent: dry-run by default, writes
 * only under an explicit `--execute` flag, every action is reported before
 * (dry run) or as (execute) it happens.
 *
 * A candidate is any `learning_resource` row shaped like the junk fallback
 * (`resourceType: "unresolved-citation"`, title starting with the junk
 * prefix) whose linked citation's own `rawText` is `isLocusDominated` —
 * this is deliberately the SAME scope the extraction gate itself now
 * suppresses, so a genuine modern unresolved citation (e.g. "The Archive
 * of Lost Virtues, anonymous manuscript.", which has plenty of real prose
 * and is not locus-dominated) is never touched by this script.
 *
 * Two actions:
 *   - Plain delete (the default): removes the junk `learning_resource` row,
 *     which cascades its `resource_role` and `citation_library_link` rows.
 *     The `citation` row itself is never touched — its provenance (raw
 *     text, source anchor, source type) is preserved exactly as extracted;
 *     only the derived-and-wrong Library projection is removed.
 *   - Reproject (`--reproject`, only for candidates
 *     `recognizeClassicalReference` can actually identify a specific work
 *     for): re-points the citation at the canonical classical Library row
 *     via `applyClassicalCitationResolution` instead of leaving it
 *     unlinked — this ALSO removes the old junk stub as part of its merge
 *     step, so a reprojected candidate needs no separate delete.
 *
 * Usage (tsx, the documented production-write tool shape — @ice/db pattern):
 *   # DRY RUN (default) — reports the plan, writes nothing:
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/maintenance/cleanupClassicalCitationStubs.ts
 *
 *   # EXECUTE — deletes every locus-dominated junk stub (citation rows untouched):
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/maintenance/cleanupClassicalCitationStubs.ts --execute
 *
 *   # EXECUTE + REPROJECT — additionally re-projects identifiable candidates
 *   # onto the canonical Aristotle/Plato Library entry instead of just
 *   # deleting them:
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/maintenance/cleanupClassicalCitationStubs.ts --execute --reproject
 *
 * Production execution is owner-authorized only, matching every other
 * maintenance script in this directory — this file performs writes ONLY
 * when `--execute` is passed.
 */

const JUNK_PREFIX = "Needs bibliographic resolution — ";

export interface ClassicalStubCandidate {
  learningResourceId: string;
  citationId: string;
  rawText: string;
  workId: string;
  workIdentityId: string | null;
  userId: string;
  sourceType: "bibliography" | "footnote" | "endnote" | "inline";
  parserConfidence: number;
  sourceAnchor: RawCitation["anchor"];
  processingRunId: string | null;
  /** null when locus-dominated but no specific work could be identified —
   *  a plain-delete-only candidate even under `--reproject`. */
  classicalWork: string | null;
}

/**
 * Finds every junk classical-citation stub currently in the Library. Pure
 * read — safe to call in dry-run mode, and reused by the test suite to
 * assert on the exact candidate set before executing anything.
 */
export async function findClassicalStubCandidates(): Promise<ClassicalStubCandidate[]> {
  const rows = await db
    .select({
      learningResourceId: learningResources.id,
      citationId: citations.id,
      rawText: citations.rawText,
      sourceType: citations.sourceType,
      parserConfidence: citations.parserConfidence,
      sourceAnchor: citations.sourceAnchor,
      processingRunId: citations.processingRunId,
      workId: documents.workId,
      workIdentityId: works.workIdentityId,
      userId: documents.userId,
    })
    .from(learningResources)
    .innerJoin(citationLibraryLinks, eq(citationLibraryLinks.learningResourceId, learningResources.id))
    .innerJoin(citations, eq(citations.id, citationLibraryLinks.citationId))
    .innerJoin(documents, eq(documents.id, citations.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(
      and(
        eq(learningResources.resourceType, "unresolved-citation"),
        like(learningResources.title, `${JUNK_PREFIX}%`),
      ),
    );

  const candidates: ClassicalStubCandidate[] = [];
  for (const row of rows) {
    if (!isLocusDominated(row.rawText)) continue;
    const classical = recognizeClassicalReference(row.rawText);
    candidates.push({
      learningResourceId: row.learningResourceId,
      citationId: row.citationId,
      rawText: row.rawText,
      workId: row.workId,
      workIdentityId: row.workIdentityId,
      userId: row.userId,
      sourceType: row.sourceType,
      parserConfidence: row.parserConfidence,
      sourceAnchor: row.sourceAnchor as RawCitation["anchor"],
      processingRunId: row.processingRunId,
      classicalWork: classical?.work ?? null,
    });
  }
  return candidates;
}

function renderReport(candidates: ClassicalStubCandidate[]): string {
  if (candidates.length === 0) return "No junk classical-citation stubs found.";
  const identifiable = candidates.filter((c) => c.classicalWork !== null);
  const unidentifiable = candidates.filter((c) => c.classicalWork === null);
  const lines = [
    `Found ${candidates.length} junk stub(s): ${identifiable.length} identifiable (reprojectable), ${unidentifiable.length} unidentifiable (delete-only).`,
    "",
  ];
  for (const c of candidates) {
    const tag = c.classicalWork ? `-> ${c.classicalWork}` : "(unidentified — delete only)";
    lines.push(`  ${c.learningResourceId.slice(0, 8)}… citation ${c.citationId.slice(0, 8)}… "${c.rawText}" ${tag}`);
  }
  return lines.join("\n");
}

function parseArgs(argv: string[]): { execute: boolean; reproject: boolean } {
  return { execute: argv.includes("--execute"), reproject: argv.includes("--reproject") };
}

export interface CleanupResult {
  candidates: ClassicalStubCandidate[];
  deleted: number;
  reprojected: number;
  failures: Array<{ learningResourceId: string; error: string }>;
}

/**
 * The reusable orchestration, deliberately free of `process.exit()` — the
 * integration test calls this directly (dry-run first, then `--execute`)
 * without killing the test process. Only the thin CLI entrypoint below
 * translates its result into an exit code.
 */
export async function runCleanupClassicalCitationStubs(options: {
  execute: boolean;
  reproject: boolean;
}): Promise<CleanupResult> {
  const candidates = await findClassicalStubCandidates();
  console.log(renderReport(candidates));

  if (!options.execute) {
    console.log(
      `\nDRY RUN. Nothing was written. Re-run with --execute to delete the ${candidates.length} stub(s) above` +
        `${options.reproject ? " (reprojecting identifiable ones onto their canonical Library entry instead of deleting)" : ""}.`,
    );
    return { candidates, deleted: 0, reprojected: 0, failures: [] };
  }

  console.log(`\n=== EXECUTE${options.reproject ? " --reproject" : ""} ===`);
  let deleted = 0;
  let reprojected = 0;
  const failures: Array<{ learningResourceId: string; error: string }> = [];

  for (const candidate of candidates) {
    try {
      if (options.reproject && candidate.classicalWork) {
        const match = recognizeClassicalReference(candidate.rawText);
        // Re-checked rather than trusted from the earlier pass — the
        // recognizer is pure and deterministic, but this keeps the write
        // path from ever acting on a stale in-memory classification if the
        // candidate list was computed a while ago (a long dry-run review,
        // a slow batch).
        if (!match) throw new Error("recognizer no longer identifies a work for this candidate");
        await applyClassicalCitationResolution({
          citationId: candidate.citationId,
          workId: candidate.workId,
          workIdentityId: candidate.workIdentityId,
          userId: candidate.userId,
          sourceType: candidate.sourceType,
          parserConfidence: candidate.parserConfidence,
          sourceAnchor: candidate.sourceAnchor,
          match,
          bridgeRunId: candidate.processingRunId,
        });
        reprojected++;
        console.log(`  reprojected ${candidate.learningResourceId.slice(0, 8)}… -> ${match.work}`);
      } else {
        // Plain delete — cascades resource_role and citation_library_link;
        // the citation row itself is never touched.
        await db.delete(learningResources).where(eq(learningResources.id, candidate.learningResourceId));
        deleted++;
        console.log(`  deleted ${candidate.learningResourceId.slice(0, 8)}…`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ learningResourceId: candidate.learningResourceId, error: message });
      console.error(`  SKIPPED ${candidate.learningResourceId.slice(0, 8)}…: ${message}`);
    }
  }

  console.log(`\nDeleted ${deleted}, reprojected ${reprojected}; ${failures.length} skipped.`);
  return { candidates, deleted, reprojected, failures };
}

async function main() {
  const { execute, reproject } = parseArgs(process.argv.slice(2));
  const result = await runCleanupClassicalCitationStubs({ execute, reproject });
  process.exit(result.failures.length ? 1 : 0);
}

// Guarded, unlike `identity/collapse.ts`'s unconditional `void main()` —
// this module's pure query (`findClassicalStubCandidates`) and its
// `process.exit()`-free orchestration (`runCleanupClassicalCitationStubs`)
// ARE imported by the integration test, and an unconditional top-level
// `main()` would run the CLI (including its `process.exit()`) the moment
// the test imports this file. Node's ESM entrypoint check: true only when
// this file was executed directly (`tsx .../cleanupClassicalCitationStubs.ts`),
// false when imported as a module.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
