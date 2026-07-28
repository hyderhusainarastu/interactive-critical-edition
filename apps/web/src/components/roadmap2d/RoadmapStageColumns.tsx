"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TIER_LABEL, type RoadmapItem } from "@ice/roadmap";
import { TIER_COLOR, TierDot } from "@/components/shared/roadmapPrimitives";
import { CATEGORY_META } from "@/components/shared/annotationMeta";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";
import { layoutRoadmapStageColumns } from "./roadmapStageLayout";
import "./roadmap2d.css";

/**
 * 2D stage-column Roadmap (Stage 4 read spec §6) — replaces
 * `RoadmapConstellation`'s rotatable pseudo-3D canvas with a flat DAG:
 * column = priority tier, edge = root -> item only (spec §6.2: no
 * item-to-item edges exist in this data; inventing them would misrepresent
 * a tier assignment as a fully reasoned prerequisite graph). Real,
 * focusable DOM nodes in natural tab order (column by column, top to
 * bottom) — no canvas, no hit-testing, no keyboard trap (charter §17).
 *
 * The always-visible tier `<ol>` list in `RoadmapView.tsx` remains the
 * default, never-collapsed accessible view — this is its opt-in companion
 * visualization, same "Map"/"Table" toggle slot `RoadmapConstellation`
 * used to occupy.
 */
function formatMinutes(minutes: number): string {
  const hours = Math.round(minutes / 60);
  return hours > 0 ? `~${hours}h` : `~${minutes}m`;
}

