"use client";

import { useMemo } from "react";
import Link from "next/link";
import { scoreBothDimensions } from "@ice/claims";
import { TIER_LABEL, type ReaderLevel } from "@ice/roadmap";
import { CATEGORY_META, categoryMetaFor, confidenceLabel } from "../shared/annotationMeta";
import { RelationBadge } from "../shared/annotationPrimitives";
import { ClaimScoreChips } from "../shared/ClaimScoreChips";
import {
  CREDIBILITY_DIMENSIONS,
  CREDIBILITY_DIMENSION_LABEL,
  EDGE_FAMILY_META,
  EDGE_FAMILY_ORDER,
  STATE_META,
  TYPE_LABEL,
  conceptKindLabel,
  edgeFamilyFor,
  edgeTypeLabel,
  type EdgeFamily,
  type GraphLink,
  type GraphNode,
  type RoadmapAnnotation,
} from "./types";

export const READER_LEVEL_LABEL: Record<ReaderLevel, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
};

/** Debate layer (Phase 28.4): `debate:<uuid>` → `<uuid>`, the id shape the
 *  expansion route (`GET /api/graph/debate/[clusterId]/expand`) expects. */
function debateClusterIdFromNodeId(nodeId: string): string {
  return nodeId.startsWith("debate:") ? nodeId.slice("debate:".length) : nodeId;
}

/**
 * Display-language override for the inspector's roadmap disclosure (feature
 * plan §2.4): the stored `relationship_category` enum value never changes —
 * `ai_inferred` keeps meaning exactly what it always has everywhere else in
 * the app (annotations, roadmap list) — only the STRING shown here, in this
 * one disclosure, is friendlier and carries no "AI" wording (owner
 * directive). Every other category reuses the shared `CATEGORY_META` label
 * so the two surfaces can't drift on wording for the other nine values.
 */
function roadmapCategoryDisplay(category: RoadmapAnnotation["category"]): string {
  if (category === "ai_inferred") return "Inferred connection — uncertain until you verify it by reading";
  return CATEGORY_META[category]?.label ?? category.replace(/_/g, " ");
}

/**
 * Mechanically assembles the inspector's "why this, here" basis line from
 * fields the contract actually carries (feature plan §2.4) — category,
 * confidence, and which selected root(s) reached this node — never a model
 * call and never a fabricated field (no run/date is recorded on
 * `RoadmapAnnotation`, so none is invented here; see `remainingWork`).
 */
