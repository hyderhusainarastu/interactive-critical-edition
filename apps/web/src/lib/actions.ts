"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getApiUserId, signIn, signOut } from "@/lib/auth";
import { registerUser, requestPasswordReset, resetPassword } from "@/lib/auth-service";
import { updateUserPreferences } from "@/lib/preferences";
import { setUserReaderLevel } from "@/lib/readerLevel";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    // Auth.js v5 THROWS when authorize() rejects (it does not return
    // `{ error }`) — including our InvalidCredentialsError /
    // EmailNotVerifiedError. Map any auth failure back to the login form's
    // friendly error state. Non-auth errors — and the NEXT_REDIRECT thrown
    // by redirect() below — must propagate untouched.
    if (error instanceof AuthError) {
      redirect("/login?error=1");
    }
    throw error;
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email(),
  password: z.string().min(8).max(200),
});

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/signup?error=1");
  }

  await registerUser(parsed.data);
  redirect("/verify-email?sent=1");
}

/**
 * Onboarding completion (Phase 6, updated Phase 9.4): records the chosen
 * reader level (`users.readerLevel`, four levels — plan §34.4 9.4, replacing
 * the retired `preferences.expertise`) and stamps `onboardedAt` so the
 * dashboard stops routing the user through /welcome. "Skip" submits with no
 * level chosen but still stamps onboardedAt — an explicit choice is never
 * required. Then sends them to their first upload.
 */
const readerLevelSchema = z.enum(["beginner", "undergraduate", "advanced", "research"]).optional();

export async function completeOnboardingAction(formData: FormData) {
  const userId = await getApiUserId();
  if (!userId) redirect("/login");

  const raw = formData.get("readerLevel");
  const parsed = readerLevelSchema.safeParse(raw === "" || raw == null ? undefined : raw);
  const readerLevel = parsed.success ? parsed.data : undefined;

  if (readerLevel) await setUserReaderLevel(userId, readerLevel);
  await updateUserPreferences(userId, { onboardedAt: new Date().toISOString() });

  redirect(formData.get("skip") ? "/dashboard" : "/upload");
}

export async function requestResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  if (email) {
    await requestPasswordReset(email);
  }
  redirect("/reset-password?sent=1");
}

export async function resetPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = await resetPassword({ email, token, password });
  if (!result.ok) {
    redirect(
      `/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&error=1`,
    );
  }

  redirect("/login?reset=1");
}
