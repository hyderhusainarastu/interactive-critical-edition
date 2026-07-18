"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getApiUserId, signIn, signOut } from "@/lib/auth";
import { registerUser, requestPasswordReset, resetPassword } from "@/lib/auth-service";
import { updateUserPreferences } from "@/lib/preferences";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = await signIn("credentials", {
    email,
    password,
    redirect: false,
  });

  if (result?.error) {
    redirect(`/login?error=1`);
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
 * Onboarding completion (Phase 6): records the chosen expertise (which the
 * roadmap uses as its default level) and stamps `onboardedAt` so the
 * dashboard stops routing the user through /welcome. "Skip" submits with no
 * expertise but still stamps onboardedAt. Then sends them to their first
 * upload.
 */
const expertiseSchema = z.enum(["beginner", "intermediate", "advanced"]).optional();

export async function completeOnboardingAction(formData: FormData) {
  const userId = await getApiUserId();
  if (!userId) redirect("/login");

  const raw = formData.get("expertise");
  const parsed = expertiseSchema.safeParse(raw === "" || raw == null ? undefined : raw);
  const expertise = parsed.success ? parsed.data : undefined;

  await updateUserPreferences(userId, {
    ...(expertise ? { expertise } : {}),
    onboardedAt: new Date().toISOString(),
  });

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
