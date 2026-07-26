import { createHash } from "node:crypto";

/**
 * Deterministic train/test split via SHA-256 hash bucketing: an item's split
 * assignment depends only on its own id (hashed) and `testFrac`, never on
 * array ordering or a random seed — so re-running the split later (after
 * more gold examples are added) does NOT reshuffle items already assigned;
 * a newly-added item just lands in whichever bucket its own hash puts it in.
 *
 * Switching the hash function itself, however, DOES reshuffle every item's
 * assignment — that is a one-time, deliberate event (a taxonomy/gold-format
 * migration), not something to do casually once real eval gold exists,
 * since it silently invalidates any eval run comparison made across the
 * switch.
 */
export type SplitAssignment = "train" | "test";

export function assignSplit(itemId: string, testFrac = 0.3): SplitAssignment {
  if (testFrac < 0 || testFrac > 1) {
    throw new Error(`testFrac must be in [0,1], got ${testFrac}.`);
  }
  const digest = createHash("sha256").update(itemId).digest();
  // First 4 bytes as an unsigned 32-bit integer, normalized to [0,1).
  const bucket = digest.readUInt32BE(0) / 0x100000000;
  return bucket < testFrac ? "test" : "train";
}

export function splitItems<T extends { id: string }>(
  items: T[],
  testFrac = 0.3,
): { train: T[]; test: T[] } {
  const train: T[] = [];
  const test: T[] = [];
  for (const item of items) {
    (assignSplit(item.id, testFrac) === "test" ? test : train).push(item);
  }
  return { train, test };
}
