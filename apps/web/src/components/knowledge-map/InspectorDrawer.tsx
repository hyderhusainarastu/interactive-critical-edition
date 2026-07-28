"use client";

/**
 * Selected-only inspector overlay (charter §10 "Graph workspace layout" /
 * §12 "Inspector and scholarly actions", spec §1.1's `InspectorDrawer.tsx`
 * row / spec §3's full action map). 360px wide on desktop, opens on the
 * side OPPOSITE the selected node's projected X position so selection
 * never hides the node that was just clicked; a bottom sheet on mobile
 * (charter §10 Mobile bullet: "Inspector bottom sheet with snap points near
 * 28%, 70%, and 95%") — the same field-grouping/action content, rendered
 * inside one of two wrappers chosen by `device`. The mobile wrapper's own
 * drag-to-resize/snap arithmetic lives in `./inspectorSheet.ts` (pure,
 * unit-tested); this file only binds pointer events to it.
 *
 * Renders every charter §12 group from real data (identity/type, held/
 * uploaded/access state, authorship/venue/DOI/destination, incoming and
 * outgoing relationships with category/direction/confidence/evidence/
 * provenance, separated credibility dimensions, reading status, mastery,
 * debate/claim metadata) and wires the real §3 action map
 * (`inspectorActions.ts`) against the confirmed-real owner-scoped
 * endpoints — Verify/Dispute/Edit/Reclassify/Update-excerpt for research
 * objects, Mark-uncertain for passage-annotation-sourced edges, Request
 * reprocessing for a reader's own work, and reading-status/mastery for a
 * bibliographic-record-backed node. Every action this session's real data
 * can't back honestly renders as a plain, non-interactive explanation
 * rather than a disabled-looking button — charter §12's own "never render
 * a button that only pretends to work" rule applies to a fake-looking
 * disabled control just as much as to a live one that silently no-ops.
 *
 * A submitted correction takes effect on the server immediately, but this
 * component does NOT refetch/mutate the already-loaded (and, per charter
 * §9, immutable) canonical graph payload — the drawer shows a real,
 * honest "Saved — reload to see this reflected in the graph" confirmation
 * rather than pretending the current session's frozen data changed. This
 * is a documented, deliberate scope boundary for this step, not a bug.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import { InsertIntoWriterButton } from "@/components/writer/insertion/InsertIntoWriterButton";
import type { CredibilityDimension } from "../graph/types";
import { CREDIBILITY_DIMENSIONS, CREDIBILITY_DIMENSION_LABEL, STATE_META, TYPE_LABEL, type GraphNode, type NodeState, type NodeType } from "../graph/types";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";
import {
  resolveCitedOnlyInfo,
  resolveDestination,
  resolveLinkActions,
  resolveNodeScholarlyActions,
  resolveReadingStatusTarget,
  resolveWriterInsertionCandidate,
  type ScholarlyAction,
  type ScholarlyActionRequest,
} from "./inspectorActions";
import {
  dragFractionFromDelta,
  INSPECTOR_SHEET_DEFAULT_SNAP_INDEX,
  INSPECTOR_SHEET_SNAP_FRACTIONS,
  nearestSnapIndex,
  sheetHeightPx,
  type InspectorSheetSnapIndex,
} from "./inspectorSheet";

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
  /** Every other node's own canonical record, keyed by canonical id — used
   *  only to look up a citing work's real title for the cited-only-work
   *  section, never to re-derive filtered/topology state (that stays
   *  `KnowledgeMapWorkspace`'s job). */
  canonicalNodeById?: ReadonlyMap<string, GraphNode>;
  incomingLinks: { link: KnowledgeMapDisplayLink; otherNode: KnowledgeMapDisplayNode | null }[];
  outgoingLinks: { link: KnowledgeMapDisplayLink; otherNode: KnowledgeMapDisplayNode | null }[];
  /** The current context's own work id, ONLY when the context kind is
   *  "work" — several §3 actions (reading status, mark-uncertain) are
   *  scoped to the work whose graph is currently open, and must never
   *  guess a root when there isn't a real one. */
  rootWorkId: string | null;
  /** Projected screen X of the selected node, so the drawer opens on the
   *  opposite side (charter §10) — `null` before the scene has reported a
   *  position (e.g. selection made from List view before the 3D scene has
   *  rendered a frame), in which case the drawer defaults to the right. */
  anchorScreenX: number | null;
  viewportWidth: number;
  /** `"mobile"` renders the bottom sheet (charter §10 Mobile bullet);
   *  `"desktop"` renders the existing 360px side overlay. Supplied by the
   *  caller's own `useViewport()`-style breakpoint (`KnowledgeMapWorkspace`)
   *  rather than re-derived here, so there is exactly one width breakpoint
   *  definition for the whole workspace. */
  device: "mobile" | "desktop";
  /** Needed only by the mobile sheet, to convert a snap fraction into a
   *  concrete pixel height (`./inspectorSheet.ts`'s `sheetHeightPx`). */
  viewportHeight: number;
  /** Integration step "writer-insertion-dialogs": gates the "Insert into
   *  Writer" action (charter §6 "Write"). Off when Writer itself is
   *  feature-flagged off, matching every other Writer-adjacent affordance
   *  in this app. */
  writerEnabled?: boolean;
  onClose: () => void;
}

