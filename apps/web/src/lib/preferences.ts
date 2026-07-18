import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";

export type Expertise = "beginner" | "intermediate" | "advanced";

export interface UserPreferences {
  expertise?: Expertise;
  /** ISO timestamp; presence marks onboarding complete. */
  onboardedAt?: string;
}

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  const [row] = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (row?.preferences as UserPreferences | null) ?? {};
}

/** Shallow-merges a patch into the user's preferences jsonb. */
export async function updateUserPreferences(userId: string, patch: UserPreferences): Promise<void> {
  const current = await getUserPreferences(userId);
  await db
    .update(users)
    .set({ preferences: { ...current, ...patch }, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
