import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import {
  normalizeWorkspacePreferences,
  type WorkspacePreferences,
} from "./workspacePreferences";

/**
 * Phase 9.4 (plan §34.4): `expertise` retired from this jsonb blob onto the
 * typed `users.readerLevel` column (see `@/lib/readerLevel`) — migration
 * `0015` already backfilled every existing value, so nothing here needs to
 * read the old key going forward. `onboardedAt` stays jsonb; it was never
 * part of the reader-level migration.
 */
export interface UserPreferences {
  /** ISO timestamp; presence marks onboarding complete. */
  onboardedAt?: string;
  /** Phase 12 workspace controls, deliberately namespaced inside existing JSONB. */
  workspace?: WorkspacePreferences;
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

export async function getWorkspacePreferences(userId: string): Promise<WorkspacePreferences> {
  const preferences = await getUserPreferences(userId);
  return normalizeWorkspacePreferences(preferences.workspace);
}

export async function updateWorkspacePreferences(
  userId: string,
  patch: Partial<WorkspacePreferences>,
): Promise<WorkspacePreferences> {
  const current = await getUserPreferences(userId);
  const workspace = normalizeWorkspacePreferences({ ...current.workspace, ...patch });
  await updateUserPreferences(userId, { workspace });
  return workspace;
}