type ActionStatus = { status: "idle" } | { status: "pending" } | { status: "done" } | { status: "error"; message: string };

async function submitAction(request: ScholarlyActionRequest, extra: Record<string, unknown>): Promise<ActionStatus> {
  try {
    const res = await fetch(request.url, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request.body, ...extra }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { status: "error", message: body?.error ?? `Request failed (${res.status}).` };
    }
    return { status: "done" };
  } catch {
    return { status: "error", message: "Network error — the request didn't reach the server." };
  }
}

export function InspectorDrawer({
  displayNode,
  canonicalNode,
  canonicalState,
  canonicalNodeById,
  incomingLinks,
  outgoingLinks,
  rootWorkId,
  anchorScreenX,
  viewportWidth,
  device,
  viewportHeight,
  writerEnabled = false,
  onClose,
}: InspectorDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const open = displayNode !== null;

  useDialogEscape(open, onClose);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open, displayNode?.id]);

  // Per-action submit state, keyed by action id — resets whenever the
  // selection changes so a prior node's "Saved" confirmation never lingers
  // on a freshly-selected different node.
  const [actionStatus, setActionStatus] = useState<Record<string, ActionStatus>>({});
  const [openField, setOpenField] = useState<{ actionId: string; value: string } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActionStatus({});
    setOpenField(null);
  }, [displayNode?.id]);

  // --- Mobile bottom-sheet snap state (charter §10 Mobile bullet). Ignored
  // entirely on desktop — kept in this same component (rather than a
  // separate stateful child) so a fresh selection resets BOTH the action
  // state above and the sheet's snap position in one effect, and so the
  // sheet's drag handlers have direct access to the same `displayNode`
  // identity check without re-deriving it. ---
  const [snapIndex, setSnapIndex] = useState<InspectorSheetSnapIndex>(INSPECTOR_SHEET_DEFAULT_SNAP_INDEX);
  const [dragFraction, setDragFraction] = useState<number | null>(null); // non-null only while a pointer drag is live
  const dragStartRef = useRef<{ pointerId: number; startY: number; startFraction: number } | null>(null);
  /** Distinguishes a real drag from a tap — a `pointerdown`/`pointerup` pair
   *  with no meaningful movement between them still fires a native `click`
   *  afterward, which must cycle the snap point (the tap affordance); a
   *  `pointerup` that ends a genuine drag must NOT also cycle on top of
   *  whatever the drag itself just snapped to. */
  const draggedRef = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSnapIndex(INSPECTOR_SHEET_DEFAULT_SNAP_INDEX);
    setDragFraction(null);
    dragStartRef.current = null;
  }, [displayNode?.id]);

  if (!displayNode) return null;

  // Opens opposite the selected node's projected X — a node clicked on the
  // right half of the viewport gets a LEFT-side drawer, and vice versa, so
  // the drawer never overlaps the very node the user just selected.
  // (Desktop only — the mobile sheet is always bottom-anchored, full width.)
  const openOnLeft = anchorScreenX !== null && anchorScreenX > viewportWidth / 2;

  const canonicalType = canonicalNode?.type as NodeType | undefined;
  const destination = resolveDestination(displayNode, canonicalNode);
  const { available: availableActions, unavailable: unavailableActions } = resolveNodeScholarlyActions(displayNode);
  const readingStatusTarget = resolveReadingStatusTarget(displayNode, rootWorkId);
  const citedOnly = resolveCitedOnlyInfo(canonicalNode);
  const writerInsertionCandidate = writerEnabled ? resolveWriterInsertionCandidate(displayNode) : null;

  async function run(action: ScholarlyAction, extra: Record<string, unknown> = {}) {
    setActionStatus((prev) => ({ ...prev, [action.id]: { status: "pending" } }));
    const result = await submitAction(action.request, extra);
    setActionStatus((prev) => ({ ...prev, [action.id]: result }));
    if (result.status === "done") setOpenField(null);
  }

  const DRAG_MOVE_THRESHOLD_PX = 4;

  function handleHandlePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedRef.current = false;
    dragStartRef.current = { pointerId: event.pointerId, startY: event.clientY, startFraction: INSPECTOR_SHEET_SNAP_FRACTIONS[snapIndex] };
  }
  function handleHandlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaY) >= DRAG_MOVE_THRESHOLD_PX) draggedRef.current = true;
    if (draggedRef.current) setDragFraction(dragFractionFromDelta(drag.startFraction, deltaY, viewportHeight));
  }
  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    if (draggedRef.current) {
      const finalFraction = dragFraction ?? INSPECTOR_SHEET_SNAP_FRACTIONS[snapIndex];
      setSnapIndex(nearestSnapIndex(finalFraction));
      setDragFraction(null);
    }
    // A tap (draggedRef.current still false here) falls through to the
    // native `click` event next, handled by `cycleSnap` below — deliberately
    // NOT handled here, so a real click/keyboard activation (Enter/Space,
    // which never fires pointer events at all) still works identically.
  }
  /** Non-drag accessible affordance for the same three snap points — a tap
   *  or Enter/Space on the handle (it's a real `<button>`) cycles forward
   *  through 28% → 70% → 95% → 28%, so resizing the sheet never requires a
   *  drag gesture. Skipped when this click is the tail end of a genuine
   *  drag (see `draggedRef`'s doc comment). */
  function cycleSnap() {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setSnapIndex(((snapIndex + 1) % INSPECTOR_SHEET_SNAP_FRACTIONS.length) as InspectorSheetSnapIndex);
  }

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {canonicalType ? TYPE_LABEL[canonicalType] : displayNode.displayKind}
          </p>
          <h2 className="break-words text-base font-semibold text-[var(--color-text)]">{displayNode.label}</h2>
        </div>
        <button ref={closeButtonRef} type="button" onClick={onClose} className="app-control min-h-11 shrink-0 rounded px-2 py-1 text-xs md:min-h-0" aria-label="Close inspector">
          Close
        </button>
      </div>

      {canonicalState && (
        <p className="text-xs" style={{ color: `var(${STATE_META[canonicalState].colorVar})` }}>
          {STATE_META[canonicalState].label}
        </p>
      )}

      {displayNode.unavailableReason && (
        <p className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-muted)]">{displayNode.unavailableReason}</p>
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

      {/* Debate/claim metadata (charter §12) */}
      {canonicalNode?.type === "debate" && (
        <div className="text-xs text-[var(--color-text-muted)]">
          {canonicalNode.debateQuestion && <p className="italic">“{canonicalNode.debateQuestion}”</p>}
          <p>{canonicalNode.debateClaimCount ?? 0} claim{canonicalNode.debateClaimCount === 1 ? "" : "s"}</p>
        </div>
      )}
      {canonicalNode?.type === "claim" && (
        <div className="text-xs text-[var(--color-text-muted)]">
          {canonicalNode.claimNature && <p>Nature: {canonicalNode.claimNature}</p>}
          {canonicalNode.valenceSummary && <p>{canonicalNode.valenceSummary}</p>}
        </div>
      )}

      {/* Destination */}
      <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-3">
        {destination === null ? null : "href" in destination ? (
          <Link href={destination.href} className="app-control rounded border border-[var(--color-border)] px-3 py-1.5 text-center text-xs font-medium">
            Open
          </Link>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">{destination.unavailableReason}</p>
        )}
      </div>

      {/* Insert into Writer (charter §6 "Write", integration step
          "writer-insertion-dialogs") — only ever rendered when real
          quotable content already exists on this node (a claim's own text,
          see `resolveWriterInsertionCandidate`'s own doc comment). */}
      {writerInsertionCandidate && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <InsertIntoWriterButton
            quote={writerInsertionCandidate.quote}
            attribution={writerInsertionCandidate.attribution}
            sourceLabel="Knowledge Map"
            className="app-control w-full rounded border border-[var(--color-border)] px-3 py-1.5 text-center text-xs font-medium"
          />
        </div>
      )}

      {/* Cited-only work (charter §12's closing paragraph) */}
      {citedOnly && (
        <div className="border-t border-[var(--color-border)] pt-3 text-xs">
          <h3 className="mb-1 font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Not in your library</h3>
          <p className="text-[var(--color-text-muted)]">This work is only known from a citation — its own full text isn&rsquo;t available here.</p>
          {citedOnly.citingWorkIds.length > 0 && (
            <p className="mt-1 text-[var(--color-text-muted)]">
              Cited by{" "}
              {citedOnly.citingWorkIds.map((workId, index) => (
                <span key={workId}>
                  {index > 0 && ", "}
                  <Link href={`/works/${workId}/reader`} className="underline">
                    {canonicalNodeById?.get(`work:${workId}`)?.label ?? "an uploaded work"}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
          <Link href="/upload" className="app-control mt-2 inline-block rounded border border-[var(--color-border)] px-3 py-1.5 text-center font-medium">
            Upload or acquire this work
          </Link>
        </div>
      )}

      {/* Relationships (charter §12) */}
      <RelationshipSection title="Incoming relationships" entries={incomingLinks} rootWorkId={rootWorkId} />
      <RelationshipSection title="Outgoing relationships" entries={outgoingLinks} rootWorkId={rootWorkId} />

      {/* Reading status / mastery (charter §12) */}
      {readingStatusTarget && <ReadingStatusForm target={readingStatusTarget} />}

      {/* Scholarly actions (charter §12 / spec §3) */}
      <div className="border-t border-[var(--color-border)] pt-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Actions</h3>
        <div className="flex flex-col gap-2">
          {availableActions.map((action) => (
            <ScholarlyActionControl
              key={action.id}
              action={action}
              status={actionStatus[action.id] ?? { status: "idle" }}
              openField={openField?.actionId === action.id ? openField.value : null}
              onOpenField={(value) => setOpenField({ actionId: action.id, value })}
              onCloseField={() => setOpenField(null)}
              onRun={run}
            />
          ))}
          {unavailableActions.map((action) => (
            <p key={action.id} className="text-xs text-[var(--color-text-muted)]">
              <span className="font-medium">{action.label}:</span> {action.reason}
            </p>
          ))}
        </div>
      </div>
    </>
  );

  if (device === "mobile") {
    const currentFraction = dragFraction ?? INSPECTOR_SHEET_SNAP_FRACTIONS[snapIndex];
    const heightPx = sheetHeightPx(currentFraction, viewportHeight);
    const isDragging = dragFraction !== null;
    return (
      <section
        data-testid="knowledge-map-inspector"
        aria-label={`Inspector: ${displayNode.label}`}
        className={`app-reveal fixed inset-x-0 bottom-0 z-30 flex flex-col gap-3 overflow-hidden rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-background)] p-4 pt-2 text-sm shadow-2xl ${isDragging ? "" : "app-sheet-snap"}`}
        style={{ height: `${heightPx}px`, paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onPointerDown={handleHandlePointerDown}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={cycleSnap}
          aria-label={`Resize inspector panel. Currently ${Math.round(INSPECTOR_SHEET_SNAP_FRACTIONS[snapIndex] * 100)}% of the screen. Tap to resize, or drag.`}
          className="app-control -mx-2 flex min-h-11 shrink-0 touch-none items-center justify-center"
        >
          <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-[var(--color-border)]" />
        </button>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">{content}</div>
      </section>
    );
  }

  return (
    <aside
      data-testid="knowledge-map-inspector"
      aria-label={`Inspector: ${displayNode.label}`}
      className={`app-reveal absolute top-2 z-30 flex max-h-[calc(100%-1rem)] w-[360px] max-w-[92vw] flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-sm shadow-xl ${openOnLeft ? "left-2" : "right-2"}`}
    >
      {content}
    </aside>
  );
}

function ScholarlyActionControl({
  action,
  status,
  openField,
  onOpenField,
  onCloseField,
  onRun,
}: {
  action: ScholarlyAction;
  status: ActionStatus;
  openField: string | null;
  onOpenField: (value: string) => void;
  onCloseField: () => void;
  onRun: (action: ScholarlyAction, extra?: Record<string, unknown>) => void;
}) {
  const needsInput = action.requiresReason || (action.requiresFields && action.requiresFields.length > 0);
  const fieldName = action.requiresReason ? "reason" : action.requiresFields?.[0];
  const isOpen = openField !== null;

  return (
    <div>
      {!needsInput ? (
        <button
          type="button"
          onClick={() => onRun(action)}
          disabled={status.status === "pending"}
          className="app-control w-full rounded border border-[var(--color-border)] px-3 py-1.5 text-left text-xs font-medium disabled:opacity-50"
        >
          {status.status === "pending" ? "Working…" : action.label}
        </button>
      ) : isOpen ? (
        <div className="flex flex-col gap-1.5 rounded border border-[var(--color-border)] p-2">
          <label className="text-xs font-medium" htmlFor={`action-field-${action.id}`}>
            {action.label}
          </label>
          <textarea
            id={`action-field-${action.id}`}
            value={openField}
            onChange={(event) => onOpenField(event.target.value)}
            rows={2}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] p-1.5 text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={status.status === "pending" || openField.trim().length === 0}
              onClick={() => fieldName && onRun(action, { [fieldName]: openField.trim() })}
              className="app-control rounded border border-[var(--color-border)] px-2 py-1 text-xs font-medium disabled:opacity-50"
            >
              {status.status === "pending" ? "Working…" : "Submit"}
            </button>
            <button type="button" onClick={onCloseField} className="app-control rounded px-2 py-1 text-xs">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => onOpenField("")} className="app-control w-full rounded border border-[var(--color-border)] px-3 py-1.5 text-left text-xs font-medium">
          {action.label}
        </button>
      )}
      {status.status === "done" && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Saved — reload to see this reflected in the graph.</p>}
      {status.status === "error" && <p className="mt-1 text-xs text-[var(--color-critical-fg,#c99b9b)]">{status.message}</p>}
    </div>
  );
}

function ReadingStatusForm({ target }: { target: NonNullable<ReturnType<typeof resolveReadingStatusTarget>> }) {
  const [readingStatus, setReadingStatus] = useState<"" | "planned" | "reading" | "completed" | "abandoned">("");
  const [understandingScore, setUnderstandingScore] = useState("");
  const [status, setStatus] = useState<ActionStatus>({ status: "idle" });

  async function save() {
    setStatus({ status: "pending" });
    const body: Record<string, unknown> = target.kind === "roadmap-item" ? { bibId: target.bibId } : {};
    if (readingStatus) body.readingStatus = readingStatus;
    if (understandingScore.trim()) {
      const score = Number(understandingScore);
      if (Number.isFinite(score)) body.understandingScore = Math.max(0, Math.min(100, Math.round(score)));
    }
    const result = await submitAction({ url: target.url, method: "POST", body: {} }, body);
    setStatus(result);
  }

  return (
    <div className="border-t border-[var(--color-border)] pt-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Reading status</h3>
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Status
          <select
            value={readingStatus}
            onChange={(event) => setReadingStatus(event.target.value as typeof readingStatus)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          >
            <option value="">Unset</option>
            <option value="planned">Planned</option>
            <option value="reading">Reading</option>
            <option value="completed">Completed</option>
            <option value="abandoned">Abandoned</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Understanding (0–100)
          <input
            type="number"
            min={0}
            max={100}
            value={understandingScore}
            onChange={(event) => setUnderstandingScore(event.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={status.status === "pending"}
          className="app-control rounded border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {status.status === "pending" ? "Saving…" : "Save reading status"}
        </button>
        {status.status === "done" && <p className="text-xs text-[var(--color-text-muted)]">Saved.</p>}
        {status.status === "error" && <p className="text-xs text-[var(--color-critical-fg,#c99b9b)]">{status.message}</p>}
      </div>
    </div>
  );
}

function RelationshipSection({
  title,
  entries,
  rootWorkId,
}: {
  title: string;
  entries: { link: KnowledgeMapDisplayLink; otherNode: KnowledgeMapDisplayNode | null }[];
  rootWorkId: string | null;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="border-t border-[var(--color-border)] pt-3">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{title}</h3>
      <ul className="flex flex-col gap-2 text-xs">
        {entries.map(({ link, otherNode }) => (
          <RelationshipRow key={String(link.id)} link={link} otherNode={otherNode} rootWorkId={rootWorkId} />
        ))}
      </ul>
    </div>
  );
}

function RelationshipRow({ link, otherNode, rootWorkId }: { link: KnowledgeMapDisplayLink; otherNode: KnowledgeMapDisplayNode | null; rootWorkId: string | null }) {
  const [status, setStatus] = useState<ActionStatus>({ status: "idle" });
  const { removeRelationship, markUncertain } = resolveLinkActions(link, rootWorkId);

  async function run(action: { request: ScholarlyActionRequest }) {
    setStatus({ status: "pending" });
    setStatus(await submitAction(action.request, {}));
  }

  return (
    <li className="rounded border border-[var(--color-border)] p-2">
      <p>
        <span className="font-medium">{link.displayFamily}</span>
        {link.aiInferred && <span className="ml-1 text-[10px] uppercase text-[var(--color-text-muted)]">AI-inferred</span>}
        {" — "}
        {otherNode?.label ?? "unknown node"}
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        {"request" in markUncertain ? (
          <button type="button" onClick={() => run(markUncertain)} disabled={status.status === "pending"} className="app-control rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] disabled:opacity-50">
            Mark uncertain
          </button>
        ) : (
          <span className="text-[10px] text-[var(--color-text-muted)]">{markUncertain.reason}</span>
        )}
      </div>
      {"reason" in removeRelationship && <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{removeRelationship.reason}</p>}
      {status.status === "done" && <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">Saved.</p>}
      {status.status === "error" && <p className="mt-1 text-[10px] text-[var(--color-critical-fg,#c99b9b)]">{status.message}</p>}
    </li>
  );
}
