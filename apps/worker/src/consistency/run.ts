import { runAllConsistencyChecks, type ConsistencyReport } from "@ice/consistency";
import { reportEvent } from "@ice/observability";
import { applyConsistencyRepairs } from "./apply";
import { fetchConsistencySnapshot } from "./snapshot";

/**
 * Phase 20.7 one-time/maintenance consistency runner. Two modes, exactly one
 * DB fetch + check pass in either:
 *
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/consistency/run.ts
 *   cd apps/worker && pnpm exec tsx --env-file-if-exists=.env src/consistency/run.ts --repair
 *
 * REPORT mode (default, no flag): fetches the snapshot, runs every check,
 * prints a full markdown findings report, and applies NOTHING — safe to run
 * against any environment at any time, same "audit, decide nothing" posture
 * as Phase 20.6's `dryRun.ts`.
 *
 * REPAIR mode (`--repair`): does the identical report pass first (so what's
 * about to be applied is always printed before it happens), then applies
 * every non-null repair in ONE transaction via `applyConsistencyRepairs`,
 * and finally re-runs the checks to print a before/after count — proving the
 * repair pass actually resolved what it targeted rather than asserting it.
 */

function renderReport(report: ConsistencyReport, heading: string): string {
  const lines: string[] = [`### ${heading}`, "", `Mismatches found: ${report.mismatches.length}`, `Auto-repairable: ${report.repairs.length}`, ""];

  const bySeverity = { critical: 0, warning: 0, info: 0 } as Record<string, number>;
  for (const m of report.mismatches) bySeverity[m.severity] = (bySeverity[m.severity] ?? 0) + 1;
  lines.push(`- critical: ${bySeverity.critical ?? 0}`, `- warning: ${bySeverity.warning ?? 0}`, `- info: ${bySeverity.info ?? 0}`, "");

  const byCheck = new Map<string, typeof report.mismatches>();
  for (const m of report.mismatches) {
    const list = byCheck.get(m.checkId) ?? [];
    list.push(m);
    byCheck.set(m.checkId, list);
  }

  for (const [checkId, mismatches] of byCheck) {
    lines.push(`#### ${checkId} (${mismatches.length})`);
    for (const m of mismatches.slice(0, 20)) {
      lines.push(`- [${m.severity}] ${m.entityType} \`${m.entityId.slice(0, 8)}…\`: ${m.description}${m.repair ? " (repairable)" : " (report-only — no safe repair without guessing)"}`);
    }
    if (mismatches.length > 20) lines.push(`- …and ${mismatches.length - 20} more`);
    lines.push("");
  }

  if (report.mismatches.length === 0) lines.push("_No mismatches found across any of the 9 checks._");

  return lines.join("\n");
}

async function main() {
  const repairMode = process.argv.includes("--repair");

  const snapshot = await fetchConsistencySnapshot();
  const before = runAllConsistencyChecks(snapshot);
  console.log(renderReport(before, repairMode ? "Phase 20.7 — before repair" : "Phase 20.7 — report mode (read-only)"));

  reportEvent("consistency.report_run", {
    mode: repairMode ? "repair" : "report",
    mismatches: before.mismatches.length,
    repairable: before.repairs.length,
  });

  if (!repairMode) {
    console.log("\nReport mode: no repairs were applied. Re-run with --repair to apply the repairable subset above.");
    process.exit(0);
  }

  if (before.repairs.length === 0) {
    console.log("\nNothing repairable found; repair mode applied 0 changes.");
    process.exit(0);
  }

  const result = await applyConsistencyRepairs(before.repairs);
  console.log(`\nApplied ${result.applied} repair(s) transactionally.`);
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} repair(s) this applier doesn't yet handle:`);
    for (const s of result.skipped) console.log(`  - ${s.repair.table} (${s.repair.kind}): ${s.reason}`);
  }

  const afterSnapshot = await fetchConsistencySnapshot();
  const after = runAllConsistencyChecks(afterSnapshot);
  console.log("");
  console.log(renderReport(after, "Phase 20.7 — after repair"));
  console.log(`\nMismatches: ${before.mismatches.length} → ${after.mismatches.length}.`);

  process.exit(0);
}

void main();
