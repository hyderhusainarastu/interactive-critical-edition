"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn, signOut } from "@/lib/auth";
import { registerUser, requestPasswordReset, resetPassword } from "@/lib/auth-service";

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
