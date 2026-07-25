"use server";

import { db, users } from "@ice/db";
import { reportEvent } from "@ice/observability";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { deleteAccount } from "@/lib/accountDeletion";
import { enforceUserRateLimit } from "@/lib/apiRateLimit";
import { requireSession, signOut } from "@/lib/auth";
import { validateAvatarDataUrl } from "@/lib/avatarUpload";

/**
 * Workstream G (v.5) account-page server actions: profile edit (name +
 * data-URL avatar), the data-sharing opt-in toggle, and account deletion.
 * `accountDeletion.ts` holds the actual deletion orchestration (unit-tested
 * with injected effects); this file is the thin auth/rate-limit/validation
 * layer in front of it, matching the split `apps/web/src/lib/actions.ts`
 * already uses for auth flows.
 */

export type UpdateProfileState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

const MAX_NAME_LENGTH = 200;

export async function updateProfileAction(
  _prevState: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const session = await requireSession();
  const userId = session.user.id;

  const rawName = String(formData.get("name") ?? "").trim();
  if (rawName.length === 0 || rawName.length > MAX_NAME_LENGTH) {
    return { status: "error", message: "Please enter a name (up to 200 characters)." };
  }

  const rawAvatar = formData.get("avatarDataUrl");
  const avatarDataUrl = typeof rawAvatar === "string" ? rawAvatar.trim() : "";

  let image: string | null | undefined;
  if (avatarDataUrl.length > 0) {
    const validation = validateAvatarDataUrl(avatarDataUrl);
    if (!validation.ok) {
      return { status: "error", message: validation.error };
    }
    image = avatarDataUrl;
  } else if (formData.get("removeAvatar") === "1") {
    image = null;
  }
  // Otherwise `image` stays `undefined` — the existing avatar (if any) is
  // left untouched rather than cleared by an unrelated name-only edit.

  await db
    .update(users)
    .set({ name: rawName, ...(image !== undefined ? { image } : {}), updatedAt: new Date() })
    .where(eq(users.id, userId));

  revalidatePath("/account/profile");
  return { status: "success" };
}

export async function updateDataSharingAction(enabled: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireSession();
  await db
    .update(users)
    .set({ dataSharingEnabled: enabled, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));
  revalidatePath("/account/profile");
  return { ok: true };
}

export type DeleteAccountState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "storage_abort"; message: string };

/**
 * Flow (plan §"G — Delete account", steps 1-9): rate limit + typed-email
 * match + fresh-password check (any failure is a generic error, but the
 * rate-limit call itself always runs first so a failed attempt still counts
 * against the limit) → `deleteAccount()` (archive-first orchestration,
 * gated per-work deletion, orphan sweep, then the user row) → on success,
 * `reportEvent` + `signOut` to the landing farewell notice. The storage-abort
 * case leaves the account and session fully intact — nothing here has torn
 * anything down — so the same form can simply be retried.
 */
export async function deleteAccountAction(
  _prevState: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const session = await requireSession();
  const userId = session.user.id;

  const rate = await enforceUserRateLimit({ userId, scope: "account-delete", limit: 5, windowMs: 60 * 60_000 });
  if (!rate.allowed) {
    return { status: "error", message: "Too many attempts — please wait before trying again." };
  }

  const typedEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const [user] = await db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const emailMatches = !!user && typedEmail === user.email.toLowerCase();
  const passwordMatches = !!user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
  if (!emailMatches || !passwordMatches) {
    return { status: "error", message: "Your email or password didn't match — nothing was deleted." };
  }

  const outcome = await deleteAccount(userId);

  if (outcome.outcome === "storage_abort") {
    return { status: "storage_abort", message: outcome.message };
  }

  // "not_found" only happens if the account was already deleted by a
  // concurrent request — treat it the same as a successful deletion from
  // this request's point of view (there is nothing left to sign out of
  // except this stale session).
  reportEvent("account.deleted", { outcome: outcome.outcome });
  await signOut({ redirectTo: "/?deleted=1" });
  return { status: "idle" };
}
