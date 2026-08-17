/**
 * Band assignment (charter §8): layer mapping for every `DisplayKind`, the
 * `BAND_GAP` formula, and world-Z placement with bounded jitter.
 */

import { isDisplayOnlyKind, type CanonicalNodeTypeMirror, type DisplayKind, type DisplayOnlyKind } from "./kinds";
import { LAYER_BAND_INDEX, type Layer } from "./layers";

/**
 * `computeBandGap(medianXYLinkDistance) = min(120, max(48, 1.25 × median))`
 * (charter §8, verbatim). `medianXYLinkDistance` is in the same world units
 * as the force layout's own X/Y link distances — this package does not
 * compute that median itself (that requires a live force-layout pass, a
 * renderer concern out of this pure package's scope); callers pass it in.
 */
export function computeBandGap(medianXYLinkDistance: number): number {
  return Math.min(120, Math.max(48, 1.25 * medianXYLinkDistance));
}

/** `0.08 × BAND_GAP` (charter §8) — the maximum magnitude of the
 *  meaningless within-band Z jitter. */
export function maxJitter(bandGap: number): number {
  return 0.08 * bandGap;
}

/**
 * `z = bandIndex × BAND_GAP`, optionally offset by a caller-supplied jitter
 * value clamped to `±maxJitter(bandGap)` — clamped here (not merely
 * documented as a caller obligation) so a caller cannot accidentally leak
 * jitter across a band boundary by passing an oversized value.
 */
export function zForLayer(layer: Layer, bandGap: number, jitter = 0): number {
  const cap = maxJitter(bandGap);
  const clampedJitter = Math.max(-cap, Math.min(cap, jitter));
  return LAYER_BAND_INDEX[layer] * bandGap + clampedJitter;
}

/**
 * Deterministic jitter generator (no `Math.random` — a pure package must
 * stay reproducible/testable). `seed` is typically the node's own stable
 * `DisplayNodeId`; two different ids reliably produce different jitter
 * without needing real randomness, and the SAME id always reproduces the
 * SAME jitter across renders (no visual jump on an unrelated re-render).
 */
export function deterministicJitter(seed: string, bandGap: number): number {
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Map the hash's low bits to [-1, 1), then scale to the jitter cap.
  const unit = ((hash >>> 0) % 2000) / 1000 - 1;
  return unit * maxJitter(bandGap);
}

/**
 * This package's own tested reference mapping for the 9 known canonical
 * `NodeType` values (see `kinds.ts`'s doc comment for the manual-sync
 * discipline this mirrors). `section` is placed in `evidence` rather than
 * `intellectual`: the baseline audit's data-source matrix (§9) found no
 * dedicated passage-level node kind in the current graph contract — `section`
 * (a work's own outline entry) is today's closest available proxy for
 * "evidence within a work," which is exactly the Evidence band's charter
 * definition ("passages, quotations, data, examples, methods"). This is a
 * judgment call, recorded here and in the README rather than left implicit.
 */
export const DEFAULT_CANONICAL_NODE_TYPE_LAYER: Readonly<Record<CanonicalNodeTypeMirror, Layer>> = {
  work: "intellectual",
  reference: "intellectual",
  peer_reviewed_source: "intellectual",
  online_source: "intellectual",
  concept: "intellectual",
  person: "intellectual",
  section: "evidence",
  claim: "claim",
  debate: "debate",
};

/**
 * Every `DisplayOnlyKind` EXCEPT `"aggregate"` maps statically to one layer
 * (charter §8's own per-kind examples). `"aggregate"` is deliberately
 * excluded from this table's type — an aggregate node summarizes a
 * (layer-homogeneous, by construction — see `disclosure.ts`) group of
 * hidden nodes, so its layer is always assigned directly from that group at
 * aggregate-creation time, never looked up from the kind alone. Modeling it
 * as "aggregate has a fixed default layer" would be actively wrong (an
 * aggregate of hidden claim nodes and an aggregate of hidden source nodes
 * belong in different bands), so this package does not pretend otherwise.
 */
export const DISPLAY_ONLY_KIND_LAYER: Readonly<Record<Exclude<DisplayOnlyKind, "aggregate">, Layer>> = {
  passage: "evidence",
  evidence: "evidence",
  question: "debate",
  position: "debate",
  learning_step: "learning",
  hypothesis: "research",
  gap: "research",
  writing_project: "research",
};

export class AggregateLayerLookupError extends Error {
  constructor() {
    super(
      '"aggregate" has no static layer — pass the aggregate node\'s own already-known layer directly, or use disclosure.ts\'s buildAggregateNode, which assigns it from the basis nodes it summarizes.',
    );
    this.name = "AggregateLayerLookupError";
  }
}

/**
 * Total over every `DisplayKind` EXCEPT `"aggregate"` (see
 * `DISPLAY_ONLY_KIND_LAYER`'s doc comment for why that exclusion is
 * intentional, not a gap). `canonicalLayer` lets a real caller supply the
 * actual canonical `NodeType` → layer mapping instead of this package's
 * default mirror; defaults to `DEFAULT_CANONICAL_NODE_TYPE_LAYER` so this
 * function works out of the box against today's known canonical kinds.
 */
export function layerForDisplayKind<TCanonicalKind extends string = CanonicalNodeTypeMirror>(
  kind: DisplayKind<TCanonicalKind>,
  canonicalLayer: (nodeType: TCanonicalKind) => Layer = (nodeType) =>
    DEFAULT_CANONICAL_NODE_TYPE_LAYER[nodeType as unknown as CanonicalNodeTypeMirror],
): Layer {
  if (isDisplayOnlyKind(kind)) {
    if (kind === "aggregate") throw new AggregateLayerLookupError();
    return DISPLAY_ONLY_KIND_LAYER[kind as Exclude<DisplayOnlyKind, "aggregate">];
  }
  return canonicalLayer(kind as TCanonicalKind);
}
