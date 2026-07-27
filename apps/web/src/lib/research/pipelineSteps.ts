import type { ResearchPipelineOverview } from "./pipeline";

/**
 * Pure state-machine over `ResearchPipelineOverview`'s real counts, split
 * from the DB read the same way `@ice/roadmap`'s pure ranking is split from
 * `apps/web/src/lib/roadmap.ts`'s DB traversal (`docs/PROJECT-LOG.md` Design
 * Decisions) — this function is a deterministic function of its inputs, so
 * it's directly unit-testable with no DB.
 *
 * Drives the project overview's pipeline sequence stepper (Item 2 of the
 * Research-workspace fix lane's owner-reported scope addition): Extract
 * claims → Detect relationships → Cluster debates → Chambers / Hypotheses.
 *
 * Phase 30 gap-fix lane: "Detect relationships" and "Cluster debates" now
 * DO carry a real dispatch action (`PipelineNextAction.action`) once their
 * preconditions are met — `lib/research/jobs.ts`'s `dispatchDetectRelationshipsJob`/
 * `dispatchClusterDebatesJob` finally exist, closing the gap this file's own
 * prior doc comment (kept in git history) explained: no web dispatcher for
 * either job type existed anywhere in the codebase, so a fabricated button
 * would have either done nothing or needed an unreviewed cost-estimation
 * feature built blind. `action` is only ever set on the SAME `nextAction`
 * branch that already reports the step as unblocked (`workCountWithClaims >= 2`
 * for detect, `detectDone` for cluster) — a step whose real precondition
 * isn't met keeps reporting the honest blocking message with no `action`,
 * exactly as before.
 */

export type PipelineStepKey = "extract" | "detect" | "cluster" | "synthesize";

export interface PipelineStepView {
  key: PipelineStepKey;
  label: string;
  state: string;
  done: boolean;
}

export interface PipelineNextAction {
  message: string;
  href?: string;
  /** Which research job this action can dispatch, when a real dispatch
   *  control (not just an informational message/link) applies. */
  action?: "detect" | "cluster";
}

export interface PipelineStepperResult {
  steps: PipelineStepView[];
  /** Null once every step has real output — nothing left to call out. */
  nextAction: PipelineNextAction | null;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function computeResearchPipelineSteps(
  overview: ResearchPipelineOverview,
  links: { membersHref: string; hypothesesHref: string },
): PipelineStepperResult {
  const { claimCount, workCountWithClaims, totalMemberWorkCount, relationshipCount, clusterCount, chamberCount, hypothesesCount } = overview;

  const extractDone = claimCount > 0;
  const detectDone = relationshipCount > 0;
  const clusterDone = clusterCount > 0;
  const synthesizeDone = chamberCount > 0 || hypothesesCount > 0;

  const steps: PipelineStepView[] = [
    {
      key: "extract",
      label: "Extract claims",
      state:
        totalMemberWorkCount === 0
          ? "No works added to this project yet"
          : claimCount === 0
            ? "No claims extracted yet"
            : `${plural(claimCount, "claim")} across ${plural(workCountWithClaims, "work")}`,
      done: extractDone,
    },
    {
      key: "detect",
      label: "Detect relationships",
      state: !extractDone
        ? "Waiting on claim extraction"
        : workCountWithClaims < 2
          ? "Needs claims from a second work"
          : relationshipCount === 0
            ? "Not run yet"
            : plural(relationshipCount, "relationship") + " detected",
      done: detectDone,
    },
    {
      key: "cluster",
      label: "Cluster debates",
      state: !detectDone ? "Waiting on relationship detection" : clusterCount === 0 ? "Not clustered yet" : `${plural(clusterCount, "debate")} formed`,
      done: clusterDone,
    },
    {
      key: "synthesize",
      label: "Chambers / Hypotheses",
      state: !clusterDone
        ? "Waiting on debate clustering"
        : !synthesizeDone
          ? "None generated yet"
          : `${plural(chamberCount, "chamber")}, ${plural(hypothesesCount, "hypothesis", "hypotheses")}`,
      done: synthesizeDone,
    },
  ];

  let nextAction: PipelineNextAction | null = null;
  if (!extractDone) {
    nextAction = {
      message: totalMemberWorkCount === 0 ? "Add a work to this project to begin." : "Extract claims from a work above to begin.",
      href: links.membersHref,
    };
  } else if (!detectDone) {
    nextAction =
      workCountWithClaims < 2
        ? { message: "Add and extract a second work to enable relationship detection.", href: links.membersHref }
        : { message: "Relationship detection hasn't run for this project yet.", action: "detect" };
  } else if (!clusterDone) {
    nextAction = { message: "Debate clustering hasn't run for this project yet.", action: "cluster" };
  } else if (!synthesizeDone) {
    nextAction = { message: "Generate hypotheses, or open a debate to synthesize an evidence chamber.", href: links.hypothesesHref };
  }

  return { steps, nextAction };
}
