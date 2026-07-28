/**
 * Deterministic PRNG for fixture generation. mulberry32 — small, dependency
 * free, and stable across Node versions/platforms (integer-only bitwise
 * arithmetic, no reliance on Math.random or environment entropy).
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns an integer in [0, maxExclusive). */
export function rngInt(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

/** Picks an element from `items` uniformly at random. */
export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  return items[rngInt(rng, items.length)];
}

/** Weighted pick: `weights` are relative (need not sum to 1). */
export function rngWeightedPick<T>(rng: Rng, entries: ReadonlyArray<{ value: T; weight: number }>): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}
