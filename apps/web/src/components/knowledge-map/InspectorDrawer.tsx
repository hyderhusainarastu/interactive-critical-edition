"use client";

/**
 * Selected-only inspector overlay (charter §10 "Graph workspace layout" /
 * §12 "Inspector and scholarly actions", spec §1.1's `InspectorDrawer.tsx`
 * row). 360px wide on desktop, opens on the side OPPOSITE the selected
 * node's projected X position so selection never hides the node that was
 * just clicked; a bottom sheet on mobile.
 *
 * Scope note (this step is "workspace-chooser-url", not the full §3
 * inspector action map): renders the charter §12 identity/state/
 * authorship/destination/relationship-count/credibility groups from real
 * data, and wires the one action this step's data already supports for
 * real — navigating to a real `destination`. Verify/Dispute/Edit/
 * Reclassify/Add evidence/Remove relationship/Mark uncertain/Request
 * reprocessing (spec §3's full action map) are deliberately NOT wired
 * here — an honest "not available in this view yet" notice is shown
 * instead of a button that only pretends to work, per charter §12's own
 * "never render a button that only pretends to work" rule. Wiring the
 * real corrections/roadmap/reprocess endpoints is left for a subsequent
 * step, recorded here rather than silently implied to be done.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import type { CredibilityDimension } from "../graph/types";
import { CREDIBILITY_DIMENSIONS, CREDIBILITY_DIMENSION_LABEL, STATE_META, TYPE_LABEL, type GraphNode, type NodeState, type NodeType } from "../graph/types";
import type { KnowledgeMapDisplayNode } from "./adapter";

export interface InspectorDrawerProps {
  /** `null` closes the drawer entirely (nothing selected). */
  displayNode: KnowledgeMapDisplayNode | null;
  /** The richer canonical record backing `displayNode`, when one exists
   *  (only ever populated for a "work" context today — see
   *  `KnowledgeMapWorkspace.tsx`'s own scope note). `null` for a synthesized
   *  display-only node (an aggregate) or any context this step doesn't yet
   *  resolve canonical data for. */
  canonicalNode: GraphNode | null;
  canonicalState: NodeState | null;
  incomingCount: number;
  outgoingCount: number;
  /** Projected screen X of the selected node, so the drawer opens on the
   *  opposite side (charter §10) — `null` before the scene has reported a
   *  position (e.g. selection made from List view before the 3D scene has
   *  rendered a frame), in which case the drawer defaults to the right. */
  anchorScreenX: number | null;
  viewportWidth: number;
  onClose: () => void;
}

export function InspectorDrawer({ displayNode, canonicalNode, canonicalState, incomingCount, outgoingCount, anchorScreenX, viewportWidth, onClose }: InspectorDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const open = displayNode !== null;

  useDialogEscape(open, onClose);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open, displayNode?.id]);

  if (!displayNode) return null;

  // Opens opposite the selected node's projected X — a node clicked on the
  // right half of the viewport gets a LEFT-side drawer, and vice versa, so
  // the drawer never overlaps the very node the user just selected.
  const openOnLeft = anchorScreenX !== null && anchorScreenX > viewportWidth / 2;

  const canonicalType = canonicalNode?.type as NodeType | undefined;

  return (
    <aside
      data-testid="knowledge-map-inspector"
      aria-label={`Inspector: ${displayNode.label}`}
      className={`app-reveal absolute top-2 z-30 flex max-h-[calc(100%-1rem)] w-[360px] max-w-[92vw] flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-sm shadow-xl ${openOnLeft ? "left-2" : "right-2"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {canonicalType ? TYPE_LABEL[canonicalType] : displayNode.displayKind}
          </p>
          <h2 className="break-words text-base font-semibold text-[var(--color-text)]">{displayNode.label}</h2>
        </div>
        <button ref={closeButtonRef} type="button" onClick={onClose} className="app-control shrink-0 rounded px-2 py-1 text-xs" aria-label="Close inspector">
          Close
        </button>
      </div>

      {canonicalState && (
        <p className="text-xs" style={{ color: `var(${STATE_META[canonicalState].colorVar})` }}>
          {STATE_META[canonicalState].label}
        </p>
      )}

      {displayNode.unavailableReason && (
        <p className="rounded border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2 py-1 text-xs text-[var(--color-text-muted)]">{displayNode.unavailableReason}</p>
      )}

      {canonicalNode && (canonicalNode.authors || canonicalNode.year || canonicalNode.venue || canonicalNode.doi) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
          {canonicalNode.authors && (
            <>
              <dt className="text-[var(--color-text-muted)]">Author</dt>
              <dd>{canonicalNode.authors}</dd>
            </>
          )}
          {canonicalNode.year && (
            <>
              <dt className="text-[var(--color-text-muted)]">Year</dt>
              <dd>{canonicalNode.year}</dd>
            </>
          )}
          {canonicalNode.venue && (
            <>
              <dt className="text-[var(--color-text-muted)]">Venue</dt>
              <dd>{canonicalNode.venue}</dd>
            </>
          )}
          {canonicalNode.doi && (
            <>
              <dt className="text-[var(--color-text-muted)]">DOI</dt>
              <dd className="break-all">{canonicalNode.doi}</dd>
            </>
          )}
        </dl>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        {incomingCount} incoming · {outgoingCount} outgoing relationship{incomingCount + outgoingCount === 1 ? "" : "s"} currently shown
      </p>

      {canonicalNode?.credibility && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Credibility</h3>
          <ul className="flex flex-col gap-0.5 text-xs">
            {CREDIBILITY_DIMENSIONS.map((dimension: CredibilityDimension) => {
              const value = canonicalNode.credibility?.[dimension] ?? null;
              return (
                <li key={dimension} className="flex items-center justify-between">
                  <span className="text-[var(--color-text-muted)]">{CREDIBILITY_DIMENSION_LABEL[dimension]}</span>
                  <span>{value === null || value === undefined ? "Not assessed" : `${Math.round(value * 100)}%`}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
        {displayNode.destination ? (
          <Link href={displayNode.destination} className="app-control rounded border border-[var(--color-border)] px-3 py-1.5 text-center text-xs font-medium">
            Open
          </Link>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">No destination is available for this node yet.</p>
        )}
        <p className="text-xs text-[var(--color-text-muted)]">
          Verify, dispute, edit, and other scholarly actions aren&rsquo;t wired into this view yet.
        </p>
      </div>
    </aside>
  );
}
