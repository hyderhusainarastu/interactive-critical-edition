import Link from "next/link";
import type { PipelineStepperResult } from "@/lib/research/pipelineSteps";

export type PipelineDispatchableAction = "detect" | "cluster";

/** Per-action dispatch state the parent owns (mirrors
 *  `ResearchProjectOverview.tsx`'s existing per-work `dispatching`/
 *  `pendingConfirm`/`dispatchError` records, keyed here by the action name
 *  instead of a work id). */
export interface PipelineActionState {
  dispatching: boolean;
  pendingConfirm: { reason: string; estimatedUnits: number } | null;
  error: string;
}

/**
 * Item 2 of the Research-workspace fix lane's owner-reported scope
 * addition: a compact, honest-steps stepper for the project overview,
 * following `WorkStatusPanel.tsx`'s own discrete step-circle convention
 * (never a fake percentage) plus the `.app-stage-marker[data-state="active"]`
 * pulse `globals.css` already defines (reduced-motion-gated there, unused
 * by any other surface yet — a good fit here rather than inventing a new
 * one). Purely a status display; `computeResearchPipelineSteps()` (the pure
 * function backing it) is the only place that decides what each step says.
 *
 * Phase 30 gap-fix lane: when `result.nextAction.action` names a
 * dispatchable job ("detect"/"cluster"), this renders a real button
 * alongside the informational message instead of just text — the same
 * `dispatchExtractClaimsJob` needs_confirmation flow `ResearchProjectOverview.tsx`
 * already uses for "Extract claims", surfaced here via `onDispatch`/
 * `actionState` (both optional so this component still degrades to a plain
 * status display if a caller ever renders it without wiring dispatch).
 */
export function ResearchPipelineStepper({
  result,
  onDispatch,
  actionState,
}: {
  result: PipelineStepperResult;
  onDispatch?: (action: PipelineDispatchableAction, confirm?: boolean) => void;
  actionState?: PipelineActionState;
}) {
  const firstUndoneIndex = result.steps.findIndex((s) => !s.done);
  const action = result.nextAction?.action;
  const ACTION_LABEL: Record<PipelineDispatchableAction, string> = { detect: "Detect relationships", cluster: "Cluster debates" };

  return (
    <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-pipeline-title">
      <h2 id="research-pipeline-title" className="font-serif text-lg font-semibold">
        Pipeline
      </h2>
      <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4" aria-label="Research pipeline stages">
        {result.steps.map((step, index) => {
          const isNext = index === firstUndoneIndex && Boolean(result.nextAction);
          const state: "done" | "active" | "pending" = step.done ? "done" : isNext ? "active" : "pending";
          return (
            <li key={step.key} className="flex min-w-0 items-start gap-2">
              <span
                aria-hidden="true"
                data-state={state}
                className="app-stage-marker mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[0.65rem]"
                style={{
                  borderColor: step.done || isNext ? "var(--color-accent-ink)" : "var(--color-border)",
                  background: step.done ? "var(--color-accent-ink)" : "transparent",
                  color: step.done ? "var(--color-background)" : "var(--color-text-muted)",
                }}
              >
                {step.done ? "✓" : index + 1}
              </span>
              <div className="min-w-0">
                <p className={step.done || isNext ? "text-sm font-medium text-[var(--color-text)]" : "text-sm text-[var(--color-text-muted)]"}>
                  {step.label}
                  {isNext ? " (next)" : ""}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">{step.state}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {result.nextAction && (
        <div className="app-panel-enter mt-4 rounded border border-[var(--color-accent)] p-3 text-sm">
          <p>
            {result.nextAction.href ? (
              <Link href={result.nextAction.href} className="app-control app-press inline-flex min-h-11 items-center underline">
                {result.nextAction.message}
              </Link>
            ) : (
              result.nextAction.message
            )}
          </p>
          {action && onDispatch && (
            <button
              type="button"
              className="app-control app-press mt-2 inline-flex min-h-11 items-center rounded border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              onClick={() => onDispatch(action)}
              disabled={Boolean(actionState?.dispatching)}
            >
              {actionState?.dispatching ? "Starting…" : ACTION_LABEL[action]}
            </button>
          )}
          {action && actionState?.pendingConfirm && (
            <div className="app-panel-enter mt-2 rounded border border-[var(--color-accent)] p-2 text-xs">
              <p>{actionState.pendingConfirm.reason}</p>
              <button
                type="button"
                className="app-control app-press mt-2 rounded bg-[var(--color-accent-ink)] px-3 py-1.5 text-[var(--color-background)]"
                onClick={() => onDispatch?.(action, true)}
              >
                Confirm and {ACTION_LABEL[action].toLowerCase()}
              </button>
            </div>
          )}
          {actionState?.error && <p className="mt-2 text-xs text-[var(--color-error,#b3261e)]">{actionState.error}</p>}
        </div>
      )}
    </section>
  );
}