export function RoadmapStageColumns({
  rootTitle,
  items,
  onMutate,
}: {
  rootTitle: string;
  items: RoadmapItem[];
  /** Optional quick actions from the detail pane (spec §6.4's "status/
   *  override controls") — the same `mutate(bibId, patch)` callback
   *  `RoadmapView.tsx` already passes to `RoadmapCard`. Omitting it just
   *  means the detail pane shows information without controls. */
  onMutate?: (bibId: string, patch: Record<string, unknown>) => void;
}) {
  const narrow = useNarrowViewport();
  const [selected, setSelected] = useState<string | null>(null);

  const layout = useMemo(() => layoutRoadmapStageColumns(items.map((item) => ({ bibId: item.bibId, tier: item.tier }))), [items]);
  const byBibId = useMemo(() => new Map(items.map((item) => [item.bibId, item])), [items]);
  const selectedItem = selected && selected !== "root" ? (byBibId.get(selected) ?? null) : null;
  const isRootSelected = selected === "root";

  function focusListItem(bibId: string) {
    document.querySelector(`[data-roadmap-item="${bibId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (items.length === 0) return null;

  return (
    <details className="app-reveal mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3" data-roadmap-stage-columns open>
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">Roadmap stage map</summary>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        A flat map by priority tier — one column per tier reached, ordered essential-first. Every edge runs from this
        work to an item; there are no item-to-item dependencies in this data. Select any item (click, or Tab then
        Enter/Space) for its detail. The table and the list below show the identical set.
      </p>

      {narrow ? (
        <StackedStageList
          rootTitle={rootTitle}
          layout={layout}
          items={items}
          selected={selected}
          onSelect={setSelected}
        />
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] p-4">
            <div className="roadmap-stage-canvas" style={{ width: layout.width, height: layout.height, minWidth: layout.width }}>
              <svg
                aria-hidden
                width={layout.width}
                height={layout.height}
                className="pointer-events-none absolute inset-0"
              >
                {layout.nodes.map((node) => {
                  const item = byBibId.get(node.bibId);
                  if (!item) return null;
                  const color = `var(${CATEGORY_META[item.category].colorVar})`;
                  return (
                    <line
                      key={node.bibId}
                      x1={layout.root.x}
                      y1={layout.root.y}
                      x2={node.x}
                      y2={node.y}
                      stroke={color}
                      strokeWidth={selected === node.bibId || selected === "root" ? 1.75 : 1}
                      strokeOpacity={0.55}
                    />
                  );
                })}
              </svg>

              <button
                type="button"
                data-roadmap-root
                className="roadmap-stage-root app-control rounded-full border-2 px-3 py-1.5 text-xs font-semibold"
                style={{
                  left: layout.root.x,
                  top: layout.root.y,
                  borderColor: "var(--color-accent-ink)",
                  background: "var(--color-accent-ink)",
                  color: "var(--color-background)",
                }}
                aria-current={isRootSelected ? "true" : undefined}
                onClick={() => setSelected("root")}
              >
                You are here
              </button>

              {layout.nodes.map((node) => {
                const item = byBibId.get(node.bibId);
                if (!item) return null;
                const isSelected = selected === node.bibId;
                return (
                  <button
                    key={node.bibId}
                    type="button"
                    data-roadmap-stage-node={node.bibId}
                    className="roadmap-stage-node app-control rounded-md border bg-[var(--color-surface)] px-2 py-1 text-left text-[0.7rem] shadow-sm"
                    style={{
                      left: node.x,
                      top: node.y,
                      maxWidth: 180,
                      borderColor: isSelected ? `var(${TIER_COLOR[item.tier]})` : "var(--color-border)",
                      borderWidth: isSelected ? 2 : 1,
                      opacity: item.known ? 0.55 : 1,
                    }}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => setSelected(node.bibId)}
                  >
                    <span className="flex items-center gap-1 font-semibold text-[var(--color-text)]">
                      {item.known && <span aria-hidden>✓</span>}
                      {item.sequence}. {item.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <RoadmapStageDetail
            rootTitle={rootTitle}
            isRootSelected={isRootSelected}
            selectedItem={selectedItem}
            onFocusListItem={focusListItem}
            onMutate={onMutate}
          />
        </div>
      )}
    </details>
  );
}

/** Narrow-viewport fallback (spec §6.3): columns stack top-to-bottom as a
 *  vertical stage list instead of the side-by-side canvas — still
 *  genuinely 2D, still no rotation, no horizontal-scroll-of-7-columns on a
 *  phone. */
function StackedStageList({
  rootTitle,
  layout,
  items,
  selected,
  onSelect,
}: {
  rootTitle: string;
  layout: ReturnType<typeof layoutRoadmapStageColumns>;
  items: RoadmapItem[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const byBibId = new Map(items.map((item) => [item.bibId, item]));
  const selectedItem = selected && selected !== "root" ? (byBibId.get(selected) ?? null) : null;
  const isRootSelected = selected === "root";

  return (
    <div className="mt-3 flex flex-col gap-4">
      <button
        type="button"
        className="app-control w-fit rounded-full border-2 px-3 py-1.5 text-xs font-semibold"
        style={{ borderColor: "var(--color-accent-ink)", background: "var(--color-accent-ink)", color: "var(--color-background)" }}
        aria-current={isRootSelected ? "true" : undefined}
        onClick={() => onSelect("root")}
      >
        You are here — {rootTitle}
      </button>

      {layout.columns.map((tier) => {
        const tierItems = items.filter((item) => item.tier === tier);
        return (
          <section key={tier}>
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide" style={{ color: `var(${TIER_COLOR[tier]})` }}>
              <TierDot colorVar={TIER_COLOR[tier]} />
              {TIER_LABEL[tier]}
            </h3>
            <ol className="mt-1.5 flex flex-col gap-1.5">
              {tierItems.map((item) => (
                <li key={item.bibId}>
                  <button
                    type="button"
                    className="app-control w-full rounded-md border bg-[var(--color-surface)] px-2 py-1.5 text-left text-sm"
                    style={{ borderColor: selected === item.bibId ? `var(${TIER_COLOR[item.tier]})` : "var(--color-border)" }}
                    aria-current={selected === item.bibId ? "true" : undefined}
                    onClick={() => onSelect(item.bibId)}
                  >
                    {item.known && <span aria-hidden>✓ </span>}
                    {item.sequence}. {item.title}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      {(isRootSelected || selectedItem) && (
        <RoadmapStageDetail
          rootTitle={rootTitle}
          isRootSelected={isRootSelected}
          selectedItem={selectedItem}
          onFocusListItem={() => {}}
        />
      )}
    </div>
  );
}

function RoadmapStageDetail({
  rootTitle,
  isRootSelected,
  selectedItem,
  onFocusListItem,
  onMutate,
}: {
  rootTitle: string;
  isRootSelected: boolean;
  selectedItem: RoadmapItem | null;
  onFocusListItem: (bibId: string) => void;
  onMutate?: (bibId: string, patch: Record<string, unknown>) => void;
}) {
  return (
    <aside className="rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm" aria-live="polite">
      {!isRootSelected && !selectedItem && <p className="text-[var(--color-text-muted)]">Select an item for details.</p>}
      {isRootSelected && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">This work</p>
          <p className="font-medium text-[var(--color-text)]">{rootTitle}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">The primary work at the center of this roadmap.</p>
        </>
      )}
      {selectedItem && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: `var(${TIER_COLOR[selectedItem.tier]})` }}>
            {TIER_LABEL[selectedItem.tier]}
          </p>
          <p className="font-medium text-[var(--color-text)]">
            {selectedItem.title}
            {selectedItem.year ? <span className="font-normal"> ({selectedItem.year})</span> : null}
          </p>
          {selectedItem.authors && <p className="text-xs text-[var(--color-text-muted)]">{selectedItem.authors}</p>}
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {CATEGORY_META[selectedItem.category].glyph} {CATEGORY_META[selectedItem.category].label} — {CATEGORY_META[selectedItem.category].gloss}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{selectedItem.reason}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {Math.round(selectedItem.confidence * 100)}% confidence · {formatMinutes(selectedItem.estimatedMinutes)}
          </p>
          {selectedItem.workId ? (
            <Link href={`/works/${selectedItem.workId}`} className="app-control mt-2 inline-block text-xs underline">
              Open work
            </Link>
          ) : (
            <button type="button" className="app-control mt-2 text-xs underline" onClick={() => onFocusListItem(selectedItem.bibId)}>
              View in list below
            </button>
          )}
          {onMutate && (
            <div className="mt-2 flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-2 text-xs">
              <button
                type="button"
                className="app-control underline"
                onClick={() => onMutate(selectedItem.bibId, { understandingScore: selectedItem.known ? 0 : 80 })}
              >
                {selectedItem.known ? "Mark not known" : "Mark known"}
              </button>
              <button type="button" className="app-control underline" onClick={() => onMutate(selectedItem.bibId, { hidden: true })}>
                Hide
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