function roadmapBasisLine(annotation: RoadmapAnnotation, allNodes: readonly GraphNode[]): string {
  const rootLabels = annotation.rootWorkIds
    .map((id) => allNodes.find((node) => node.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  const rootPart = rootLabels.length > 0 ? ` — found via ${rootLabels.join(", ")}` : "";
  return `Basis: ${roadmapCategoryDisplay(annotation.category)}${rootPart} · confidence ${Math.round(annotation.confidence * 100)}%`;
}

function sourceTextLabel(status: string, accessStatus?: string | null) {
  if (status === "open_access_indexed") return "Open-access source text indexed from license-evidenced metadata.";
  if (status === "open_access_available") return "Open-access source confirmed; its text was not automatically indexed.";
  if (status === "retrieval_failed") return "Open-access source confirmed; automatic retrieval failed, so it remains metadata-only.";
  return accessStatus === "open" ? "Open source record; no eligible source text has been indexed." : "Metadata only — Palimnote did not retrieve source text without license evidence.";
}

function EvidenceAnchors({ evidence, enableEvidenceChips }: { evidence: unknown; enableEvidenceChips: boolean }) {
  const record = evidence && typeof evidence === "object" ? evidence as { sourceClaims?: { claim?: string; excerpt?: string }[]; targetClaims?: { claim?: string; excerpt?: string }[] } : null;
  if (!record) return null;
  const anchors = [...(record.sourceClaims ?? []), ...(record.targetClaims ?? [])].slice(0, 6);
  if (!anchors.length) return null;
  return <ul className="mt-3 space-y-2 border-l-2 border-[var(--color-border)] pl-3 text-xs text-[var(--color-text-muted)]" aria-label="Grounded claim evidence">
    {anchors.map((anchor, index) => (
      <li key={index}>
        <span className="font-medium text-[var(--color-text)]">{anchor.claim}</span>{anchor.excerpt ? <span> — “{anchor.excerpt}”</span> : null}
        {/* Phase 29.3 reverse-direction lane, `phase25FeatureEnabled("research")`
         *  (no new flag): scores this `work_claim.claim` text at render time
         *  with `@ice/claims`'s `scoreBothDimensions` — pure regex, free,
         *  nothing persisted (see `ClaimView`'s sibling doc comment in
         *  EditionReader.tsx for the full rationale). */}
        {enableEvidenceChips && anchor.claim && <EvidenceAnchorScoreChips text={anchor.claim} />}
      </li>
    ))}
  </ul>;
}

function EvidenceAnchorScoreChips({ text }: { text: string }) {
  const scores = useMemo(() => scoreBothDimensions(text), [text]);
  return <ClaimScoreChips scores={scores} className="mt-1 flex flex-wrap gap-1" />;
}

/**
 * A single credibility dimension as BOTH text and a bar (dataviz posture:
 * never color/length alone) — the percentage is printed, the bar is a
 * secondary visual reinforcement. `value == null` renders "Not assessed"
 * rather than a fabricated 0%, matching the contract's own "absent means no
 * data" rule for this field.
 */
function DimensionMeter({ label, value }: { label: string; value: number | null }) {
  const pct = value == null ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 text-[var(--color-text-muted)]">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]" role="presentation">
        {pct != null && <span className="block h-full rounded-full bg-[var(--color-accent-ink)]" style={{ width: `${pct}%` }} />}
      </span>
      <span className="w-20 shrink-0 text-right text-[var(--color-text-muted)]">{pct == null ? "Not assessed" : `${pct}%`}</span>
    </div>
  );
}

/**
 * Facts jsonb (`creator`/`popularity`) are displayed, never scored — render
 * whatever shape is actually present defensively rather than assuming a
 * fixed object shape the DB doesn't enforce (both columns are plain
 * `jsonb`). Falls back to a compact JSON dump for any shape this doesn't
 * recognize, so a new provider's payload is never silently dropped.
 */
function factLine(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("name" in record || "identity" in record) {
      const name = record.name ?? record.identity;
      const corroboration = record.corroboration ?? record.corroboratedBy ?? record.basis;
      return corroboration ? `${name} (${corroboration})` : String(name);
    }
    if ("value" in record) {
      const unit = record.unit ? ` ${record.unit}` : "";
      const provider = record.provider ? ` — ${record.provider}` : "";
      return `${record.value}${unit}${provider}`;
    }
    try {
      return JSON.stringify(record);
    } catch {
      return null;
    }
  }
  return String(value);
}

/**
 * Groups a node's direct connections by edge family (plan §21's
 * `EDGE_FAMILY_ORDER`) — the same grouping the edge-color legend already
 * uses, so "Structure" / "Reference" / etc. mean the same thing here as
 * everywhere else on the page. Each connection line carries a `readerLevel`
 * chip when the underlying edge (a `resource_role`/`passage_annotation`
 * projection) actually carries one — absent otherwise, never fabricated.
 */
function groupConnectionsByFamily(
  connections: { node: GraphNode; link: GraphLink }[],
): { family: EdgeFamily; items: { node: GraphNode; link: GraphLink }[] }[] {
  const byFamily = new Map<EdgeFamily, { node: GraphNode; link: GraphLink }[]>();
  for (const item of connections) {
    const family = edgeFamilyFor(item.link.edgeType, item.link.category);
    byFamily.set(family, [...(byFamily.get(family) ?? []), item]);
  }
  return EDGE_FAMILY_ORDER.filter((family) => byFamily.has(family)).map((family) => ({ family, items: byFamily.get(family)! }));
}

/**
 * The Visualization inspector (extracted from `GraphView.tsx`, Graph P2):
 * identity → credibility dossier → reader-level chips → concept summary/
 * mastery → roadmap disclosure → provenance → connections grouped by edge
 * family. Every section is conditionally rendered on the underlying data
 * actually being present — nothing here fabricates a value for a field its
 * source rows don't carry (same posture the data contract itself documents).
 */
