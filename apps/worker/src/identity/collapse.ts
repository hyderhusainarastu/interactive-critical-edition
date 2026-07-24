import { auditWorkIdentityDuplicates, mergeWorkIdentities, renderIdentityAuditReport, type AuditCandidateDetail } from "./merge";

/**
 * Phase 20.6 — owner-authorized canonical-identity collapse (issue #3 cleanup).
 *
 * Audits every ACTIVE work_identity, plans a duplicate collapse via the pure
 * precedence chain, and — only under an explicit `--execute` flag — applies the
 * CONFIDENT merges through the transactional, reversible `mergeWorkIdentities`.
 * Fuzzy suggestions (rule 6) are NEVER applied automatically; they are printed
 * for a human to act on. Every applied merge prints its merge id so it can be
 * undone with `revertWorkIdentityMerge`.
 *
 * The Part-2 derivation hardening stops NEW fragments forming; this cleans up
 * the ones already written. In practice most existing NE-style fragments carry
 * DIFFERENT author surnames and therefore surface here as fuzzy suggestions
 * (human review), not confident merges — the precision guarantee is deliberate.
 *
 * Usage (tsx, the documented production-write tool shape — @ice/db pattern):
 *   # DRY RUN (default) — audits, prints the plan, writes nothing:
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/identity/collapse.ts
 *
 *   # EXECUTE — applies every confident merge (reversible):
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/identity/collapse.ts --execute
 *
 *   # EXECUTE, SCOPED — applies only confident merges touching identities whose
 *   # canonical title or work key contains <substr> (safe targeted cleanup):
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/identity/collapse.ts --execute --filter=nicomachean
 *
 * Production execution is owner-authorized only (plan §20.6 / the 20.8 gate) —
 * this file performs writes ONLY when `--execute` is passed.
 */

function parseArgs(argv: string[]): { execute: boolean; filter: string | null } {
  const execute = argv.includes("--execute");
  const filterArg = argv.find((a) => a.startsWith("--filter="));
  const filter = filterArg ? filterArg.slice("--filter=".length).trim().toLowerCase() || null : null;
  return { execute, filter };
}

/** A merge is in scope when any identity it touches matches the filter substring. */
function mergeMatchesFilter(
  merge: { winnerId: string; loserIds: string[] },
  byId: Map<string, AuditCandidateDetail>,
  filter: string,
): boolean {
  const touches = [merge.winnerId, ...merge.loserIds];
  return touches.some((id) => {
    const c = byId.get(id);
    if (!c) return false;
    return c.canonicalTitle.toLowerCase().includes(filter) || c.workKey.toLowerCase().includes(filter);
  });
}

async function main() {
  const { execute, filter } = parseArgs(process.argv.slice(2));

  const audit = await auditWorkIdentityDuplicates();
  console.log(renderIdentityAuditReport(audit, "Canonical-identity duplicate audit"));

  if (!execute) {
    console.log(
      `\nDRY RUN. Nothing was written. Re-run with --execute to apply the ${audit.plan.merges.length} confident merge(s) above (fuzzy suggestions are never applied automatically).`,
    );
    process.exit(0);
  }

  const byId = new Map(audit.candidates.map((c) => [c.id, c]));
  const merges = filter ? audit.plan.merges.filter((m) => mergeMatchesFilter(m, byId, filter)) : audit.plan.merges;

  console.log(
    `\n=== EXECUTE${filter ? ` (filter: "${filter}")` : ""} — applying ${merges.length} confident merge group(s) ===`,
  );

  // Partial-batch semantics: each mergeWorkIdentities call is individually
  // atomic and reversible, but the batch is NOT one transaction — a mid-batch
  // failure leaves the earlier merges applied, each with its mergeId printed
  // below for selective revert (revertWorkIdentityMerge).
  const applied: Array<{ mergeId: string; winnerId: string; loserId: string }> = [];
  const failures: Array<{ winnerId: string; loserId: string; error: string }> = [];
  for (const merge of merges) {
    for (const loserId of merge.loserIds) {
      try {
        const result = await mergeWorkIdentities({
          winnerId: merge.winnerId,
          loserId,
          method: merge.method,
          evidence: merge.evidence,
          createdBy: "system",
        });
        applied.push({ mergeId: result.mergeId, winnerId: merge.winnerId, loserId });
        console.log(`  merged ${loserId.slice(0, 8)}… → ${merge.winnerId.slice(0, 8)}… (${merge.method}) — merge ${result.mergeId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ winnerId: merge.winnerId, loserId, error: message });
        console.error(`  SKIPPED ${loserId.slice(0, 8)}… → ${merge.winnerId.slice(0, 8)}…: ${message}`);
      }
    }
  }

  console.log(`\nApplied ${applied.length} merge(s); ${failures.length} skipped.`);
  if (applied.length) {
    console.log("Each is reversible: revertWorkIdentityMerge(<mergeId>). Applied merge ids:");
    for (const a of applied) console.log(`  ${a.mergeId}`);
  }
  process.exit(failures.length ? 1 : 0);
}

void main();
