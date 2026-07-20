import { db, users } from "@ice/db";
import type { ReaderLevel } from "@ice/roadmap";
import { eq } from "drizzle-orm";

/**
 * Phase 9.4 (plan §34.4): the reader's global level, read from the typed
 * `users.readerLevel` column rather than the retired `preferences.expertise`
 * jsonb key. Null means "not chosen" — callers apply their own default
 * rather than this module inventing one, since the level only ever changes
 * what opens by DEFAULT, never what is reachable.
 */
export async function getUserReaderLevel(userId: string): Promise<ReaderLevel | null> {
  const [row] = await db
    .select({ readerLevel: users.readerLevel })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.readerLevel ?? null;
}

/**
 * Sets the reader's global level. This is an explicit choice only — never
 * called just because the reader browsed at a particular level on one page
 * (plan §34.4: "Browsing alone never silently changes a level").
 */
export async function setUserReaderLevel(userId: string, level: ReaderLevel): Promise<void> {
  await db.update(users).set({ readerLevel: level, updatedAt: new Date() }).where(eq(users.id, userId));
}