export function GraphInspector({
  selected,
  selectedLink,
  connections,
  onSelectNode,
  onCloseNode,
  onCloseLink,
  allNodes = [],
  onExpandDebate,
  expandedDebateClusterIds,
  expandingDebateId,
  enableEvidenceChips = false,
}: {
  selected: GraphNode | null;
  selectedLink: GraphLink | null;
  connections: { node: GraphNode; link: GraphLink }[];
  onSelectNode: (node: GraphNode) => void;
  onCloseNode: () => void;
  onCloseLink: () => void;
  /** The FULL, unfiltered node set — used only to resolve a roadmap
   *  annotation's `rootWorkIds` back to human-readable work titles for the
   *  "why this, here" basis line (feature plan §2.4); never used to change
   *  which node is selected. */
  allNodes?: readonly GraphNode[];
  /** Debate layer (Phase 28.4): the "Show claims" control's handler and its
   *  loading/already-expanded state. All three are optional and simply
   *  render nothing when omitted — this inspector has other callers besides
   *  `GraphView` (Roadmap's own graph surfaces) that may not wire the debate
   *  layer at all; a `selected.type === "debate"` node just never shows the
   *  control in that case rather than throwing. */
  onExpandDebate?: (clusterId: string) => void;
  expandedDebateClusterIds?: ReadonlySet<string>;
  expandingDebateId?: string | null;
  /** Phase 29.3 reverse-direction lane, `phase25FeatureEnabled("research")`
   *  (no new flag): shows render-time evidence-strength/textual-support
   *  chips on `EvidenceAnchors`' `work_claim` text. */
  enableEvidenceChips?: boolean;
}) {
  const groupedConnections = groupConnectionsByFamily(connections);
  const creatorFact = selected ? factLine(selected.credibility?.creator) : null;
  const popularityFact = selected ? factLine(selected.credibility?.popularity) : null;
  return (
    <aside className={`max-h-[520px] overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 ${selected || selectedLink ? "app-panel-enter app-selected" : ""}`} aria-label="Graph inspector" data-graph-inspector>
      {!selected && !selectedLink && <p className="text-sm text-[var(--color-text-muted)]">Select a graph node or a table row to inspect its source, access, and provenance. Select a link for relationship evidence.</p>}
      {selected && (
        <div>
          {/* Identity */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-[var(--color-text)]">{selected.label}</p>
              {selected.authors && <p className="text-sm text-[var(--color-text-muted)]">{selected.authors}</p>}
            </div>
            <button type="button" className="app-control text-xs underline" onClick={onCloseNode}>Close</button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {TYPE_LABEL[selected.type]} · {STATE_META[selected.state].label}{selected.year ? ` · ${selected.year}` : ""}
            {selected.kind ? ` · ${conceptKindLabel(selected.kind)}` : ""}
            {selected.workRole ? ` · ${selected.workRole}` : ""}
          </p>
          {selected.venue && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{selected.venue}</p>}
          {selected.doi && <p className="mt-1 text-xs text-[var(--color-text-muted)]">DOI: {selected.doi}</p>}
          {selected.supplementary && <p className="mt-2 rounded border border-[var(--color-credibility-warning)] px-2 py-1 text-xs text-[var(--color-text-muted)]">Supplementary public material — useful context, not stand-alone factual support.</p>}

          {/* Debate layer (Phase 28.4): a debate cluster's research question
              + claim count, and the "Show claims" control that fetches and
              merges that cluster's expansion delta — the ONE control this
              feature exposes, shared by both the 3D scene and the
              accessible table since both drive selection through the same
              `onNodeClick`/`selected` state this inspector already renders
              from (see `GraphView`'s own comment on why this satisfies
              "reachable... in both views" without a second, duplicated
              control). */}
          {selected.type === "debate" && (() => {
            const clusterId = debateClusterIdFromNodeId(selected.id);
            const alreadyExpanded = expandedDebateClusterIds?.has(clusterId) ?? false;
            const isExpanding = expandingDebateId === clusterId;
            return (
              <div className="mt-3 rounded border border-[var(--color-border)] p-2 text-xs" data-graph-debate-panel>
                {selected.debateQuestion && <p className="italic text-[var(--color-text-muted)]">“{selected.debateQuestion}”</p>}
                <p className={selected.debateQuestion ? "mt-2 text-[var(--color-text-muted)]" : "text-[var(--color-text-muted)]"}>
                  {selected.debateClaimCount ?? 0} claim{selected.debateClaimCount === 1 ? "" : "s"} in this debate
                </p>
                {onExpandDebate && (
                  <button
                    type="button"
                    data-graph-expand-debate
                    disabled={alreadyExpanded || isExpanding}
                    onClick={() => onExpandDebate(clusterId)}
                    className="app-control mt-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadyExpanded ? "Claims shown" : isExpanding ? "Loading claims…" : "Show claims"}
                  </button>
                )}
              </div>
            );
          })()}
          {selected.type === "claim" && (
            <div className="mt-3 rounded border border-[var(--color-border)] p-2 text-xs" data-graph-claim-panel>
              {selected.claimNature && <p className="text-[var(--color-text-muted)]">Claim nature: {selected.claimNature}</p>}
              {selected.valenceSummary && <p className={selected.claimNature ? "mt-1 text-[var(--color-text-muted)]" : "text-[var(--color-text-muted)]"}>{selected.valenceSummary}</p>}
            </div>
          )}
          {(selected.providers?.length ?? 0) > 1 && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Providers: {selected.providers!.join(", ")}</p>}

          {/* Credibility dossier (plan §33/§34.2): authority + the six
              separated dimensions as labeled text+bar meters, rationale as
              quoted prose, creator/popularity presented as facts (never
              scored). Renders only what the underlying assessment actually
              carries — a node with no `credibility` still shows the legacy
              authority/score line above if it has one, but nothing below. */}
          {selected.authority && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Authority {selected.authority}{selected.credibilityScore != null ? ` · credibility ${Math.round(selected.credibilityScore * 100)}%` : ""}</p>}
          {selected.credibility && (
            <div className="mt-3 rounded border border-[var(--color-border)] p-2" data-graph-credibility-dossier>
              <p className="text-xs font-medium text-[var(--color-text)]">Credibility dossier</p>
              <div className="mt-2 space-y-1.5">
                {CREDIBILITY_DIMENSIONS.map((key) => (
                  <DimensionMeter key={key} label={CREDIBILITY_DIMENSION_LABEL[key]} value={selected.credibility![key]} />
                ))}
              </div>
              {selected.credibility.peerReviewed != null && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">{selected.credibility.peerReviewed ? "Peer reviewed" : "Not peer reviewed"}</p>
              )}
              {selected.credibility.rationale && (
                <blockquote className="mt-2 border-l-2 border-[var(--color-border)] pl-2 text-xs italic text-[var(--color-text-muted)]">“{selected.credibility.rationale}”</blockquote>
              )}
              {creatorFact && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Creator: {creatorFact}</p>}
              {popularityFact && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Popularity: {popularityFact}</p>}
            </div>
          )}

          {/* Reader-level chips (Graph P2, data contract v2): the union of
              levels this node's role data applies at — absent entirely when
              the node carries no `resource_role` data (never rendered as
              "matches nothing"). */}
          {(selected.readerLevels?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Reader levels" data-graph-reader-level-chips>
              {selected.readerLevels!.map((level) => (
                <span key={level} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  {READER_LEVEL_LABEL[level as ReaderLevel] ?? level}
                </span>
              ))}
            </div>
          )}

          {/* Concept summary + raw mastery text (concept/person nodes) */}
          {selected.summary && <p className="mt-3 text-xs text-[var(--color-text-muted)]">{selected.summary}</p>}
          {(selected.aliases?.length ?? 0) > 0 && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Also known as: {selected.aliases!.join(", ")}</p>}
          {selected.masteryScore != null && <p className="mt-1 text-xs text-[var(--color-text-muted)]" data-graph-mastery-text>Mastery: {Math.round(selected.masteryScore)}/100</p>}

          {selected.sourceTextStatus && (
            <div className="mt-3 rounded border border-[var(--color-border)] p-2 text-xs">
              <p className="font-medium text-[var(--color-text)]">Source access</p>
              <p className="mt-1 text-[var(--color-text-muted)]">{sourceTextLabel(selected.sourceTextStatus, selected.accessStatus)}</p>
              {selected.license && <p className="mt-1 text-[var(--color-text-muted)]">License evidence: {selected.license}</p>}
              {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline">open licensed source ↗</a>}
            </div>
          )}
          {(selected.provenances?.length ?? 0) > 0 && <div className="mt-3 text-xs text-[var(--color-text-muted)]"><p className="font-medium text-[var(--color-text)]">Provenance</p><ul className="mt-1 space-y-1">{selected.provenances!.map((provenance) => <li key={`${provenance.runId}:${provenance.provider}`}>{provenance.provider} · inspection depth {provenance.inspectionDepth}{provenance.inspectedAt ? ` · ${new Date(provenance.inspectedAt).toLocaleDateString()}` : ""}</li>)}</ul></div>}
          {selected.destination && (
            <p className="mt-3">
              <Link href={selected.destination} className="text-sm underline">
                {selected.type === "work" ? "Open work" : "View Library entry"}
              </Link>
            </p>
          )}
          {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm underline">open source record ↗</a>}
          {selected.roadmap && (
            <details className="mt-3 rounded border border-[var(--color-border)] p-2 text-xs" data-graph-roadmap-disclosure>
              <summary className="cursor-pointer font-medium text-[var(--color-text)]">Why this, here</summary>
              <p className="mt-2 text-[var(--color-text-muted)]">
                {selected.roadmap.reason} <span className="text-[var(--color-text-muted)]">({TIER_LABEL[selected.roadmap.tier]})</span>
              </p>
              <p className="mt-2 text-[var(--color-text-muted)]">{roadmapBasisLine(selected.roadmap, allNodes)}</p>
              <p className="mt-2 italic text-[var(--color-text-muted)]">{selected.roadmap.checkpoint}</p>
              {selected.roadmap.estimatedMinutes > 0 && (
                <p className="mt-2 text-[var(--color-text-muted)]">Estimated reading time: {Math.round(selected.roadmap.estimatedMinutes / 60) || 1}h</p>
              )}
            </details>
          )}

          {/* Connections grouped by edge family (Graph P2) */}
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-medium text-[var(--color-text)]">Direct connections</p>
            {groupedConnections.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">No visible direct connections under the current filters.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {groupedConnections.map(({ family, items }) => (
                  <div key={family}>
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      <span aria-hidden className="inline-block h-0.5 w-4 rounded-full" style={{ background: `var(${EDGE_FAMILY_META[family].colorVar})` }} />
                      {EDGE_FAMILY_META[family].label}
                    </p>
                    <ul className="mt-1 space-y-1.5">
                      {items.map(({ node, link }) => (
                        <li key={`${node.id}:${link.edgeType}`} className="flex flex-wrap items-center gap-1.5">
                          <button type="button" onClick={() => onSelectNode(node)} className="app-control text-left text-xs underline underline-offset-2">
                            <span className="font-medium">{node.label}</span> · {categoryMetaFor(link.category)?.label ?? edgeTypeLabel(link.edgeType)}
                          </button>
                          {link.readerLevel && (
                            <span className="rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">
                              {READER_LEVEL_LABEL[link.readerLevel as ReaderLevel] ?? link.readerLevel}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {selectedLink && (() => {
        // D-21-8/D-21-9 fix: an edge that carries a relationship_category
        // (the classification/citation/resource-role/passage-annotation
        // edges D-21-9 populates `category` for) is presented with the
        // SAME glyph + label + qualitative confidence band the annotation
        // sidebars use for that category (`CATEGORY_META`/`confidenceLabel`,
        // via `RelationBadge` — the shared presentation primitive both
        // surfaces now draw from), never a second, diverging label for the
        // same underlying concept. An edge with no category (source-relation,
        // discovery, and structural edges genuinely carry none) keeps the
        // honest, undecorated edge-type-string fallback instead of a
        // fabricated category.
        const meta = categoryMetaFor(selectedLink.category);
        return (
          <div className={selected ? "mt-5 border-t border-[var(--color-border)] pt-4" : ""} data-graph-evidence>
            <div className="flex items-start justify-between gap-2">
              {meta ? (
                <RelationBadge colorVar={meta.colorVar} glyph={meta.glyph} label={meta.label} />
              ) : (
                <p className="font-medium text-[var(--color-text)]">{edgeTypeLabel(selectedLink.edgeType)}</p>
              )}
              <button type="button" className="app-control text-xs underline" onClick={onCloseLink}>Close</button>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{selectedLink.explanation ?? "Relationship evidence is recorded with the source relation."}</p>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]" data-graph-link-confidence>
              {meta ? `${confidenceLabel(selectedLink.confidence)} · ${Math.round(selectedLink.confidence * 100)}%` : `Confidence ${Math.round(selectedLink.confidence * 100)}%`}
              {" · "}{selectedLink.directed === false ? "bidirectional" : "directed"}{selectedLink.provenance ? ` · provenance depth ${selectedLink.provenance.depth}` : ""}
              {selectedLink.readerLevel ? ` · ${READER_LEVEL_LABEL[selectedLink.readerLevel as ReaderLevel] ?? selectedLink.readerLevel}` : ""}
            </p>
            {Boolean(selectedLink.evidence) && <EvidenceAnchors evidence={selectedLink.evidence} enableEvidenceChips={enableEvidenceChips} />}
            {(selectedLink.provenances?.length ?? 0) > 1 && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Merged from {selectedLink.provenances!.length} evidence/provenance records.</p>}
          </div>
        );
      })()}
    </aside>
  );
}
