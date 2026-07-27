/**
 * The six semantic depth bands (charter §8) and their fixed index order.
 * Index is what `z = bandIndex * BAND_GAP` (see `bands.ts`) actually
 * multiplies — the band NAME is the stable, meaningful identifier a
 * `DisplayNode.layer` carries; the index is a derived rendering detail.
 */
export type Layer = "evidence" | "intellectual" | "claim" | "debate" | "learning" | "research";

export const LAYER_ORDER: readonly Layer[] = ["evidence", "intellectual", "claim", "debate", "learning", "research"];

/** Index `-2..3`, exactly as charter §8 specifies. */
export const LAYER_BAND_INDEX: Readonly<Record<Layer, number>> = {
  evidence: -2,
  intellectual: -1,
  claim: 0,
  debate: 1,
  learning: 2,
  research: 3,
};

export function isLayer(value: string): value is Layer {
  return (LAYER_ORDER as readonly string[]).includes(value);
}
